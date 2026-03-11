import { task, logger, idempotencyKeys } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import {
  DomainEventBus,
  runDigestPipeline,
  type PipelineDeps,
} from "@redgest/core";
import {
  RedditClient,
  TokenBucket,
  RedditContentSource,
} from "@redgest/reddit";

export const generateDigest = task({
  id: "generate-digest",
  retry: { maxAttempts: 2 },
  run: async (payload: { jobId: string; subredditIds: string[] }) => {
    const config = loadConfig();
    const eventBus = new DomainEventBus();

    if (!config.REDDIT_CLIENT_ID || !config.REDDIT_CLIENT_SECRET) {
      throw new Error("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are required for digest generation");
    }

    const redditClient = new RedditClient({
      clientId: config.REDDIT_CLIENT_ID,
      clientSecret: config.REDDIT_CLIENT_SECRET,
      userAgent: "redgest/1.0.0",
    });
    const rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
    const contentSource = new RedditContentSource(redditClient, rateLimiter);

    const deps: PipelineDeps = { db: prisma, eventBus, contentSource, config };

    logger.info("Starting digest pipeline", {
      jobId: payload.jobId,
      subredditCount: payload.subredditIds.length,
    });

    const result = await runDigestPipeline(
      payload.jobId,
      payload.subredditIds,
      deps,
    );

    logger.info("Pipeline complete", {
      jobId: result.jobId,
      status: result.status,
      digestId: result.digestId,
    });

    // Trigger delivery if digest was produced
    if (result.digestId) {
      const { deliverDigest } = await import("./deliver-digest.js");
      await deliverDigest.trigger(
        { digestId: result.digestId },
        {
          idempotencyKey: await idempotencyKeys.create(
            `deliver-${result.digestId}`,
          ),
        },
      );
    }

    return {
      jobId: result.jobId,
      status: result.status,
      digestId: result.digestId,
    };
  },
});
