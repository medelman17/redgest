import {
  schedules,
  logger,
  idempotencyKeys,
} from "@trigger.dev/sdk/v3";
import { prisma } from "@redgest/db";
import { generateDigest } from "./generate-digest.js";

export const scheduledDigest = schedules.task({
  id: "scheduled-digest",
  cron: process.env.DIGEST_CRON ?? "0 7 * * *",
  run: async () => {
    // Find all active profiles with schedules
    const profiles = await prisma.digestProfile.findMany({
      where: { isActive: true, schedule: { not: null } },
      include: {
        subreddits: { select: { subredditId: true } },
      },
    });

    if (profiles.length === 0) {
      // Fallback: legacy behavior — all active subreddits, grouped by org
      const subreddits = await prisma.subreddit.findMany({
        where: { isActive: true },
        select: { id: true, organizationId: true },
      });

      if (subreddits.length === 0) {
        logger.info("No active profiles or subreddits, skipping");
        return { jobs: [], totalSubreddits: 0 };
      }

      // Group subreddits by organizationId and create one job per org
      const byOrg = new Map<string, string[]>();
      for (const sub of subreddits) {
        const orgId = sub.organizationId;
        const existing = byOrg.get(orgId);
        if (existing) {
          existing.push(sub.id);
        } else {
          byOrg.set(orgId, [sub.id]);
        }
      }

      const legacyJobs: Array<{ jobId: string; subredditCount: number }> = [];

      for (const [orgId, subredditIds] of byOrg) {
        let job: { id: string };
        try {
          job = await prisma.job.create({
            data: {
              status: "QUEUED",
              subreddits: subredditIds,
              lookback: "24h",
              organizationId: orgId,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Failed to create job for org ${orgId}`, { error: message });
          continue;
        }

        logger.info("Triggering legacy scheduled digest (no profiles)", {
          jobId: job.id,
          organizationId: orgId,
          subredditCount: subredditIds.length,
        });

        try {
          await generateDigest.trigger(
            { jobId: job.id, subredditIds, organizationId: orgId },
            {
              idempotencyKey: await idempotencyKeys.create(`generate-${job.id}`),
            },
          );
          legacyJobs.push({ jobId: job.id, subredditCount: subredditIds.length });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`Trigger dispatch failed for job ${job.id}`, {
            error: message,
          });
          await prisma.job.update({
            where: { id: job.id },
            data: { status: "FAILED", completedAt: new Date(), error: message },
          });
          // Continue with other orgs instead of aborting
        }
      }

      return { jobs: legacyJobs, totalSubreddits: legacyJobs.reduce((sum, j) => sum + j.subredditCount, 0) };
    }

    // Profile-based scheduling
    const jobs: Array<{ jobId: string; profileName: string; subredditCount: number }> = [];

    for (const profile of profiles) {
      const subredditIds = profile.subreddits.map((s) => s.subredditId);
      if (subredditIds.length === 0) {
        logger.info(`Profile "${profile.name}" has no subreddits, skipping`);
        continue;
      }

      const job = await prisma.job.create({
        data: {
          status: "QUEUED",
          subreddits: subredditIds,
          lookback: `${profile.lookbackHours}h`,
          profileId: profile.id,
          organizationId: profile.organizationId,
        },
      });

      logger.info("Triggering profile digest", {
        jobId: job.id,
        profile: profile.name,
        subredditCount: subredditIds.length,
      });

      try {
        await generateDigest.trigger(
          { jobId: job.id, subredditIds },
          {
            idempotencyKey: await idempotencyKeys.create(`generate-${job.id}`),
          },
        );
        jobs.push({
          jobId: job.id,
          profileName: profile.name,
          subredditCount: subredditIds.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Trigger dispatch failed for profile "${profile.name}"`, {
          error: message,
        });
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "FAILED", completedAt: new Date(), error: message },
        });
        // Continue with other profiles instead of aborting
      }
    }

    return {
      jobs,
      totalSubreddits: jobs.reduce((sum, j) => sum + j.subredditCount, 0),
    };
  },
});
