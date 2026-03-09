import type { QueryHandler } from "../types.js";

export const handleSearchDigests: QueryHandler<"SearchDigests"> = async (
  params,
  ctx,
) => {
  return ctx.db.digest.findMany({
    where: {
      contentMarkdown: { contains: params.query, mode: "insensitive" },
    },
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });
};
