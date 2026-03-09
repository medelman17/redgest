import type { CommandHandler } from "../types.js";

export const handleGenerateDigest: CommandHandler<"GenerateDigest"> = async (
  params,
  ctx,
) => {
  const subredditIds = params.subredditIds ?? [];
  const lookback = params.lookbackHours ? `${params.lookbackHours}h` : "24h";

  const job = await ctx.db.job.create({
    data: {
      status: "QUEUED",
      subreddits: subredditIds,
      lookback,
    },
  });

  return {
    data: { jobId: job.id, status: job.status },
    event: { jobId: job.id, subredditIds },
  };
};
