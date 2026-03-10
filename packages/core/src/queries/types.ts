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

/**
 * QueryMap — all queries the system accepts.
 * Each key is a query name, value is the params type.
 */
export interface QueryMap {
  GetDigest: { digestId: string };
  GetDigestByJobId: { jobId: string };
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
 * QueryResultMap — concrete return types for each query.
 * Uses Prisma view models where available, table models for search/config.
 */
export interface QueryResultMap {
  GetDigest: DigestView | null;
  GetDigestByJobId: DigestView | null;
  GetPost: PostView | null;
  GetRunStatus: RunView | null;
  ListDigests: DigestView[];
  ListRuns: RunView[];
  ListSubreddits: SubredditView[];
  GetConfig: Config | null;
  SearchPosts: Post[];
  SearchDigests: Digest[];
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
