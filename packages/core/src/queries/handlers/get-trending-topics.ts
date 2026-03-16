import type { QueryHandler } from "../types.js";
import { parseDuration } from "../../utils/duration.js";
import { STOP_WORDS } from "../../pipeline/topic-step.js";

export const handleGetTrendingTopics: QueryHandler<"GetTrendingTopics"> = async (
  params,
  ctx,
) => {
  const limit = params.limit ?? 10;

  // Build where clause for topics
  const where: Record<string, unknown> = {
    // Exclude stop words that were stored before the extraction filter was added
    name: { notIn: Array.from(STOP_WORDS) },
  };

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

  if (ctx.organizationId) {
    const orgSubreddits = await ctx.db.subreddit.findMany({
      where: { organizationId: ctx.organizationId },
      select: { name: true },
    });
    const orgSubNames = orgSubreddits.map((s) => s.name);
    // Intersect org subreddits with specific subreddit filter if both present
    const effectiveFilter =
      params.subreddit && orgSubNames.includes(params.subreddit)
        ? params.subreddit
        : params.subreddit
          ? "__no_match__"
          : { in: orgSubNames };
    where.posts = {
      some: {
        post: { subreddit: effectiveFilter },
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
