import type { PrismaClient } from "@redgest/db";
import type { PostSummary } from "./types.js";

const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "were",
  "they",
  "their",
  "about",
  "would",
  "could",
  "should",
  "which",
  "there",
  "these",
  "those",
  "what",
  "when",
  "where",
  "while",
  "also",
  "into",
  "more",
  "than",
  "then",
  "them",
  "some",
  "such",
  "very",
  "just",
  "will",
  "each",
  "make",
  "like",
  "does",
  "most",
  "many",
  "much",
  "other",
  "over",
  "only",
  "after",
  "before",
  "between",
  "being",
  "both",
  "same",
  "your",
]);

/**
 * Extract topic keywords from a summary using simple word-frequency heuristics.
 * Returns up to 5 topic names derived from summary text and key takeaways.
 * Phase 3 baseline — can be upgraded to LLM-based extraction later.
 */
function extractTopicNames(summary: PostSummary): string[] {
  const text = [summary.summary, ...summary.keyTakeaways, summary.insightNotes]
    .join(" ");

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const freq = new Map<string, number>();
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * Extract topics from a post summary and upsert into topics/post_topics tables.
 * Best-effort — failures are logged but do not block the pipeline.
 */
export async function topicStep(
  postId: string,
  summary: PostSummary,
  db: PrismaClient,
): Promise<void> {
  const topicNames = extractTopicNames(summary);
  if (topicNames.length === 0) return;

  const now = new Date();

  // Batch all upserts in a single transaction to reduce round-trips
  await db.$transaction(
    topicNames.map((name) =>
      db.topic.upsert({
        where: { name },
        create: { name, firstSeen: now, lastSeen: now, frequency: 1 },
        update: { lastSeen: now, frequency: { increment: 1 } },
      }),
    ),
  );

  // Now link topics to post (need topic IDs from above)
  const topics = await db.topic.findMany({
    where: { name: { in: topicNames } },
    select: { id: true, name: true },
  });

  await db.$transaction(
    topics.map((topic) =>
      db.postTopic.upsert({
        where: { postId_topicId: { postId, topicId: topic.id } },
        create: { postId, topicId: topic.id, relevance: 1.0 },
        update: {},
      }),
    ),
  );
}
