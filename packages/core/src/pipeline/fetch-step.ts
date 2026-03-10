import type { PrismaClient } from "@redgest/db";
import { sanitizeContent } from "@redgest/reddit";
import type { ContentSource, FetchStepResult } from "./types.js";

/**
 * Fetch posts from a content source, filter NSFW if needed,
 * and upsert posts + comments to the database.
 */
export async function fetchStep(
  subreddit: { name: string; maxPosts: number; includeNsfw: boolean },
  source: ContentSource,
  db: PrismaClient,
): Promise<FetchStepResult> {
  const content = await source.fetchContent(subreddit.name, {
    sorts: ["hot", "top", "rising"],
    limit: subreddit.maxPosts,
    commentsPerPost: 10,
    timeRange: "day",
  });

  const results: FetchStepResult["posts"] = [];

  for (const { post, comments } of content.posts) {
    // Skip NSFW if not allowed
    if (post.over_18 && !subreddit.includeNsfw) continue;

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
      },
      update: {
        score: post.score,
        commentCount: post.num_comments,
        fetchedAt: content.fetchedAt,
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
  };
}
