import type { QueryHandler } from "../types.js";

export const handleGetProfile: QueryHandler<"GetProfile"> = async (
  params,
  ctx,
) => {
  const result = await ctx.db.profileView.findUnique({
    where: { profileId: params.profileId },
  });
  // Tenant isolation: ensure the profile belongs to the caller's organization
  if (result && result.organizationId !== ctx.organizationId) {
    return null;
  }
  return result;
};
