import { task, logger } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import { InProcessEventBus, runCrawl } from "@redgest/core";
import {
  RedditClient,
  PublicRedditClient,
  TokenBucket,
  RedditContentSource,
} from "@redgest/reddit";
import type { RedditApiClient } from "@redgest/reddit";

export const crawlSubreddit = task({
  id: "crawl-subreddit",
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000 },
  run: async (payload: { subredditId: string }) => {
    const config = loadConfig();
    const eventBus = new InProcessEventBus();

    let redditClient: RedditApiClient;
    let rateLimiter: TokenBucket;

    if (config.REDDIT_CLIENT_ID && config.REDDIT_CLIENT_SECRET) {
      redditClient = new RedditClient({
        clientId: config.REDDIT_CLIENT_ID,
        clientSecret: config.REDDIT_CLIENT_SECRET,
        userAgent: "redgest/1.0.0",
      });
      rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
    } else {
      logger.warn(
        "REDDIT_CLIENT_ID/SECRET not set — using public .json endpoint (10 req/min limit)",
      );
      redditClient = new PublicRedditClient({ userAgent: "redgest/1.0.0" });
      rateLimiter = new TokenBucket({ capacity: 10, refillRate: 10 / 60 });
    }

    const contentSource = new RedditContentSource(redditClient, rateLimiter);

    logger.info("Starting crawl", { subredditId: payload.subredditId });

    const result = await runCrawl(payload.subredditId, {
      db: prisma,
      eventBus,
      contentSource,
    });

    logger.info("Crawl complete", {
      subreddit: result.subreddit,
      postCount: result.postCount,
      newPostCount: result.newPostCount,
      updatedPostCount: result.updatedPostCount,
    });

    return result;
  },
});
