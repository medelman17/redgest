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
}

/**
 * QueryResultMap — concrete return types for each query.
 * Uses Prisma view models where available, table models for search/config.
 */
export interface QueryResultMap {
  GetDigest: DigestView | null;
  GetDigestByJobId: DigestView | null;
  GetPost: PostView | null;
  GetRunStatus: RunView | null;
  ListDigests: Paginated<DigestView>;
  ListRuns: Paginated<RunView>;
  ListSubreddits: SubredditView[];
  GetConfig: Config | null;
  SearchPosts: Paginated<Post>;
  SearchDigests: Paginated<Digest>;
  GetLlmMetrics: LlmMetrics;
  GetSubredditStats: SubredditView[];
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
