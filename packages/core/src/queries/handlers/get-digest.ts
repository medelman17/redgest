import type { QueryHandler } from "../types.js";

export const handleGetDigest: QueryHandler<"GetDigest"> = async (
  params,
  ctx,
) => {
  return ctx.db.digestView.findFirst({
    where: { digestId: params.digestId, organizationId: ctx.organizationId },
  });
};
