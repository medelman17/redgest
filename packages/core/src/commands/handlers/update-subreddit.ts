import type { CommandHandler } from "../types.js";

export const handleUpdateSubreddit: CommandHandler<"UpdateSubreddit"> = async (
  params,
  ctx,
) => {
  const data: Record<string, unknown> = {};

  if (params.insightPrompt !== undefined) {
    data.insightPrompt = params.insightPrompt;
  }
  if (params.maxPosts !== undefined) {
    data.maxPosts = params.maxPosts;
  }
  if (params.active !== undefined) {
    data.isActive = params.active;
  }
  if (params.crawlIntervalMinutes !== undefined) {
    data.crawlIntervalMinutes = params.crawlIntervalMinutes;
  }

  await ctx.db.subreddit.update({
    where: { id: params.subredditId },
    data,
  });

  return {
    data: { subredditId: params.subredditId },
    event: null,
  };
};
