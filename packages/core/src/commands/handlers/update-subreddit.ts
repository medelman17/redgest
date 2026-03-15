import type { CommandHandler } from "../types.js";
import { RedgestError } from "../../errors.js";

export const handleUpdateSubreddit: CommandHandler<"UpdateSubreddit"> = async (
  params,
  ctx,
) => {
  // Verify subreddit belongs to this org
  const existing = await ctx.db.subreddit.findFirst({
    where: { id: params.subredditId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!existing) {
    throw new RedgestError("NOT_FOUND", "Subreddit not found");
  }

  await ctx.db.subreddit.update({
    where: { id: params.subredditId },
    data: {
      ...(params.insightPrompt !== undefined && { insightPrompt: params.insightPrompt }),
      ...(params.maxPosts !== undefined && { maxPosts: params.maxPosts }),
      ...(params.active !== undefined && { isActive: params.active }),
      ...(params.crawlIntervalMinutes !== undefined && { crawlIntervalMinutes: params.crawlIntervalMinutes }),
    },
  });

  return {
    data: { subredditId: params.subredditId },
    event: null,
  };
};
