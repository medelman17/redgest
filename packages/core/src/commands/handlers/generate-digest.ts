import { RedgestError } from "../../errors.js";
import type { CommandHandler } from "../types.js";

export const handleGenerateDigest: CommandHandler<"GenerateDigest"> = async (
  params,
  ctx,
) => {
  let subredditIds = params.subredditIds ?? [];
  let lookback = params.lookbackHours ? `${params.lookbackHours}h` : "24h";
  let maxPosts = params.maxPosts;

  // If profileId provided, load profile settings as defaults
  if (params.profileId) {
    const profile = await ctx.db.digestProfile.findUnique({
      where: { id: params.profileId },
      include: { subreddits: { select: { subredditId: true } } },
    });
    if (!profile) {
      throw new RedgestError("NOT_FOUND", `Profile not found: ${params.profileId}`);
    }
    // Profile subreddits used only if not explicitly provided
    if (subredditIds.length === 0) {
      subredditIds = profile.subreddits.map((s) => s.subredditId);
    }
    // Profile lookback used only if not explicitly provided
    if (!params.lookbackHours) {
      lookback = `${profile.lookbackHours}h`;
    }
    // Profile maxPosts used only if not explicitly provided
    if (maxPosts === undefined) {
      maxPosts = profile.maxPosts;
    }
  }

  const activeJob = await ctx.db.job.findFirst({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  if (activeJob) {
    throw new RedgestError(
      "CONFLICT",
      `A digest run is already ${activeJob.status.toLowerCase()} (job ${activeJob.id}). Wait for it to complete or fail before starting another.`,
      { activeJobId: activeJob.id, activeJobStatus: activeJob.status },
    );
  }

  const job = await ctx.db.job.create({
    data: {
      status: "QUEUED",
      subreddits: subredditIds,
      lookback,
      profileId: params.profileId ?? null,
    },
  });

  return {
    data: { jobId: job.id, status: job.status },
    event: { jobId: job.id, subredditIds, forceRefresh: params.forceRefresh, maxPosts },
  };
};
