import type { QueryHandler } from "../types";

export const handleGetDigestByJobId: QueryHandler<"GetDigestByJobId"> = async (
  params,
  ctx,
) => {
  return ctx.db.digestView.findFirst({
    where: {
      jobId: params.jobId,
      organizationId: ctx.organizationId,
    },
  });
};
