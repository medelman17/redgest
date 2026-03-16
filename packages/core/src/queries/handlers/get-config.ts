import type { QueryHandler } from "../types";

export const handleGetConfig: QueryHandler<"GetConfig"> = async (
  _params,
  ctx,
) => {
  return ctx.db.config.findFirst({
    where: { organizationId: ctx.organizationId },
  });
};
