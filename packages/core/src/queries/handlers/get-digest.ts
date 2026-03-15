import type { QueryHandler } from "../types.js";

export const handleGetDigest: QueryHandler<"GetDigest"> = async (
  params,
  ctx,
) => {
  const result = await ctx.db.digestView.findUnique({
    where: { digestId: params.digestId },
  });
  // Tenant isolation: ensure the digest belongs to the caller's organization
  if (result && result.organizationId !== ctx.organizationId) {
    return null;
  }
  return result;
};
