import type { QueryHandler } from "../types";

export const handleListSubreddits: QueryHandler<"ListSubreddits"> = async (
  _params,
  ctx,
) => {
  return ctx.db.subredditView.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { name: "asc" },
  });
};
