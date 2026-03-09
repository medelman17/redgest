import type { QueryHandler } from "../types.js";

export const handleGetRunStatus: QueryHandler<"GetRunStatus"> = async (
  params,
  ctx,
) => {
  return ctx.db.runView.findUnique({ where: { jobId: params.jobId } });
};
