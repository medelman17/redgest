import type {
  TriagePostCandidate,
  TriageResult,
  PostSummary,
  SummarizationPost,
  SummarizationComment,
} from "@redgest/llm";
import type { LanguageModel } from "ai";

/**
 * Fake triage: selects ALL posts (no filtering).
 * Returns them in order with ascending relevance scores.
 */
export async function fakeGenerateTriageResult(
  posts: TriagePostCandidate[],
  _insightPrompts: string[],
  _targetCount: number,
  _model?: LanguageModel,
): Promise<{ data: TriageResult; log: null }> {
  return {
    data: {
      selectedPosts: posts.map((p, i) => ({
        index: p.index,
        relevanceScore: 5 + i,
        rationale: `Test rationale for post "${p.title}"`,
      })),
    },
    log: null,
  };
}

/**
 * Fake summary: returns deterministic summary based on input post title.
 */
export async function fakeGeneratePostSummary(
  post: SummarizationPost,
  _comments: SummarizationComment[],
  _insightPrompts: string[],
  _model?: LanguageModel,
): Promise<{ data: PostSummary; log: null }> {
  return {
    data: {
      summary: `Summary of "${post.title}" by ${post.author} in r/${post.subreddit}.`,
      keyTakeaways: [
        `Key point 1 from ${post.title}`,
        `Key point 2 from ${post.title}`,
        `Key point 3 from ${post.title}`,
      ],
      insightNotes: `Insight notes for "${post.title}". Relevant to configured interests.`,
      communityConsensus: `Comments generally agree on the points in "${post.title}".`,
      commentHighlights: [
        { author: "commenter", insight: "Notable comment insight", score: 25 },
      ],
      sentiment: "positive",
      relevanceScore: 7,
      contentType: "text",
      notableLinks: [],
    },
    log: null,
  };
}
