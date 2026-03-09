import type { CommandHandler } from "../types.js";

export const handleRemoveSubreddit: CommandHandler<"RemoveSubreddit"> = async (
  params,
  ctx,
) => {
  const sub = await ctx.db.subreddit.update({
    where: { id: params.subredditId },
    data: { isActive: false },
    select: { id: true, name: true },
  });

  return {
    data: { subredditId: sub.id },
    event: { subredditId: sub.id, name: sub.name },
  };
};
