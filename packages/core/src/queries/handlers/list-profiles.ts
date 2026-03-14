import type { QueryHandler } from "../types.js";

export const handleListProfiles: QueryHandler<"ListProfiles"> = async (
  _params,
  ctx,
) => {
  return ctx.db.profileView.findMany({ orderBy: { name: "asc" } });
};
