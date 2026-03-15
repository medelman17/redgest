import type { QueryHandler } from "../types.js";

export const handleGetSubredditStats: QueryHandler<
  "GetSubredditStats"
> = async (params, ctx) => {
  const where: Record<string, unknown> = {
    organizationId: ctx.organizationId,
  };
  if (params.name) {
    where.name = params.name;
  }
  return ctx.db.subredditView.findMany({
    where,
    orderBy: { name: "asc" },
  });
};
