import { DEFAULT_PAGE_SIZE, type QueryHandler } from "../types";
import { paginate } from "../paginate";

export const handleListRuns: QueryHandler<"ListRuns"> = async (
  params,
  ctx,
) => {
  const limit = params.limit ?? DEFAULT_PAGE_SIZE;
  const items = await ctx.db.runView.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(params.cursor
      ? { cursor: { jobId: params.cursor }, skip: 1 }
      : {}),
  });
  return paginate(items, limit, (r) => r.jobId);
};
