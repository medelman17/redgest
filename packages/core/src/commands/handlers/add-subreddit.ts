import type { CommandHandler } from "../types.js";

export const handleAddSubreddit: CommandHandler<"AddSubreddit"> = async (
  params,
  ctx,
) => {
  const sub = await ctx.db.subreddit.create({
    data: {
      name: params.name,
      insightPrompt: params.insightPrompt ?? null,
      maxPosts: params.maxPosts ?? 5,
      includeNsfw: params.nsfw ?? false,
      nextCrawlAt: new Date(),
    },
  });

  return {
    data: { subredditId: sub.id },
    event: { subredditId: sub.id, name: sub.name },
  };
};
