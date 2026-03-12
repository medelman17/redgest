import type { HandlerContext } from "../context.js";
import type {
  DigestView,
  PostView,
  RunView,
  SubredditView,
  Config,
  Digest,
  Post,
} from "@redgest/db";

/** Default page size for paginated queries. */
export const DEFAULT_PAGE_SIZE = 10;

/** Paginated result wrapper. */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * LlmMetrics — aggregated LLM usage statistics.
 */
export interface LlmTaskMetrics {
  task: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  avgDurationMs: number;
  cacheHitRate: number;
}

export interface LlmMetrics {
  summary: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    averageDurationMs: number;
    cacheHitRate: number;
  };
  byTask: LlmTaskMetrics[];
}

/**
 * Per-subreddit step completion detail.
 */
export interface SubredditStepDetail {
  subreddit: string;
  count: number;
  completedAt: string;
}

/**
 * Step-level breakdown of a pipeline run.
 */
export interface RunStatusSteps {
  fetch: SubredditStepDetail[];
  triage: SubredditStepDetail[];
  summarize: SubredditStepDetail[];
  assemble: {
    status: "pending" | "completed";
    digestId?: string;
    completedAt?: string;
  };
}

/**
 * Structured error with step and subreddit context.
 */
export interface StructuredError {
  step: string;
  subreddit?: string;
  message: string;
}

/**
 * Enriched run status with per-step breakdown and structured errors.
 */
export type RunStatusDetail = RunView & {
  steps: RunStatusSteps;
  structuredErrors: StructuredError[];
};

/**
 * ComparisonPost — minimal post metadata for digest comparison.
 */
export interface ComparisonPost {
  postId: string;
  redditId: string;
  title: string;
  subreddit: string;
  score: number;
}

/**
 * SubredditDelta — per-subreddit post count change between two digests.
 */
export interface SubredditDelta {
  subreddit: string;
  countA: number;
  countB: number;
  delta: number;
}

/**
 * DigestSummaryInfo — lightweight digest metadata for comparison.
 */
export interface DigestSummaryInfo {
  id: string;
  createdAt: string;
  postCount: number;
  subreddits: string[];
}

/**
 * DigestComparisonResult — full comparison between two digests.
 */
export interface DigestComparisonResult {
  digestA: DigestSummaryInfo;
  digestB: DigestSummaryInfo;
  overlap: { count: number; percentage: number; posts: ComparisonPost[] };
  added: { count: number; posts: ComparisonPost[] };
  removed: { count: number; posts: ComparisonPost[] };
  subredditDeltas: SubredditDelta[];
}

/**
 * QueryMap — all queries the system accepts.
 * Each key is a query name, value is the params type.
 */
export interface QueryMap {
  GetDigest: { digestId: string };
  GetDigestByJobId: { jobId: string };
  GetPost: { postId: string };
  GetRunStatus: { jobId: string };
  ListDigests: { limit?: number; cursor?: string };
  ListRuns: { limit?: number; cursor?: string };
  ListSubreddits: Record<string, never>;
  GetConfig: Record<string, never>;
  SearchPosts: { query: string; limit?: number; cursor?: string };
  SearchDigests: { query: string; limit?: number; cursor?: string };
  GetLlmMetrics: { jobId?: string; limit?: number };
  GetSubredditStats: { name?: string };
  CompareDigests: { digestIdA: string; digestIdB: string; subreddit?: string };
}

/**
 * QueryResultMap — concrete return types for each query.
 * Uses Prisma view models where available, table models for search/config.
 */
export interface QueryResultMap {
  GetDigest: DigestView | null;
  GetDigestByJobId: DigestView | null;
  GetPost: PostView | null;
  GetRunStatus: RunStatusDetail | null;
  ListDigests: Paginated<DigestView>;
  ListRuns: Paginated<RunView>;
  ListSubreddits: SubredditView[];
  GetConfig: Config | null;
  SearchPosts: Paginated<Post>;
  SearchDigests: Paginated<Digest>;
  GetLlmMetrics: LlmMetrics;
  GetSubredditStats: SubredditView[];
  CompareDigests: DigestComparisonResult;
}

// Derived types
export type QueryType = keyof QueryMap;

export type Query = {
  [K in QueryType]: { type: K; params: QueryMap[K] };
}[QueryType];

export type QueryHandler<K extends QueryType> = (
  params: QueryMap[K],
  ctx: HandlerContext,
) => Promise<QueryResultMap[K]>;
