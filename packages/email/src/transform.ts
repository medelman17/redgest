import type { DigestDeliveryData, FormattedDigest } from "./types.js";

/**
 * Input type for buildDeliveryData.
 * Mirrors the Prisma query shape from deliver-digest without importing @redgest/db.
 * If schema changes affect DigestPost, Post, or PostSummary, update this type.
 */
export interface DigestWithRelations {
  id: string;
  createdAt: Date;
  digestPosts: Array<{
    rank: number;
    subreddit: string;
    post: {
      title: string;
      permalink: string;
      score: number;
      summaries: Array<{
        summary: string;
        keyTakeaways: unknown;
        insightNotes: string;
        commentHighlights: unknown;
      }>;
    };
  }>;
}

/**
 * Transform a Prisma digest with full relations into the delivery data shape
 * used by both email and Slack rendering. Posts are grouped by subreddit.
 * Posts without summaries are skipped.
 */
export function buildDeliveryData(
  digest: DigestWithRelations,
): DigestDeliveryData {
  const subredditMap = new Map<
    string,
    DigestDeliveryData["subreddits"][number]
  >();

  for (const dp of digest.digestPosts) {
    const summary = dp.post.summaries[0];
    if (!summary) continue;

    let sub = subredditMap.get(dp.subreddit);
    if (!sub) {
      sub = { name: dp.subreddit, posts: [] };
      subredditMap.set(dp.subreddit, sub);
    }

    const keyTakeaways: string[] =
      summary.keyTakeaways == null
        ? []
        : typeof summary.keyTakeaways === "string"
          ? (JSON.parse(summary.keyTakeaways) as string[])
          : (summary.keyTakeaways as string[]);

    const commentHighlights: Array<{
      author: string;
      insight: string;
      score: number;
    }> =
      summary.commentHighlights == null
        ? []
        : typeof summary.commentHighlights === "string"
          ? (JSON.parse(summary.commentHighlights) as Array<{
              author: string;
              insight: string;
              score: number;
            }>)
          : (summary.commentHighlights as Array<{
              author: string;
              insight: string;
              score: number;
            }>);

    sub.posts.push({
      title: dp.post.title,
      permalink: dp.post.permalink,
      score: dp.post.score,
      summary: summary.summary,
      keyTakeaways,
      insightNotes: summary.insightNotes,
      commentHighlights,
    });
  }

  return {
    digestId: digest.id,
    createdAt: digest.createdAt,
    subreddits: Array.from(subredditMap.values()),
  };
}

/**
 * Merge LLM-generated prose with post links from DigestDeliveryData
 * to produce the FormattedDigest consumed by email/Slack templates.
 */
export function buildFormattedDigest(
  data: DigestDeliveryData,
  prose: { headline: string; sections: Array<{ subreddit: string; body: string }> },
): FormattedDigest {
  return {
    createdAt: data.createdAt,
    headline: prose.headline,
    sections: prose.sections.map((s) => {
      const sub = data.subreddits.find((sub) => sub.name === s.subreddit);
      return {
        subreddit: s.subreddit,
        body: s.body,
        posts: (sub?.posts ?? []).map((p) => ({
          title: p.title,
          permalink: p.permalink,
          score: p.score,
        })),
      };
    }),
  };
}
