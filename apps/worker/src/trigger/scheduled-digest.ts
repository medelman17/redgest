import { schedules, logger, idempotencyKeys } from "@trigger.dev/sdk/v3";
import { prisma } from "@redgest/db";
import { generateDigest } from "./generate-digest.js";

export const scheduledDigest = schedules.task({
  id: "scheduled-digest",
  cron: process.env.DIGEST_CRON ?? "0 7 * * *",
  run: async () => {
    const db = prisma;

    // Find all active subreddits
    const subreddits = await db.subreddit.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    if (subreddits.length === 0) {
      logger.info("No active subreddits, skipping");
      return { jobId: null, subredditCount: 0 };
    }

    // Create a job record
    const job = await db.job.create({
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

    await generateDigest.trigger(
      { jobId: job.id, subredditIds },
      {
        idempotencyKey: await idempotencyKeys.create(`generate-${job.id}`),
      },
    );

    return { jobId: job.id, subredditCount: subredditIds.length };
  },
});
