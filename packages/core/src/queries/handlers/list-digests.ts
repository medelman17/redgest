import { DEFAULT_PAGE_SIZE, type QueryHandler } from "../types.js";
import { paginate } from "../paginate.js";

export const handleListDigests: QueryHandler<"ListDigests"> = async (
  params,
  ctx,
) => {
  const limit = params.limit ?? DEFAULT_PAGE_SIZE;
  const items = await ctx.db.digestView.findMany({
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(params.cursor
      ? { cursor: { digestId: params.cursor }, skip: 1 }
      : {}),
  });
  return paginate(items, limit, (d) => d.digestId);
};
