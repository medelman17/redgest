import type { PrismaClient } from "@redgest/db";
import { sanitizeContent } from "@redgest/reddit";
import type { DomainEventBus } from "./events/bus.js";
import type { DomainEvent, DomainEventType, DomainEventMap } from "./events/types.js";
import { persistEvent, type EventCreateClient } from "./events/persist.js";
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
  eventBus: DomainEventBus;
  contentSource: ContentSource;
}

async function emitCrawlEvent<K extends DomainEventType>(
  db: PrismaClient,
  eventBus: DomainEventBus,
  type: K,
  payload: DomainEventMap[K],
  aggregateId: string,
): Promise<void> {
  // Build envelope via Record — single cast follows dispatch.ts buildEvent() pattern
  const envelope: Record<string, unknown> = {
    type,
    payload,
    aggregateId,
    aggregateType: "subreddit",
    version: 1,
    correlationId: null,
    causationId: null,
    metadata: {},
    occurredAt: new Date(),
  };
  const event = envelope as DomainEvent;

  // PrismaClient satisfies EventCreateClient at runtime; Prisma's generated types are stricter
  await persistEvent(db as unknown as EventCreateClient, event);
  eventBus.emitEvent(event);
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

    for (const { post, comments } of content.posts) {
      if (post.over_18 && !sub.includeNsfw) continue;

      // Compute scoreDelta
      const existing = await db.post.findUnique({
        where: { redditId: post.id },
        select: { score: true },
      });
      const scoreDelta = existing ? post.score - existing.score : 0;

      if (existing) {
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

    await emitCrawlEvent(db, eventBus, "CrawlCompleted", result, subredditId);

    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    await emitCrawlEvent(
      db,
      eventBus,
      "CrawlFailed",
      { subredditId, subreddit: sub.name, error },
      subredditId,
    );

    throw err;
  }
}
