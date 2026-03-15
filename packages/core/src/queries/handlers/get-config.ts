import type { QueryHandler } from "../types.js";

export const handleGetConfig: QueryHandler<"GetConfig"> = async (
  _params,
  ctx,
) => {
  return ctx.db.config.findFirst({
    where: { organizationId: ctx.organizationId },
  });
};
