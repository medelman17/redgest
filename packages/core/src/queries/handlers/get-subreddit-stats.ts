import type { QueryHandler } from "../types";

export const handleGetSubredditStats: QueryHandler<
  "GetSubredditStats"
> = async (params, ctx) => {
  return ctx.db.subredditView.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(params.name ? { name: params.name } : {}),
    },
    orderBy: { name: "asc" },
  });
};
