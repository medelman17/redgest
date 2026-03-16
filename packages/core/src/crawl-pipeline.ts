import type { PrismaClient } from "@redgest/db";
import { sanitizeContent } from "@redgest/reddit";
import type { EventBus } from "./events/bus.js";
import { emitDomainEvent } from "./events/emit.js";
import type { ContentSource } from "./pipeline/types.js";

export interface CrawlResult {
  subredditId: string;
  subreddit: string;
  postCount: number;
  newPostCount: number;
  updatedPostCount: number;
}

export interface CrawlDeps {
  db: PrismaClient;
  eventBus: EventBus;
  contentSource: ContentSource;
}

/**
 * Crawl a single subreddit: fetch posts from Reddit, upsert to DB,
 * update lastFetchedAt and nextCrawlAt, emit CrawlCompleted/CrawlFailed.
 */
export async function runCrawl(
  subredditId: string,
  deps: CrawlDeps,
): Promise<CrawlResult> {
  const { db, eventBus, contentSource } = deps;

  const sub = await db.subreddit.findUniqueOrThrow({
    where: { id: subredditId },
  });

  try {
    const content = await contentSource.fetchContent(sub.name, {
      sorts: ["hot", "top", "rising"],
      limit: sub.maxPosts,
      commentsPerPost: 10,
      timeRange: "day",
    });

    let newPostCount = 0;
    let updatedPostCount = 0;

    // Bulk load existing scores to avoid N+1 findUnique per post
    const eligiblePosts = content.posts.filter(
      ({ post }) => !(post.over_18 && !sub.includeNsfw),
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

      if (prevScore !== undefined) {
        updatedPostCount++;
      } else {
        newPostCount++;
      }

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

      // Replace comments
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
    }

    const postCount = newPostCount + updatedPostCount;

    // Update subreddit timestamps
    const nextCrawlAt = new Date(
      Date.now() + sub.crawlIntervalMinutes * 60 * 1000,
    );
    await db.subreddit.update({
      where: { id: subredditId },
      data: { lastFetchedAt: content.fetchedAt, nextCrawlAt },
    });

    const result: CrawlResult = {
      subredditId,
      subreddit: sub.name,
      postCount,
      newPostCount,
      updatedPostCount,
    };

    await emitDomainEvent(db, eventBus, "CrawlCompleted", result, subredditId, "subreddit");

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    await emitDomainEvent(
      db,
      eventBus,
      "CrawlFailed",
      { subredditId, subreddit: sub.name, error },
      subredditId,
      "subreddit",
    );

    throw err;
  }
}
