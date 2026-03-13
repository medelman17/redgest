import type { QueryHandler, PeriodSummary } from "../types.js";
import { parseDuration } from "../../utils/duration.js";

export const handleComparePeriods: QueryHandler<"ComparePeriods"> = async (
  params,
  ctx,
) => {
  const now = Date.now();
  const periodAMs = parseDuration(params.periodA);
  const periodBMs = parseDuration(params.periodB);

  // Period A: most recent (e.g. last 7d)
  const periodAEnd = new Date(now);
  const periodAStart = new Date(now - periodAMs);

  // Period B: the equivalent period before A (e.g. 7-14d ago)
  const periodBEnd = new Date(now - periodAMs);
  const periodBStart = new Date(now - periodAMs - periodBMs);

  const buildPeriodSummary = async (
    start: Date,
    end: Date,
  ): Promise<PeriodSummary> => {
    const wherePost: Record<string, unknown> = {
      fetchedAt: { gte: start, lt: end },
    };
    if (params.subreddit) {
      wherePost.subreddit = params.subreddit;
    }

    const posts = await ctx.db.post.findMany({
      where: wherePost,
      select: { id: true, subreddit: true, score: true },
    });

    // Count by subreddit
    const subCounts = new Map<string, number>();
    let totalScore = 0;
    for (const p of posts) {
      subCounts.set(p.subreddit, (subCounts.get(p.subreddit) ?? 0) + 1);
      totalScore += p.score;
    }
    const topSubreddits = Array.from(subCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Get topics for posts in this period
    const topicData = await ctx.db.postTopic.findMany({
      where: {
        post: wherePost,
      },
      include: { topic: { select: { name: true } } },
    });

    const topicCounts = new Map<string, number>();
    for (const pt of topicData) {
      topicCounts.set(
        pt.topic.name,
        (topicCounts.get(pt.topic.name) ?? 0) + 1,
      );
    }
    const topTopics = Array.from(topicCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      postCount: posts.length,
      topSubreddits,
      topTopics,
      avgScore: posts.length > 0 ? Math.round(totalScore / posts.length) : 0,
    };
  };

  const [periodASummary, periodBSummary] = await Promise.all([
    buildPeriodSummary(periodAStart, periodAEnd),
    buildPeriodSummary(periodBStart, periodBEnd),
  ]);

  // Compare topics
  const topicsA = new Set(periodASummary.topTopics.map((t) => t.name));
  const topicsB = new Set(periodBSummary.topTopics.map((t) => t.name));
  const newTopics = [...topicsA].filter((t) => !topicsB.has(t));
  const droppedTopics = [...topicsB].filter((t) => !topicsA.has(t));

  const volumeChange =
    periodBSummary.postCount > 0
      ? Math.round(
          ((periodASummary.postCount - periodBSummary.postCount) /
            periodBSummary.postCount) *
            100,
        )
      : periodASummary.postCount > 0
        ? 100
        : 0;

  return {
    periodA: periodASummary,
    periodB: periodBSummary,
    newTopics,
    droppedTopics,
    volumeChange,
  };
};
