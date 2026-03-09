import type { PrismaClient } from "@redgest/db";

const DEFAULT_DEDUP_DIGEST_COUNT = 3;

/**
 * Find Reddit post IDs that appeared in the last N digests.
 * These posts should be excluded from the current pipeline run.
 */
export async function findPreviousPostIds(
  db: PrismaClient,
  digestCount: number = DEFAULT_DEDUP_DIGEST_COUNT,
): Promise<Set<string>> {
  const recentDigests = await db.digest.findMany({
    take: digestCount,
    orderBy: { createdAt: "desc" },
    select: {
      digestPosts: {
        select: {
          post: {
            select: { redditId: true },
          },
        },
      },
    },
  });

  const ids = new Set<string>();
  for (const digest of recentDigests) {
    for (const dp of digest.digestPosts) {
      ids.add(dp.post.redditId);
    }
  }
  return ids;
}
