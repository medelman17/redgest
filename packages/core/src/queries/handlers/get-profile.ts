import type { QueryHandler } from "../types.js";

export const handleGetProfile: QueryHandler<"GetProfile"> = async (
  params,
  ctx,
) => {
  return ctx.db.profileView.findUnique({
    where: { profileId: params.profileId },
  });
};
