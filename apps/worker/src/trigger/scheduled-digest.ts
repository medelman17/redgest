import {
  schedules,
  logger,
  idempotencyKeys,
  AbortTaskRunError,
} from "@trigger.dev/sdk/v3";
import { prisma } from "@redgest/db";
import { generateDigest } from "./generate-digest.js";

export const scheduledDigest = schedules.task({
  id: "scheduled-digest",
  cron: process.env.DIGEST_CRON ?? "0 7 * * *",
  run: async () => {
    // Find all active subreddits
    const subreddits = await prisma.subreddit.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    if (subreddits.length === 0) {
      logger.info("No active subreddits, skipping");
      return { jobId: null, subredditCount: 0 };
    }

    // Create a job record
    const job = await prisma.job.create({
      data: {
        status: "QUEUED",
        subreddits: subreddits.map((s) => s.id),
        lookback: "24h",
      },
    });

    const subredditIds = subreddits.map((s) => s.id);

    logger.info("Triggering scheduled digest", {
      jobId: job.id,
      subredditCount: subredditIds.length,
    });

    try {
      await generateDigest.trigger(
        { jobId: job.id, subredditIds },
        {
          idempotencyKey: await idempotencyKeys.create(`generate-${job.id}`),
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Trigger dispatch failed for job ${job.id}`, {
        error: message,
      });
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "FAILED", completedAt: new Date(), error: message },
      });
      // Abort (don't retry) — retrying would create a duplicate job record.
      // The next cron cycle will create a fresh job.
      throw new AbortTaskRunError(
        `Trigger dispatch failed for job ${job.id}: ${message}`,
      );
    }

    return { jobId: job.id, subredditCount: subredditIds.length };
  },
});
