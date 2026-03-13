import type { PrismaClient } from "@redgest/db";
import { Prisma } from "@redgest/db";
import { z } from "zod";
import { RawSearchRowSchema } from "./schemas.js";
import type { SearchOptions, SearchResult, SearchService } from "./types.js";

const DEFAULT_LIMIT = 10;
const RRF_K = 60; // Reciprocal Rank Fusion constant

function toSearchResult(row: z.infer<typeof RawSearchRowSchema>): SearchResult {
  return {
    postId: row.post_id,
    redditId: row.reddit_id,
    subreddit: row.subreddit,
    title: row.title,
    score: row.score,
    summarySnippet: row.summary_snippet,
    matchHighlights: [],
    relevanceRank: row.rank,
    sentiment: row.sentiment,
    digestId: row.digest_id,
    digestDate: row.digest_date,
  };
}

function buildWhereClause(options: SearchOptions): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [];
  if (options.subreddit) {
    clauses.push(Prisma.sql`p.subreddit = ${options.subreddit}`);
  }
  if (options.since) {
    clauses.push(Prisma.sql`p.fetched_at >= ${options.since}`);
  }
  if (options.sentiment) {
    clauses.push(Prisma.sql`ps.sentiment = ${options.sentiment}`);
  }
  if (options.minScore != null) {
    clauses.push(Prisma.sql`p.score >= ${options.minScore}`);
  }
  return clauses;
}

function combineWhere(base: Prisma.Sql, extra: Prisma.Sql[]): Prisma.Sql {
  if (extra.length === 0) return base;
  return Prisma.sql`${base} AND ${Prisma.join(extra, " AND ")}`;
}

