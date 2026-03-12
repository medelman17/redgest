import type { QueryHandler } from "../types.js";

export const handleGetSubredditStats: QueryHandler<
  "GetSubredditStats"
> = async (params, ctx) => {
  if (params.name) {
    const result = await ctx.db.subredditView.findMany({
      where: { name: params.name },
      orderBy: { name: "asc" },
    });
    return result;
  }
  return ctx.db.subredditView.findMany({ orderBy: { name: "asc" } });
};
