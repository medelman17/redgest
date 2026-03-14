import type { PrismaClient } from "@redgest/db";
import type { FetchStepResult } from "./types.js";

/**
 * Select posts from the database (already crawled) instead of fetching
 * from the Reddit API. This is the decoupled-crawl counterpart to fetchStep.
 *
 * Returns the same FetchStepResult shape so downstream steps (triage,
 * summarize, assemble) work identically.
 */
export async function selectPostsStep(
  subreddit: { name: string; maxPosts: number; includeNsfw: boolean },
  lookbackHours: number,
  db: PrismaClient,
): Promise<FetchStepResult> {
  const since = new Date(Date.now() - lookbackHours * 3600 * 1000);

  const posts = await db.post.findMany({
    where: {
      subreddit: subreddit.name,
      fetchedAt: { gte: since },
      ...(subreddit.includeNsfw ? {} : { isNsfw: false }),
    },
    orderBy: [{ score: "desc" }, { fetchedAt: "desc" }],
    take: subreddit.maxPosts * 3,
    include: { comments: { orderBy: { score: "desc" }, take: 10 } },
  });

  return {
    subreddit: subreddit.name,
    posts: posts.map((p) => ({
      postId: p.id,
      redditId: p.redditId,
      post: {
        id: p.redditId,
        name: `t3_${p.redditId}`,
        subreddit: p.subreddit,
        title: p.title,
        selftext: p.body ?? "",
        author: p.author,
        score: p.score,
        num_comments: p.commentCount,
        url: p.url,
        permalink: p.permalink,
        link_flair_text: p.flair,
        over_18: p.isNsfw,
        created_utc: p.fetchedAt.getTime() / 1000,
        is_self: true,
      },
      comments: p.comments.map((c) => ({
        id: c.redditId,
        name: `t1_${c.redditId}`,
        author: c.author,
        body: c.body,
        score: c.score,
        depth: c.depth,
        created_utc: c.fetchedAt.getTime() / 1000,
      })),
    })),
    fetchedAt: new Date(),
    fromCache: true,
  };
}
