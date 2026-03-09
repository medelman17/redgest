import type { QueryHandler } from "../types.js";

export const handleListRuns: QueryHandler<"ListRuns"> = async (
  params,
  ctx,
) => {
  return ctx.db.runView.findMany({
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });
};
