import type { CommandHandler } from "../types";
import { RedgestError } from "../../errors";

export const handleRemoveSubreddit: CommandHandler<"RemoveSubreddit"> = async (
  params,
  ctx,
) => {
  // Atomic org-scoped lookup + deletion (avoids TOCTOU)
  const sub = await ctx.db.subreddit.findFirst({
    where: { id: params.subredditId, organizationId: ctx.organizationId },
    select: { id: true, name: true },
  });
  if (!sub) {
    throw new RedgestError("NOT_FOUND", "Subreddit not found");
  }

  await ctx.db.subreddit.delete({
    where: { id: sub.id },
  });

  return {
    data: { subredditId: sub.id },
    event: { subredditId: sub.id, name: sub.name },
  };
};
