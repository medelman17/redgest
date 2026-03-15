import type {
  TriagePostCandidate,
  TriageResult,
  PostSummary,
  SummarizationPost,
  SummarizationComment,
  DeliveryProse,
  DeliveryDigestInput,
  DeliveryChannel,
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

/**
 * Fake delivery prose: returns deterministic prose based on input subreddits.
 */
export async function fakeGenerateDeliveryProse(
  input: DeliveryDigestInput,
  _channel: DeliveryChannel,
  _model?: LanguageModel,
): Promise<{ data: DeliveryProse; log: null }> {
  return {
    data: {
      headline: `This digest covers ${input.subreddits.length} subreddit${input.subreddits.length === 1 ? "" : "s"} with the latest curated posts.`,
      sections: input.subreddits.map((sub) => ({
        subreddit: sub.name,
        body: `r/${sub.name} featured ${sub.posts.length} post${sub.posts.length === 1 ? "" : "s"}${sub.posts.length > 0 ? `, including "${sub.posts[0]?.title}"` : ""}.`,
      })),
    },
    log: null,
  };
}
