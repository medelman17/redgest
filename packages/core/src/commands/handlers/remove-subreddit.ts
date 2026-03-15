import type { CommandHandler } from "../types.js";
import { RedgestError } from "../../errors.js";

export const handleRemoveSubreddit: CommandHandler<"RemoveSubreddit"> = async (
  params,
  ctx,
) => {
  // Verify subreddit belongs to this org before deletion
  const existing = await ctx.db.subreddit.findFirst({
    where: { id: params.subredditId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!existing) {
    throw new RedgestError("NOT_FOUND", "Subreddit not found");
  }

  const sub = await ctx.db.subreddit.delete({
    where: { id: params.subredditId },
    select: { id: true, name: true },
  });

  return {
    data: { subredditId: sub.id },
    event: { subredditId: sub.id, name: sub.name },
  };
};
