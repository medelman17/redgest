import type {
  TriagePostCandidate,
  SummarizationComment,
} from "@redgest/llm";

const CHARS_PER_TOKEN = 3.5;
const TRUNCATION_MARKER = "\n\n[truncated]";

export const TRIAGE_TOKEN_BUDGET = 8_000;
export const SUMMARIZATION_TOKEN_BUDGET = 9_700;

/** Estimate token count from text length. Conservative (overestimates ~12%). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Truncate text to fit within a token budget, appending a marker. */
export function truncateText(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  if (text.length <= maxChars) return text;
  const markerLen = TRUNCATION_MARKER.length;
  return text.slice(0, maxChars - markerLen) + TRUNCATION_MARKER;
}

/**
 * Apply triage token budget to candidate posts.
 * Truncates selftext of each candidate to fit all candidates within budget.
 * Metadata (title, scores) is preserved; only selftext is truncated.
 */
export function applyTriageBudget(
  candidates: TriagePostCandidate[],
  maxTokens: number = TRIAGE_TOKEN_BUDGET,
): TriagePostCandidate[] {
  if (candidates.length === 0) return [];

  // ~50 tokens per candidate for title, scores, etc.
  const metadataTokensPerPost = 50;
  const totalMetadata = metadataTokensPerPost * candidates.length;
  const selftextBudget = maxTokens - totalMetadata;

  if (selftextBudget <= 0) {
    return candidates.map((c) => ({ ...c, selftext: "" }));
  }

  const perPostBudget = Math.floor(selftextBudget / candidates.length);

  return candidates.map((c) => ({
    ...c,
    selftext: truncateText(c.selftext, perPostBudget),
  }));
}

/**
 * Apply summarization token budget with comments-first truncation (ADR-011).
 *
 * 1. Preserve post body (title + selftext)
 * 2. Remove lowest-score comments first until under budget
 * 3. If still over, truncate post selftext from the end
 */
export function applySummarizationBudget(
  postSelftext: string,
  comments: SummarizationComment[],
  maxTokens: number = SUMMARIZATION_TOKEN_BUDGET,
): { selftext: string; comments: SummarizationComment[] } {
  const postTokens = estimateTokens(postSelftext);
  const commentEntries = comments.map((c) => ({
    comment: c,
    tokens: estimateTokens(c.body) + estimateTokens(c.author) + 10,
  }));

  const totalTokens =
    postTokens + commentEntries.reduce((sum, e) => sum + e.tokens, 0);

  if (totalTokens <= maxTokens) {
    return { selftext: postSelftext, comments };
  }

  // Sort by score ascending (lowest first) for removal priority
  const sorted = [...commentEntries].sort(
    (a, b) => a.comment.score - b.comment.score,
  );

  let currentTokens = totalTokens;
  let removeCount = 0;

  // Remove lowest-score comments until under budget
  for (const entry of sorted) {
    if (currentTokens <= maxTokens) break;
    currentTokens -= entry.tokens;
    removeCount++;
  }

  const keptComments = sorted.slice(removeCount).map((e) => e.comment);

  // If still over budget after removing comments, truncate post selftext
  let selftext = postSelftext;
  if (currentTokens > maxTokens) {
    const excessTokens = currentTokens - maxTokens;
    const newPostBudget = Math.max(0, postTokens - excessTokens);
    selftext = truncateText(postSelftext, newPostBudget);
  }

  return { selftext, comments: keptComments };
}
