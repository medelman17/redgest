import { task, logger, idempotencyKeys } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import {
  InProcessEventBus,
  runDigestPipeline,
  type PipelineDeps,
} from "@redgest/core";
import {
  RedditClient,
  PublicRedditClient,
  TokenBucket,
  RedditContentSource,
} from "@redgest/reddit";
import type { RedditApiClient } from "@redgest/reddit";

export const generateDigest = task({
  id: "generate-digest",
  retry: { maxAttempts: 2 },
  run: async (payload: { jobId: string; subredditIds: string[]; organizationId?: string }) => {
    try {
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
        logger.warn("REDDIT_CLIENT_ID/SECRET not set — using public .json endpoint (10 req/min limit)");
        redditClient = new PublicRedditClient({ userAgent: "redgest/1.0.0" });
        rateLimiter = new TokenBucket({ capacity: 10, refillRate: 10 / 60 });
      }

      const contentSource = new RedditContentSource(redditClient, rateLimiter);

      const { DEFAULT_ORGANIZATION_ID } = await import("@redgest/config");
      const deps: PipelineDeps = {
        db: prisma,
        eventBus,
        contentSource,
        config,
        organizationId: payload.organizationId ?? DEFAULT_ORGANIZATION_ID,
      };

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

      // Trigger delivery if digest was produced.
      // Wrapped in its own try/catch — delivery dispatch failure must NOT
      // overwrite the job's COMPLETED/PARTIAL status set by the pipeline.
      if (result.digestId) {
        try {
          const { deliverDigest } = await import("./deliver-digest.js");
          await deliverDigest.trigger(
            {
              digestId: result.digestId,
              organizationId: payload.organizationId,
            },
            {
              idempotencyKey: await idempotencyKeys.create(
                `deliver-${result.digestId}`,
              ),
            },
          );
        } catch (deliveryErr) {
          const msg =
            deliveryErr instanceof Error
              ? deliveryErr.message
              : String(deliveryErr);
          logger.error(
            `Delivery dispatch failed for digest ${result.digestId}`,
            { error: msg },
          );
          // Don't re-throw — pipeline succeeded, digest exists
        }
      }

      return {
        jobId: result.jobId,
        status: result.status,
        digestId: result.digestId,
      };
    } catch (err) {
      // Ensure job is marked FAILED for pre-pipeline errors (config loading,
      // Reddit client construction, etc.). The orchestrator handles pipeline-internal
      // errors, but this covers cases where the pipeline was never reached.
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Task failed for job ${payload.jobId}`, { error: message });
      try {
        await prisma.job.update({
          where: { id: payload.jobId },
          data: { status: "FAILED", completedAt: new Date(), error: message },
        });
      } catch {
        logger.error(`Failed to update job ${payload.jobId} status to FAILED`);
      }
      throw err; // Re-throw so Trigger.dev retry logic can retry
    }
  },
});
