import { DEFAULT_PAGE_SIZE, type QueryHandler } from "../types.js";
import { paginate } from "../paginate.js";

export const handleSearchPosts: QueryHandler<"SearchPosts"> = async (
  params,
  ctx,
) => {
  const limit = params.limit ?? DEFAULT_PAGE_SIZE;
  const items = await ctx.db.post.findMany({
    where: { title: { contains: params.query, mode: "insensitive" } },
    orderBy: { fetchedAt: "desc" },
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  return paginate(items, limit, (p) => p.id);
};
