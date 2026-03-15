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
