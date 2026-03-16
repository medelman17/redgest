import { RedgestError } from "../../errors";
import type { CommandHandler } from "../types";

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "PARTIAL", "CANCELED"];

export const handleCancelRun: CommandHandler<"CancelRun"> = async (
  params,
  ctx,
) => {
  const job = await ctx.db.job.findFirst({
    where: { id: params.jobId, organizationId: ctx.organizationId },
    select: { id: true, status: true, triggerRunId: true },
  });

  if (!job) {
    throw new RedgestError("NOT_FOUND", "Job not found");
  }

  if (TERMINAL_STATUSES.includes(job.status)) {
    throw new RedgestError(
      "CONFLICT",
      `Cannot cancel a job with status ${job.status}`,
      { jobId: job.id, currentStatus: job.status },
    );
  }

  // Best-effort: cancel Trigger.dev run if applicable
  if (job.status === "RUNNING" && job.triggerRunId) {
    try {
      const { runs } = await import("@trigger.dev/sdk/v3");
      await runs.cancel(job.triggerRunId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[CancelRun] Failed to cancel Trigger.dev run ${job.triggerRunId}: ${message}`,
      );
    }
  }

  await ctx.db.job.update({
    where: { id: params.jobId },
    data: {
      status: "CANCELED",
      completedAt: new Date(),
      error: "Canceled by user",
    },
  });

  return {
    data: { jobId: params.jobId, status: "CANCELED" as const },
    event: { jobId: params.jobId },
  };
};
