import type { DomainEventBus } from "../events/bus.js";
import type { RedgestConfig } from "@redgest/config";
import type { PrismaClient } from "@redgest/db";
import type { SearchService } from "../search/types.js";

// Re-declared locally to avoid circular dependency (core <-> reddit).
// Structurally identical to the types in @redgest/reddit and @redgest/llm;
// TypeScript structural typing ensures compatibility.

/** Mirrors @redgest/reddit FetchOptions */
export interface FetchOptions {
  sorts: Array<"hot" | "top" | "rising">;
  limit: number;
  timeRange?: "hour" | "day" | "week" | "month" | "year" | "all";
  commentsPerPost: number;
}

/** Mirrors @redgest/reddit RedditPostData (fields we use) */
export interface RedditPostData {
  id: string;
  name: string;
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  link_flair_text: string | null;
  over_18: boolean;
  created_utc: number;
  is_self: boolean;
}

/** Mirrors @redgest/reddit RedditCommentData */
export interface RedditCommentData {
  id: string;
  name: string;
  author: string;
  body: string;
  score: number;
  depth: number;
  created_utc: number;
}

/** Mirrors @redgest/reddit FetchedContent */
export interface FetchedContent {
  subreddit: string;
  posts: Array<{
    post: RedditPostData;
    comments: RedditCommentData[];
  }>;
  fetchedAt: Date;
}

/** Mirrors @redgest/llm ModelConfig */
export interface ModelConfig {
  provider: "anthropic" | "openai";
  model: string;
}

/** Mirrors @redgest/llm PostSummary */
export interface PostSummary {
  summary: string;
  keyTakeaways: string[];
  insightNotes: string;
  communityConsensus: string | null;
  commentHighlights: Array<{
    author: string;
    insight: string;
    score: number;
  }>;
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  relevanceScore: number;
  contentType: "text" | "link" | "image" | "video" | "other";
  notableLinks: string[];
}

/** Abstraction over content sources (Reddit, HN, RSS, etc.) */
export interface ContentSource {
  fetchContent(
    subreddit: string,
    options: FetchOptions,
  ): Promise<FetchedContent>;
}

/** All external dependencies the pipeline needs — injected, not imported. */
export interface PipelineDeps {
  db: PrismaClient;
  eventBus: DomainEventBus;
  /** Content source for live fetching. Optional when using decoupled crawling (selectPostsStep). */
  contentSource?: ContentSource;
  config: RedgestConfig;
  model?: ModelConfig;

  /** Skip fetch cache — always fetch fresh from Reddit. */
  forceRefresh?: boolean;

  /** Override the global max posts for this pipeline run (from generate_digest max_posts param). */
  maxPosts?: number;

  /** Lookback window in hours for selectPostsStep (decoupled crawling mode). Defaults to 24. */
  lookbackHours?: number;

  /** Optional search service for historical context injection during triage. */
  searchService?: SearchService;

  /** Override triage function for testing. */
  generateTriage?: (
    posts: Array<{
      index: number;
      subreddit: string;
      title: string;
      score: number;
      numComments: number;
      createdUtc: number;
      selftext: string;
    }>,
    insightPrompts: string[],
    targetCount: number,
    model?: unknown,
  ) => Promise<{
    data: {
      selectedPosts: Array<{
        index: number;
        relevanceScore: number;
        rationale: string;
      }>;
    };
    log: null;
  }>;

  /** Override summary function for testing. */
  generateSummary?: (
    post: { title: string; subreddit: string; author: string; score: number; selftext: string },
    comments: Array<{ author: string; score: number; body: string }>,
    insightPrompts: string[],
    model?: unknown,
  ) => Promise<{
    data: PostSummary;
    log: null;
  }>;
}

/** Result of fetching + persisting posts from one subreddit. */
export interface FetchStepResult {
  subreddit: string;
  posts: Array<{
    postId: string;
    redditId: string;
    post: RedditPostData;
    comments: RedditCommentData[];
  }>;
  fetchedAt: Date;
  /** True when posts were loaded from DB cache instead of fetched from Reddit. */
  fromCache?: boolean;
}

/** Result of LLM triage — which posts were selected and why. */
export interface TriageStepResult {
  selected: Array<{
    index: number;
    relevanceScore: number;
    rationale: string;
  }>;
}

/** Result of LLM summarization for a single post. */
export interface SummarizeStepResult {
  postSummaryId: string;
  summary: PostSummary;
}

/** Result of assembling the final digest document. */
export interface AssembleStepResult {
  digestId: string;
  contentMarkdown: string;
  postCount: number;
}

/** Aggregated results for one subreddit's pipeline run. */
export interface SubredditPipelineResult {
  subreddit: string;
  posts: Array<{
    postId: string;
    redditId: string;
    title: string;
    summary: PostSummary;
    selectionRationale: string;
  }>;
  error?: string;
}

/** Final pipeline result with status and all subreddit outcomes. */
export interface PipelineResult {
  jobId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELED";
  digestId?: string;
  subredditResults: SubredditPipelineResult[];
  errors: string[];
}
