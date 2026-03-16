import type { QueryHandler } from "../types";

export const handleGetCrawlStatus: QueryHandler<"GetCrawlStatus"> = async (
  params,
  ctx,
) => {
  const subreddits = await ctx.db.subreddit.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(params.name ? { name: { equals: params.name, mode: "insensitive" as const } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      lastFetchedAt: true,
      nextCrawlAt: true,
      crawlIntervalMinutes: true,
    },
  });

  // Batch: count posts per subreddit in a single query
  const subNames = subreddits.map((s) => s.name);
  const subIds = subreddits.map((s) => s.id);

  const [postCounts, recentEvents] = await Promise.all([
    ctx.db.post.groupBy({
      by: ["subreddit"],
      where: { subreddit: { in: subNames } },
      _count: { id: true },
    }),
    // Most recent crawl event per subreddit (single query via distinct)
    ctx.db.event.findMany({
      where: {
        type: { in: ["CrawlCompleted", "CrawlFailed"] },
        aggregateType: "subreddit",
        aggregateId: { in: subIds },
      },
      orderBy: { createdAt: "desc" },
      distinct: ["aggregateId"],
      select: { aggregateId: true, type: true, payload: true },
    }),
  ]);

  const countByName = new Map(
    postCounts.map((r) => [r.subreddit, r._count.id]),
  );
  const eventBySubId = new Map(
    recentEvents.map((e) => [e.aggregateId, e]),
  );

  return subreddits.map((sub) => {
    const totalPosts = countByName.get(sub.name) ?? 0;

    let lastCrawlStatus: "ok" | "failed" | "never" = "never";
    let lastError: string | undefined;

    if (sub.lastFetchedAt) {
      const lastEvent = eventBySubId.get(sub.id);
      if (lastEvent) {
        if (lastEvent.type === "CrawlFailed") {
          lastCrawlStatus = "failed";
          const payload = lastEvent.payload as Record<string, unknown>;
          lastError = String(payload?.error ?? "Unknown error");
        } else {
          lastCrawlStatus = "ok";
        }
      } else {
        lastCrawlStatus = "ok";
      }
    }

    return {
      subreddit: sub.name,
      lastCrawledAt: sub.lastFetchedAt?.toISOString() ?? null,
      nextCrawlAt: sub.nextCrawlAt?.toISOString() ?? null,
      crawlIntervalMinutes: sub.crawlIntervalMinutes,
      totalPosts,
      lastCrawlStatus,
      ...(lastError ? { lastError } : {}),
    };
  });
};
