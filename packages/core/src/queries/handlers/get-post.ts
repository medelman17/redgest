import type { QueryHandler } from "../types";

export const handleGetPost: QueryHandler<"GetPost"> = async (params, ctx) => {
  return ctx.db.postView.findUnique({ where: { postId: params.postId } });
};
