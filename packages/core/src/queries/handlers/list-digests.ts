import type { QueryHandler } from "../types.js";

export const handleListDigests: QueryHandler<"ListDigests"> = async (
  params,
  ctx,
) => {
  return ctx.db.digestView.findMany({
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });
};
