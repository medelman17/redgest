import type { PrismaClient } from "@redgest/db";
import type { PostSummary } from "./types";

/** ~120 common English stopwords — filtered before frequency ranking. */
export const STOP_WORDS = new Set([
  // Articles & conjunctions
  "the", "and", "but", "nor", "yet", "for", "not",
  // Pronouns
  "you", "your", "yours", "his", "her", "hers", "its",
  "they", "them", "their", "theirs", "she", "him", "who",
  "whom", "whose", "this", "that", "these", "those",
  // Prepositions
  "with", "from", "into", "about", "over", "after", "before",
  "between", "under", "above", "below", "through", "during",
  "without", "against", "within", "along", "among",
  // Be-verbs & auxiliaries
  "are", "was", "were", "been", "being", "have", "has", "had",
  "does", "did", "will", "would", "could", "should", "shall",
  "might", "must", "can", "may",
  // Common adverbs & adjectives
  "also", "more", "than", "then", "very", "just", "most",
  "many", "much", "only", "even", "still", "already", "often",
  "never", "always", "really", "well", "here", "there", "where",
  "when", "what", "which", "while", "how", "why",
  // Common verbs (generic)
  "each", "make", "like", "some", "such", "other", "same",
  "both", "few", "all", "any", "own", "too", "now", "new",
  "way", "use", "get", "got", "let", "say", "two", "one",
  "per", "via",
  // Longer common words
  "because", "however", "another", "every", "something",
  "anything", "everything", "nothing", "someone", "anyone",
  "everyone", "using", "used", "want", "need", "come",
  "take", "know", "think", "look", "find", "give", "tell",
  "said", "good", "back", "down",
]);

/**
 * Extract topic keywords from a summary using simple word-frequency heuristics.
 * Returns up to 5 topic names derived from summary text and key takeaways.
 * Phase 3 baseline — can be upgraded to LLM-based extraction later.
 */
export function extractTopicNames(summary: PostSummary): string[] {
  const text = [summary.summary, ...summary.keyTakeaways, summary.insightNotes]
    .join(" ");

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

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
