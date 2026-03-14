import {
  schedules,
  logger,
  idempotencyKeys,
} from "@trigger.dev/sdk/v3";
import { prisma } from "@redgest/db";
import { crawlSubreddit } from "./crawl-subreddit.js";

export const scheduledCrawl = schedules.task({
  id: "scheduled-crawl",
  cron: "*/5 * * * *",
  run: async () => {
    // Find subreddits where nextCrawlAt <= now() AND isActive
    const dueSubreddits = await prisma.subreddit.findMany({
      where: {
        isActive: true,
        nextCrawlAt: { lte: new Date() },
      },
      select: { id: true, name: true },
    });

    if (dueSubreddits.length === 0) {
      logger.info("No subreddits due for crawl");
      return { crawled: 0 };
    }

    logger.info("Triggering crawls", {
      count: dueSubreddits.length,
      subreddits: dueSubreddits.map((s) => s.name),
    });

    let dispatched = 0;
    for (const sub of dueSubreddits) {
      try {
        await crawlSubreddit.trigger(
          { subredditId: sub.id },
          {
            idempotencyKey: await idempotencyKeys.create(
              `crawl-${sub.id}-${Math.floor(Date.now() / 60000)}`,
            ),
          },
        );
        dispatched++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to dispatch crawl for r/${sub.name}`, {
          error: message,
        });
      }
    }

    return { crawled: dispatched, total: dueSubreddits.length };
  },
});
