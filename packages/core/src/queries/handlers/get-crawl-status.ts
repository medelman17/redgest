import type { QueryHandler } from "../types.js";

export const handleGetCrawlStatus: QueryHandler<"GetCrawlStatus"> = async (
  params,
  ctx,
) => {
  const where = params.name
    ? { name: { equals: params.name, mode: "insensitive" as const } }
    : {};

  const subreddits = await ctx.db.subreddit.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      name: true,
      lastFetchedAt: true,
      nextCrawlAt: true,
      crawlIntervalMinutes: true,
    },
  });

  const results = await Promise.all(
    subreddits.map(async (sub) => {
      // Count posts for this subreddit
      const totalPosts = await ctx.db.post.count({
        where: { subreddit: sub.name },
      });

      let lastCrawlStatus: "ok" | "failed" | "never" = "never";
      let lastError: string | undefined;

      if (sub.lastFetchedAt) {
        // Check most recent crawl event for this subreddit
        const lastEvent = await ctx.db.event.findFirst({
          where: {
            type: { in: ["CrawlCompleted", "CrawlFailed"] },
            aggregateType: "subreddit",
          },
          orderBy: { createdAt: "desc" },
          select: { type: true, payload: true },
        });

        if (lastEvent) {
          const payload = lastEvent.payload as Record<string, unknown>;
          if (
            payload?.subreddit === sub.name &&
            lastEvent.type === "CrawlFailed"
          ) {
            lastCrawlStatus = "failed";
            lastError = String(payload.error ?? "Unknown error");
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
    }),
  );

  return results;
};
