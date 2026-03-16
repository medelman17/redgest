import type { QueryHandler } from "../types";

export const handleListProfiles: QueryHandler<"ListProfiles"> = async (
  _params,
  ctx,
) => {
  return ctx.db.profileView.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { name: "asc" },
  });
};
