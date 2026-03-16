import type { QueryHandler } from "../types";

export const handleGetProfile: QueryHandler<"GetProfile"> = async (
  params,
  ctx,
) => {
  return ctx.db.profileView.findFirst({
    where: { profileId: params.profileId, organizationId: ctx.organizationId },
  });
};
