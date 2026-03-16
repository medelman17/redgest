import type { PrismaClient } from "@redgest/db";
import { sanitizeContent } from "@redgest/reddit";
import type { ContentSource, FetchStepResult } from "./types";

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface FetchStepOptions {
  cacheTtlMs?: number;
}

/**
 * Fetch posts from a content source, filter NSFW if needed,
 * and upsert posts + comments to the database.
 *
 * When `lastFetchedAt` is recent (within cacheTtlMs), returns posts
 * from the database instead of hitting the Reddit API.
 */
export async function fetchStep(
  subreddit: {
    name: string;
    maxPosts: number;
    includeNsfw: boolean;
    lastFetchedAt?: Date | null;
  },
  source: ContentSource,
  db: PrismaClient,
  options?: FetchStepOptions,
): Promise<FetchStepResult> {
  const cacheTtl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheAge = subreddit.lastFetchedAt
    ? Date.now() - subreddit.lastFetchedAt.getTime()
    : Infinity;

  // Cache hit — load from DB instead of Reddit API
  if (cacheAge < cacheTtl) {
    const dbPosts = await db.post.findMany({
      where: {
        subreddit: subreddit.name,
        ...(subreddit.includeNsfw ? {} : { isNsfw: false }),
      },
      orderBy: { fetchedAt: "desc" },
      take: subreddit.maxPosts * 3, // fetch more to account for sort dedup
      include: { comments: { orderBy: { score: "desc" }, take: 10 } },
    });

    return {
      subreddit: subreddit.name,
      posts: dbPosts.map((p) => ({
        postId: p.id,
        redditId: p.redditId,
        post: {
          id: p.redditId,
          name: `t3_${p.redditId}`,
          subreddit: p.subreddit,
          title: p.title,
          selftext: p.body ?? "",
          author: p.author,
          score: p.score,
          num_comments: p.commentCount,
          url: p.url,
          permalink: p.permalink,
          link_flair_text: p.flair,
          over_18: p.isNsfw,
          created_utc: p.fetchedAt.getTime() / 1000,
          is_self: true,
        },
        comments: p.comments.map((c) => ({
          id: c.redditId,
          name: `t1_${c.redditId}`,
          author: c.author,
          body: c.body,
          score: c.score,
          depth: c.depth,
          created_utc: c.fetchedAt.getTime() / 1000,
        })),
      })),
      fetchedAt: subreddit.lastFetchedAt ?? new Date(),
      fromCache: true,
    };
  }

  // Cache miss — fetch from source
  const content = await source.fetchContent(subreddit.name, {
    sorts: ["hot", "top", "rising"],
    limit: subreddit.maxPosts,
    commentsPerPost: 10,
    timeRange: "day",
  });

  const results: FetchStepResult["posts"] = [];

  // Filter eligible posts, then bulk load existing scores to avoid N+1
  const eligiblePosts = content.posts.filter(
    ({ post }) => !(post.over_18 && !subreddit.includeNsfw),
  );
  const existingPosts = await db.post.findMany({
    where: { redditId: { in: eligiblePosts.map(({ post }) => post.id) } },
    select: { redditId: true, score: true },
  });
  const scoreByRedditId = new Map(
    existingPosts.map((p) => [p.redditId, p.score]),
  );

  for (const { post, comments } of eligiblePosts) {
    const prevScore = scoreByRedditId.get(post.id);
    const scoreDelta = prevScore !== undefined ? post.score - prevScore : 0;

    // Upsert post (redditId is unique)
    const dbPost = await db.post.upsert({
      where: { redditId: post.id },
      create: {
        redditId: post.id,
        subreddit: post.subreddit,
        title: sanitizeContent(post.title),
        body: sanitizeContent(post.selftext),
        author: post.author,
        score: post.score,
        commentCount: post.num_comments,
        url: post.url,
        permalink: post.permalink,
        flair: post.link_flair_text,
        isNsfw: post.over_18,
        fetchedAt: content.fetchedAt,
        scoreDelta: 0,
      },
      update: {
        score: post.score,
        commentCount: post.num_comments,
        fetchedAt: content.fetchedAt,
        scoreDelta,
      },
    });

    // Replace comments (delete old, create new)
    await db.postComment.deleteMany({ where: { postId: dbPost.id } });
    if (comments.length > 0) {
      await db.postComment.createMany({
        data: comments.map((c) => ({
          postId: dbPost.id,
          redditId: c.id,
          author: c.author,
          body: sanitizeContent(c.body),
          score: c.score,
          depth: c.depth,
          fetchedAt: content.fetchedAt,
        })),
      });
    }

    results.push({ postId: dbPost.id, redditId: post.id, post, comments });
  }

  return {
    subreddit: subreddit.name,
    posts: results,
    fetchedAt: content.fetchedAt,
    fromCache: false,
  };
}
