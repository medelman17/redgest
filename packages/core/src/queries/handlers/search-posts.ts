import type { QueryHandler } from "../types.js";

export const handleSearchPosts: QueryHandler<"SearchPosts"> = async (
  params,
  ctx,
) => {
  return ctx.db.post.findMany({
    where: { title: { contains: params.query, mode: "insensitive" } },
    orderBy: { fetchedAt: "desc" },
    take: params.limit,
  });
};
