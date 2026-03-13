import type { QueryHandler } from "../types.js";
import { parseDuration } from "../../utils/duration.js";

export const handleGetTrendingTopics: QueryHandler<"GetTrendingTopics"> = async (
  params,
  ctx,
) => {
  const limit = params.limit ?? 10;

  // Build where clause for topics
  const where: Record<string, unknown> = {};

  if (params.since) {
    const sinceDate = new Date(Date.now() - parseDuration(params.since));
    where.lastSeen = { gte: sinceDate };
  }

  if (params.subreddit) {
    where.posts = {
      some: {
        post: { subreddit: params.subreddit },
      },
    };
  }

  const topics = await ctx.db.topic.findMany({
    where,
    orderBy: [{ frequency: "desc" }, { lastSeen: "desc" }],
    take: limit,
    include: {
      _count: {
        select: { posts: true },
      },
    },
  });

  return topics.map((t) => ({
    name: t.name,
    frequency: t.frequency,
    firstSeen: t.firstSeen.toISOString(),
    lastSeen: t.lastSeen.toISOString(),
    recentPostCount: t._count.posts,
  }));
};
