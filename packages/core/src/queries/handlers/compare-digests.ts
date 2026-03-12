import { RedgestError } from "../../errors.js";
import type { QueryHandler, ComparisonPost, DigestComparisonResult } from "../types.js";

interface DigestPostRow {
  rank: number;
  subreddit: string;
  post: {
    id: string;
    redditId: string;
    title: string;
    subreddit: string;
    score: number;
  };
}

interface DigestWithPosts {
  id: string;
  createdAt: Date;
  digestPosts: DigestPostRow[];
}

function toComparisonPost(dp: DigestPostRow): ComparisonPost {
  return {
    postId: dp.post.id,
    redditId: dp.post.redditId,
    title: dp.post.title,
    subreddit: dp.post.subreddit,
    score: dp.post.score,
  };
}

export const handleCompareDigests: QueryHandler<"CompareDigests"> = async (
  params,
  ctx,
) => {
  const includeShape = {
    digestPosts: {
      orderBy: { rank: "asc" as const },
      include: { post: true },
    },
  };

  const [rawA, rawB] = await Promise.all([
    ctx.db.digest.findUnique({ where: { id: params.digestIdA }, include: includeShape }),
    ctx.db.digest.findUnique({ where: { id: params.digestIdB }, include: includeShape }),
  ]);

  if (!rawA) {
    throw new RedgestError("NOT_FOUND", `Digest ${params.digestIdA} not found`);
  }
  if (!rawB) {
    throw new RedgestError("NOT_FOUND", `Digest ${params.digestIdB} not found`);
  }

  const digestA = rawA as DigestWithPosts;
  const digestB = rawB as DigestWithPosts;

  // Apply subreddit filter if provided
  const filter = params.subreddit?.toLowerCase();
  const postsA = filter
    ? digestA.digestPosts.filter((dp) => dp.subreddit.toLowerCase() === filter)
    : digestA.digestPosts;
  const postsB = filter
    ? digestB.digestPosts.filter((dp) => dp.subreddit.toLowerCase() === filter)
    : digestB.digestPosts;

  // Build sets by redditId
  const setA = new Set(postsA.map((dp) => dp.post.redditId));
  const setB = new Set(postsB.map((dp) => dp.post.redditId));

  // Compute overlap, added, removed
  const overlapPosts = postsB.filter((dp) => setA.has(dp.post.redditId));
  const addedPosts = postsB.filter((dp) => !setA.has(dp.post.redditId));
  const removedPosts = postsA.filter((dp) => !setB.has(dp.post.redditId));

  // Overlap percentage: fraction of A's posts that survived into B
  const percentage = postsA.length > 0
    ? (overlapPosts.length / postsA.length) * 100
    : 0;

  // Subreddit deltas
  const allSubreddits = new Set([
    ...postsA.map((dp) => dp.subreddit),
    ...postsB.map((dp) => dp.subreddit),
  ]);
  const subredditDeltas = [...allSubreddits].sort().map((sub) => {
    const countA = postsA.filter((dp) => dp.subreddit === sub).length;
    const countB = postsB.filter((dp) => dp.subreddit === sub).length;
    return { subreddit: sub, countA, countB, delta: countB - countA };
  });

  // Unique sorted subreddit lists
  const subredditsA = [...new Set(postsA.map((dp) => dp.subreddit))].sort();
  const subredditsB = [...new Set(postsB.map((dp) => dp.subreddit))].sort();

  const result: DigestComparisonResult = {
    digestA: {
      id: digestA.id,
      createdAt: digestA.createdAt.toISOString(),
      postCount: postsA.length,
      subreddits: subredditsA,
    },
    digestB: {
      id: digestB.id,
      createdAt: digestB.createdAt.toISOString(),
      postCount: postsB.length,
      subreddits: subredditsB,
    },
    overlap: {
      count: overlapPosts.length,
      percentage: Math.round(percentage * 100) / 100,
      posts: overlapPosts.map(toComparisonPost),
    },
    added: {
      count: addedPosts.length,
      posts: addedPosts.map(toComparisonPost),
    },
    removed: {
      count: removedPosts.length,
      posts: removedPosts.map(toComparisonPost),
    },
    subredditDeltas,
  };

  return result;
};
