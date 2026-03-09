import type { QueryHandler } from "../types.js";

export const handleGetDigest: QueryHandler<"GetDigest"> = async (
  params,
  ctx,
) => {
  return ctx.db.digestView.findUnique({ where: { digestId: params.digestId } });
};
