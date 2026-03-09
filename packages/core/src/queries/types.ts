import type { HandlerContext } from "../context.js";

/**
 * QueryMap — all queries the system accepts.
 * Each key is a query name, value is the params type.
 */
export interface QueryMap {
  GetDigest: { digestId: string };
  GetPost: { postId: string };
  GetRunStatus: { jobId: string };
  ListDigests: { limit?: number };
  ListRuns: { limit?: number };
  ListSubreddits: Record<string, never>;
  GetConfig: Record<string, never>;
  SearchPosts: { query: string; limit?: number };
  SearchDigests: { query: string; limit?: number };
}

/**
 * QueryResultMap — placeholder return types for each query.
 * Sprint 4 will refine these with Prisma-generated types.
 */
export interface QueryResultMap {
  GetDigest: unknown;
  GetPost: unknown;
  GetRunStatus: unknown;
  ListDigests: unknown;
  ListRuns: unknown;
  ListSubreddits: unknown;
  GetConfig: unknown;
  SearchPosts: unknown;
  SearchDigests: unknown;
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
