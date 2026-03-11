import { DEFAULT_PAGE_SIZE, type QueryHandler } from "../types.js";
import { paginate } from "../paginate.js";

export const handleSearchDigests: QueryHandler<"SearchDigests"> = async (
  params,
  ctx,
) => {
  const limit = params.limit ?? DEFAULT_PAGE_SIZE;
  const items = await ctx.db.digest.findMany({
    where: {
      contentMarkdown: { contains: params.query, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  return paginate(items, limit, (d) => d.id);
};