export function createSearchService(db: PrismaClient): SearchService {
  return {
    async searchByKeyword(
      query: string,
      options: SearchOptions = {},
    ): Promise<SearchResult[]> {
      const limit = options.limit ?? DEFAULT_LIMIT;
      const offset = options.offset ?? 0;
      const tsquery = Prisma.sql`plainto_tsquery('english', ${query})`;

      const whereClauses = buildWhereClause(options);
      const baseWhere = Prisma.sql`p.search_vector @@ ${tsquery}`;
      const fullWhere = combineWhere(baseWhere, whereClauses);

      const rows = await db.$queryRaw`
        SELECT
          p.id::text AS post_id,
          p.reddit_id AS reddit_id,
          p.subreddit,
          p.title,
          p.score,
          LEFT(ps.summary, 200) AS summary_snippet,
          ts_rank_cd(p.search_vector, ${tsquery})::float8 AS rank,
          ps.sentiment,
          latest_dp.digest_id::text AS digest_id,
          latest_dp.digest_date AS digest_date
        FROM posts p
        LEFT JOIN LATERAL (
          SELECT ps2.summary, ps2.sentiment
          FROM post_summaries ps2
          WHERE ps2.post_id = p.id
          ORDER BY ps2.created_at DESC LIMIT 1
        ) ps ON true
        LEFT JOIN LATERAL (
          SELECT dp2.digest_id, d2.created_at AS digest_date
          FROM digest_posts dp2
          JOIN digests d2 ON d2.id = dp2.digest_id
          WHERE dp2.post_id = p.id
          ORDER BY d2.created_at DESC LIMIT 1
        ) latest_dp ON true
        WHERE ${fullWhere}
        ORDER BY rank DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const parsed = z.array(RawSearchRowSchema).parse(rows);
      return parsed.map(toSearchResult);
    },

    async searchBySimilarity(
      embedding: number[],
      options: SearchOptions = {},
    ): Promise<SearchResult[]> {
      const limit = options.limit ?? DEFAULT_LIMIT;
      const offset = options.offset ?? 0;
      const vecStr = `[${embedding.join(",")}]`;

      const whereClauses = buildWhereClause(options);
      const baseWhere = Prisma.sql`ps.embedding IS NOT NULL`;
      const fullWhere = combineWhere(baseWhere, whereClauses);

      const rows = await db.$queryRaw`
        SELECT
          p.id::text AS post_id,
          p.reddit_id AS reddit_id,
          p.subreddit,
          p.title,
          p.score,
          LEFT(ps.summary, 200) AS summary_snippet,
          (1 - (ps.embedding <=> ${vecStr}::vector))::float8 AS rank,
          ps.sentiment,
          latest_dp.digest_id::text AS digest_id,
          latest_dp.digest_date AS digest_date
        FROM post_summaries ps
        JOIN posts p ON p.id = ps.post_id
        LEFT JOIN LATERAL (
          SELECT dp2.digest_id, d2.created_at AS digest_date
          FROM digest_posts dp2
          JOIN digests d2 ON d2.id = dp2.digest_id
          WHERE dp2.post_id = p.id
          ORDER BY d2.created_at DESC LIMIT 1
        ) latest_dp ON true
        WHERE ${fullWhere}
        ORDER BY ps.embedding <=> ${vecStr}::vector ASC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const parsed = z.array(RawSearchRowSchema).parse(rows);
      return parsed.map(toSearchResult);
    },

    async findSimilar(
      postId: string,
      options: SearchOptions = {},
    ): Promise<SearchResult[]> {
      const limit = options.limit ?? 5;

      // Guard: verify source post has an embedding before computing similarity
      const sourceCheck = await db.$queryRaw<Array<{ has_embedding: boolean }>>`
        SELECT EXISTS(
          SELECT 1 FROM post_summaries WHERE post_id = ${postId} AND embedding IS NOT NULL
        ) AS has_embedding
      `;
      const check = sourceCheck[0];
      if (!check || !check.has_embedding) return [];

      const whereClauses = buildWhereClause(options);
      // Exclude the source post itself
      const baseWhere = Prisma.sql`ps.embedding IS NOT NULL AND p.id != ${postId}`;
      const fullWhere = combineWhere(baseWhere, whereClauses);

      const rows = await db.$queryRaw`
        SELECT
          p.id::text AS post_id,
          p.reddit_id AS reddit_id,
          p.subreddit,
          p.title,
          p.score,
          LEFT(ps.summary, 200) AS summary_snippet,
          (1 - (ps.embedding <=> (
            SELECT ps2.embedding FROM post_summaries ps2
            WHERE ps2.post_id = ${postId}
            ORDER BY ps2.created_at DESC LIMIT 1
          )))::float8 AS rank,
          ps.sentiment,
          latest_dp.digest_id::text AS digest_id,
          latest_dp.digest_date AS digest_date
        FROM post_summaries ps
        JOIN posts p ON p.id = ps.post_id
        LEFT JOIN LATERAL (
          SELECT dp2.digest_id, d2.created_at AS digest_date
          FROM digest_posts dp2
          JOIN digests d2 ON d2.id = dp2.digest_id
          WHERE dp2.post_id = p.id
          ORDER BY d2.created_at DESC LIMIT 1
        ) latest_dp ON true
        WHERE ${fullWhere}
        ORDER BY rank DESC
        LIMIT ${limit}
      `;

      const parsed = z.array(RawSearchRowSchema).parse(rows);
      return parsed.map(toSearchResult);
    },

    async searchHybrid(
      query: string,
      queryEmbedding: number[],
      options: SearchOptions = {},
    ): Promise<SearchResult[]> {
      const limit = options.limit ?? DEFAULT_LIMIT;

      // Fetch both result sets
      const [keywordResults, semanticResults] = await Promise.all([
        this.searchByKeyword(query, { ...options, limit: limit * 2 }),
        queryEmbedding.length > 0
          ? this.searchBySimilarity(queryEmbedding, { ...options, limit: limit * 2 })
          : Promise.resolve([]),
      ]);

      // If only one signal, return it directly
      if (semanticResults.length === 0) return keywordResults.slice(0, limit);
      if (keywordResults.length === 0) return semanticResults.slice(0, limit);

      // Reciprocal Rank Fusion
      const scoreMap = new Map<string, { score: number; result: SearchResult }>();

      keywordResults.forEach((r, i) => {
        const rrfScore = 1 / (RRF_K + i + 1);
        const existing = scoreMap.get(r.postId);
        if (existing) {
          existing.score += rrfScore;
        } else {
          scoreMap.set(r.postId, { score: rrfScore, result: r });
        }
      });

      semanticResults.forEach((r, i) => {
        const rrfScore = 1 / (RRF_K + i + 1);
        const existing = scoreMap.get(r.postId);
        if (existing) {
          existing.score += rrfScore;
        } else {
          scoreMap.set(r.postId, { score: rrfScore, result: r });
        }
      });

      return Array.from(scoreMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ result, score }) => ({
          ...result,
          relevanceRank: score,
        }));
    },
  };
}
