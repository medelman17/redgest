import type { QueryHandler } from "../types.js";

export const handleListSubreddits: QueryHandler<"ListSubreddits"> = async (
  _params,
  ctx,
) => {
  return ctx.db.subredditView.findMany({ orderBy: { name: "asc" } });
};
