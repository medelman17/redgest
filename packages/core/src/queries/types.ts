import type { HandlerContext } from "../context.js";
import type {
  DigestView,
  PostView,
  RunView,
  SubredditView,
  Config,
} from "@redgest/db";
import type { SearchResult } from "../search/index.js";

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
 * DeliveryStatusChannel — per-channel delivery outcome.
 */
export interface DeliveryStatusChannel {
  channel: "EMAIL" | "SLACK";
  status: "PENDING" | "SENT" | "FAILED";
  error: string | null;
  externalId: string | null;
  sentAt: string | null;
}

/**
 * DeliveryStatusDigest — delivery status for a single digest.
 */
export interface DeliveryStatusDigest {
  digestId: string;
  digestCreatedAt: string;
  jobId: string;
  channels: DeliveryStatusChannel[];
}

/**
 * DeliveryStatusResult — delivery status across one or more digests.
 */
export interface DeliveryStatusResult {
  digests: DeliveryStatusDigest[];
}

/**
 * TrendingTopic — a topic with frequency and recency data.
 */
export interface TrendingTopic {
  name: string;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  recentPostCount: number;
}

/**
 * PeriodSummary — aggregated stats for a time period.
 */
export interface PeriodSummary {
  startDate: string;
  endDate: string;
  postCount: number;
  topSubreddits: Array<{ name: string; count: number }>;
  topTopics: Array<{ name: string; count: number }>;
  avgScore: number;
}

/**
 * PeriodComparisonResult — comparison between two time periods.
 */
export interface PeriodComparisonResult {
  periodA: PeriodSummary;
  periodB: PeriodSummary;
  newTopics: string[];
  droppedTopics: string[];
  /** Percentage change in post volume (positive = more recent period has more posts). */
  volumeChange: number;
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
  SearchPosts: { query: string; subreddit?: string; since?: string; sentiment?: string; minScore?: number; limit?: number };
  SearchDigests: { query: string; subreddit?: string; since?: string; limit?: number };
  FindSimilar: { postId: string; limit?: number; subreddit?: string };
  AskHistory: { question: string; limit?: number; subreddit?: string; since?: string };
  GetLlmMetrics: { jobId?: string; limit?: number };
  GetSubredditStats: { name?: string };
  CompareDigests: { digestIdA: string; digestIdB: string; subreddit?: string };
  GetDeliveryStatus: { digestId?: string; limit?: number };
  GetTrendingTopics: { limit?: number; since?: string; subreddit?: string };
  ComparePeriods: { periodA: string; periodB: string; subreddit?: string };
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
  SearchPosts: SearchResult[];
  SearchDigests: SearchResult[];
  FindSimilar: SearchResult[];
  AskHistory: SearchResult[];
  GetLlmMetrics: LlmMetrics;
  GetSubredditStats: SubredditView[];
  CompareDigests: DigestComparisonResult;
  GetDeliveryStatus: DeliveryStatusResult;
  GetTrendingTopics: TrendingTopic[];
  ComparePeriods: PeriodComparisonResult;
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
