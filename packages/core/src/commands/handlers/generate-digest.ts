import { RedgestError } from "../../errors.js";
import type { CommandHandler } from "../types.js";

export const handleGenerateDigest: CommandHandler<"GenerateDigest"> = async (
  params,
  ctx,
) => {
  const subredditIds = params.subredditIds ?? [];
  const lookback = params.lookbackHours ? `${params.lookbackHours}h` : "24h";

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
    },
  });

  return {
    data: { jobId: job.id, status: job.status },
    event: { jobId: job.id, subredditIds, forceRefresh: params.forceRefresh },
  };
};
