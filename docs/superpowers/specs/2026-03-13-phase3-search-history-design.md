# Phase 3: Search + Conversational History — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Approach:** Experience-driven (C) — MCP tool contracts drive architecture
**Related Issues:** #29, #30, #31, #32, #33, #34, #35, #36

---

## Motivation

Phase 1+2 delivered a functional digest pipeline with 15 MCP tools, email/Slack delivery, and a config UI. But real-world usage (first-ever live run during this design session) revealed that **search is nearly useless** — `search_posts("prefetch")` returns nothing despite extensive discussion in post bodies and LLM summaries. The LLM-generated content (summaries, takeaways, insight notes) is rich and structured but completely unsearchable.

Phase 3 transforms Redgest from a digest generator into a **conversational knowledge base** by adding full-text search, semantic similarity, topic tracking, and historical context injection.

### Findings from First Live Run

| Query | Result | Root Cause |
|-------|--------|------------|
| `search_posts("CSRF")` | 1 hit | Term in title — LIKE match works |
| `search_posts("prefetch")` | 0 hits | Term in body + summary, not title |
| `search_posts("Server Components")` | 0 hits | Discussed in multiple posts' bodies/summaries |
| `search_digests("security")` | 1 hit | Returns entire markdown blob, not matched posts |

Additional issues discovered:
- No fetch caching — Reddit re-fetched every run (~70s/subreddit)
- DB config `llmProvider`/`llmModel` ignored by pipeline (hardcoded defaults)
- `turbo.json` stripped API keys via strict env mode
- MCP stdio didn't load `.env`
- No in-process delivery path (only Trigger.dev)

---

## MCP Tool Contracts

### Upgraded Existing Tools

#### `search_posts` (replaces LIKE with FTS)

```typescript
// Input
{
  query: string;            // Full-text search query
  subreddit?: string;       // Filter to specific subreddit
  since?: string;           // Duration filter (e.g., "7d")
  sentiment?: string;       // Filter by sentiment
  minScore?: number;        // Minimum Reddit score
  limit?: number;           // Default 10
}

// Output — each result includes match context
{
  items: Array<{
    postId: string;
    redditId: string;
    subreddit: string;
    title: string;
    score: number;
    summarySnippet: string;       // Relevant excerpt from summary
    matchHighlights: string[];    // Why this matched
    relevanceRank: number;        // FTS rank score
    sentiment: string;
    createdAt: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}
```

**Behavior:** Searches across title (weight A), summary + key takeaways (weight B), insight notes + community consensus (weight C), and body + comments (weight D). Results ranked by `ts_rank_cd`. Snippet generation shows the matching context.

#### `search_digests` (per-post matches, not full blob)

```typescript
// Input
{
  query: string;
  since?: string;
  subreddit?: string;
  limit?: number;
}

// Output — matched posts grouped by digest
{
  items: Array<{
    digestId: string;
    digestDate: string;
    matchedPosts: Array<{
      postId: string;
      title: string;
      subreddit: string;
      summarySnippet: string;
      relevanceRank: number;
    }>;
  }>;
}
```

**Behavior:** Searches the same composite tsvector but returns results grouped by digest, showing only matched posts within each digest.

### New Tools

#### `find_similar`

```typescript
// Input
{
  postId: string;           // Find posts similar to this one
  limit?: number;           // Default 5
  subreddit?: string;       // Optional filter (omit for cross-subreddit)
}

// Output
{
  sourcePost: { id: string; title: string; subreddit: string };
  similar: Array<{
    postId: string;
    title: string;
    subreddit: string;
    summarySnippet: string;
    similarity: number;       // 0-1 cosine similarity
    digestDate: string;       // When it appeared in a digest
  }>;
}
```

**Behavior:** Uses embedding cosine similarity on `post_summaries.embedding`. Cross-subreddit by default — surfaces connections between communities.

#### `get_trending_topics`

```typescript
// Input
{
  since?: string;           // Default "7d"
  subreddits?: string[];    // Optional filter
  limit?: number;           // Default 10
}

// Output
{
  topics: Array<{
    name: string;
    frequency: number;          // Appearances across digests
    sentimentTrend: string;     // "stable" | "improving" | "declining" | "volatile"
    subreddits: string[];       // Which subreddits discuss this
    examplePosts: Array<{ postId: string; title: string }>;
    firstSeen: string;
    lastSeen: string;
  }>;
}
```

**Behavior:** Queries the `topics` + `post_topics` tables. Topics are extracted per-digest via a cheap LLM call during pipeline execution.

#### `compare_periods`

```typescript
// Input
{
  period1: string;          // e.g., "7d-14d" (7 to 14 days ago)
  period2: string;          // e.g., "0d-7d" (last 7 days)
  subreddits?: string[];
}

// Output
{
  newTopics: Array<{ name: string; frequency: number; sentiment: string }>;
  goneTopics: Array<{ name: string; lastSeen: string }>;
  changedTopics: Array<{
    name: string;
    period1Sentiment: string;
    period2Sentiment: string;
    frequencyChange: number;    // +/- count
  }>;
  summary: string;              // One-line natural language summary
}
```

**Behavior:** Two-window topic diff. Shows what's new, what disappeared, and what shifted in sentiment or frequency.

#### `ask_history`

```typescript
// Input
{
  question: string;         // Natural language question
  subreddits?: string[];
  since?: string;
}

// Output
{
  relevantPosts: Array<{
    postId: string;
    title: string;
    subreddit: string;
    summarySnippet: string;
    relevanceScore: number;
    digestDate: string;
  }>;
  searchStrategy: string;   // "keyword" | "semantic" | "hybrid"
}
```

**Behavior:** Hybrid search — converts question to both a tsquery (keyword) and an embedding (semantic), combines results via reciprocal rank fusion. Returns relevant posts with context, letting Claude synthesize the answer (composable MCP philosophy — tools return data, Claude reasons).

---

## Data Architecture

### Search Infrastructure

Two search mechanisms, one query layer:

#### Full-Text Search (tsvector + GIN)

A **composite search document** per post that combines all searchable content into one weighted tsvector:

| Weight | Fields | Rationale |
|--------|--------|-----------|
| A (highest) | Post title | Most specific signal |
| B | Summary text, key takeaways | LLM-curated signal |
| C | Insight notes, community consensus* | Contextual analysis |
| D (lowest) | Post body | Raw content, noisy |

> *`communityConsensus` and `sentiment` are currently LLM output fields but **not persisted** as columns in `post_summaries`. The Phase 3 migration must add `community_consensus TEXT` and `sentiment TEXT` columns to `post_summaries` before the trigger can index them. The summarize step must be updated to persist these fields.
>
> **Note:** `sentiment` is intentionally excluded from the tsvector — it's used for **filtering** (WHERE clause), not full-text search. Indexing short categorical values like "positive"/"negative" in tsvector would add noise without improving search quality. Comment content (highlights, bodies) is excluded from the composite vector in Phase 3a for simplicity; it can be added as weight C/D in a future iteration if search recall needs improvement.

Stored as `posts.search_vector` (tsvector) with GIN index. Updated via Postgres trigger whenever a post or its summary changes.

#### Semantic Search (pgvector + HNSW)

Embeddings generated for each **post summary** (not raw posts — summaries are the LLM-curated signal). The embedding input concatenates: summary + key takeaways + insight notes.

- Column: `post_summaries.embedding vector(1536)`
- Index: HNSW with `vector_cosine_ops`
- Model: OpenAI `text-embedding-3-small` (1536 dims, $0.02/1M tokens)
- Generated as post-processing after summarization
- **Requires `OPENAI_API_KEY`** — embedding always uses OpenAI regardless of `llmProvider` config. If no OpenAI key is configured, the embed step is skipped (non-fatal) and semantic search/`find_similar` degrade gracefully to unavailable. `@redgest/config` already has `OPENAI_API_KEY` as optional.

#### Hybrid Search (Reciprocal Rank Fusion)

For `ask_history` and any query that benefits from both keyword and semantic matching:

```
RRF_score(doc) = 1/(k + rank_fts) + 1/(k + rank_semantic)
```

Where `k = 60` (standard constant). Simple, proven, no tuning needed. Both result sets are fetched independently and merged.

### Schema Changes (One Migration)

```sql
-- 1. pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Persist previously-unpersisted summary fields needed for search + filtering
ALTER TABLE post_summaries ADD COLUMN community_consensus TEXT;
ALTER TABLE post_summaries ADD COLUMN sentiment TEXT;

-- 3. Composite tsvector on posts (replaces existing unused textSearch column)
ALTER TABLE posts DROP COLUMN IF EXISTS "textSearch";
ALTER TABLE posts ADD COLUMN search_vector tsvector;
CREATE INDEX posts_search_idx ON posts USING GIN (search_vector);

-- 3. Postgres function + trigger to rebuild search_vector
--    Fires on posts INSERT/UPDATE and post_summaries INSERT/UPDATE
--    Joins post title+body with latest summary fields
-- The trigger function must handle two cases:
-- 1. Fired from posts table: NEW is a post row, use NEW.id
-- 2. Fired from post_summaries table: NEW is a summary row, use NEW.post_id
-- In both cases, join to the LATEST summary (ORDER BY created_at DESC LIMIT 1)
-- to build the composite vector. Uses 'english' text search config explicitly.
-- Note: The UPDATE uses a self-join (posts p) to access column values for
-- tsvector construction. The outer `posts` in `UPDATE posts SET ...` is the
-- target row; the inner `posts p` in the FROM clause provides column values
-- (title, body) for the tsvector expression. This is standard Postgres
-- UPDATE ... FROM ... WHERE syntax — not a redundant join.
CREATE OR REPLACE FUNCTION update_post_search_vector() RETURNS trigger AS $$
DECLARE
  target_post_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    target_post_id := NEW.id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE posts SET search_vector =
    setweight(to_tsvector('english', COALESCE(p.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(s.summary, '') || ' ' || COALESCE(s.key_takeaways_text, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(s.insight_notes, '') || ' ' || COALESCE(s.community_consensus, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(p.body, '')), 'D')
  FROM posts p
  LEFT JOIN LATERAL (
    SELECT ps.summary, ps.insight_notes, ps.community_consensus,
           array_to_string(ps.key_takeaways, '. ') AS key_takeaways_text
    FROM post_summaries ps WHERE ps.post_id = target_post_id
    ORDER BY ps.created_at DESC LIMIT 1
  ) s ON true
  WHERE p.id = target_post_id AND posts.id = target_post_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER posts_search_update
  AFTER INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_post_search_vector();

CREATE TRIGGER summaries_search_update
  AFTER INSERT OR UPDATE ON post_summaries
  FOR EACH ROW EXECUTE FUNCTION update_post_search_vector();

-- 4. Embedding column on post_summaries
ALTER TABLE post_summaries ADD COLUMN embedding vector(1536);
CREATE INDEX summaries_embedding_idx
  ON post_summaries USING hnsw (embedding vector_cosine_ops);

-- 5. Topics tables
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid_v7(),  -- UUID v7 per project convention
  name TEXT NOT NULL UNIQUE,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  frequency INT NOT NULL DEFAULT 1
);

CREATE TABLE post_topics (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  relevance FLOAT NOT NULL DEFAULT 1.0,
  PRIMARY KEY (post_id, topic_id)
);

CREATE INDEX post_topics_topic_idx ON post_topics(topic_id);
```

### Docker Compose Change

```yaml
# Replace postgres image
image: pgvector/pgvector:pg17  # was: postgres:17
```

### SearchService Interface

```typescript
// packages/core/src/search/service.ts
interface SearchService {
  // Full-text keyword search
  searchByKeyword(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  // Semantic similarity search
  searchBySimilarity(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>;

  // Find posts similar to a given post
  findSimilar(postId: string, options?: SearchOptions): Promise<SearchResult[]>;

  // Hybrid search (keyword + semantic, merged via RRF)
  searchHybrid(query: string, queryEmbedding: number[], options?: SearchOptions): Promise<SearchResult[]>;
}

interface SearchOptions {
  subreddit?: string;
  since?: Date;
  sentiment?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
}

interface SearchResult {
  postId: string;
  redditId: string;
  subreddit: string;
  title: string;
  score: number;
  summarySnippet: string;
  matchHighlights: string[];
  relevanceRank: number;
  sentiment: string | null;
  digestId: string | null;
  digestDate: Date | null;
}
```

### CQRS Type Map Changes

The existing `QueryMap` and `QueryResultMap` in `packages/core/src/queries/types.ts` must be updated for upgraded and new tools. The `SearchResult` type from `SearchService` replaces the raw Prisma types for search queries.

#### Updated Entries

```typescript
// QueryMap updates (params)
SearchPosts: {
  query: string;
  subreddit?: string;
  since?: string;
  sentiment?: string;
  minScore?: number;
  limit?: number;
  cursor?: string;
};

SearchDigests: {
  query: string;
  since?: string;
  subreddit?: string;
  limit?: number;
};

// QueryResultMap updates (results)
SearchPosts: Paginated<SearchResult>;  // was: Paginated<Post>

SearchDigests: {                       // was: Paginated<Digest>
  items: Array<{
    digestId: string;
    digestDate: Date;
    matchedPosts: SearchResult[];
  }>;
};
```

#### New Entries

```typescript
// New QueryMap entries
FindSimilar: { postId: string; limit?: number; subreddit?: string };
GetTrendingTopics: { since?: string; subreddits?: string[]; limit?: number };
ComparePeriods: { period1: string; period2: string; subreddits?: string[] };
AskHistory: { question: string; subreddits?: string[]; since?: string };

// New QueryResultMap entries
FindSimilar: {
  sourcePost: { id: string; title: string; subreddit: string };
  similar: SearchResult[];
};
GetTrendingTopics: { topics: TrendingTopic[] };
ComparePeriods: {
  newTopics: TopicSummary[];
  goneTopics: TopicSummary[];
  changedTopics: TopicChange[];
  summary: string;
};
AskHistory: {
  relevantPosts: SearchResult[];
  searchStrategy: "keyword" | "semantic" | "hybrid";
};
```

Each new query needs: handler file in `queries/handlers/`, registration in handlers index, MCP tool Zod schema in `tools.ts`.

### PipelineDeps Extension

Following the existing pattern of optional test doubles:

```typescript
// Added to PipelineDeps
generateEmbedding?: (texts: string[]) => Promise<{
  embeddings: number[][];
  log: LlmCallLog | null;
}>;
```

### Raw Query Type Safety

Search queries use `$queryRaw` since Prisma doesn't support tsvector/pgvector natively. Results are validated through Zod schemas (consistent with project patterns) before being returned as `SearchResult`:

```typescript
const RawSearchResultSchema = z.object({
  post_id: z.string(),
  reddit_id: z.string(),
  subreddit: z.string(),
  title: z.string(),
  score: z.number(),
  summary_snippet: z.string().nullable(),
  rank: z.number(),
  sentiment: z.string().nullable(),
  digest_id: z.string().nullable(),
  digest_date: z.coerce.date().nullable(),
});
```

---

## Pipeline Changes

### Extended Pipeline Flow

```
Existing: fetch → triage → summarize → assemble → done
Phase 3:  fetch → triage → summarize → assemble → embed → extract_topics → done
                                                    ↑           ↑
                                              pgvector      cheap LLM call
                                           (batch embed)   (structured output)
```

### Embed Step

- **Input:** All post summaries from the current run
- **Processing:** For each summary, concatenate `summary + keyTakeaways.join(". ") + insightNotes` into one text block
- **API call:** Batch call to `text-embedding-3-small` (all posts in one request)
- **Output:** Write `embedding` vector to each `post_summaries` row
- **Logging:** Record to `llm_calls` table (task: "embed", model, tokens, duration)
- **Error handling:** Non-fatal — if embedding fails, digest is still complete, search degrades gracefully to keyword-only

### Topic Extraction Step

- **Input:** All summaries + key takeaways from the current run
- **Processing:** One LLM call with structured output: "Extract 5-10 topics from these summaries"
- **Schema:**
  ```typescript
  {
    topics: Array<{
      name: string;           // Canonical topic name
      relatedPosts: number[]; // Indices into the input posts
      sentiment: "positive" | "negative" | "neutral" | "mixed";
    }>
  }
  ```
- **Persistence:** Upsert to `topics` table (increment frequency, update last_seen), insert `post_topics` rows
- **Cost:** ~500 tokens input per post, ~200 tokens output. Negligible.
- **Canonicalization:** The extraction prompt instructs the LLM to check existing topic names first: "Use the most common canonical name. 'Server Components', 'React Server Components', and 'RSC' should all map to 'Server Components'." Before upserting, fuzzy-match against existing topics in the DB to avoid fragmentation.
- **Error handling:** Non-fatal — topic extraction failure doesn't affect digest

### Context Injection

The triage system prompt gets a new optional section (only if topics data exists):

```
## Recent Digest Context
Topics from recent digests for context — use to identify novel angles vs repetition:
- [2026-03-12] Server Components: discussed in r/nextjs (mixed sentiment)
- [2026-03-12] Vercel pricing: discussed in r/nextjs (negative sentiment)
- [2026-03-11] Claude Code workflows: discussed in r/ClaudeAI (positive sentiment)
```

**Token budget:** ~200 tokens for 10 recent topics. Fits within the existing 8K triage budget without adjustment.

**Behavior change:** The triage LLM can now deprioritize already-covered topics (unless there's a new angle) and flag evolving stories.

### Fetch Caching

Add a `last_fetched_at` column to the `subreddits` table (O(1) lookup, no aggregate scan). Updated atomically in the fetch step after successful fetch.

```typescript
const sub = await db.subreddit.findUnique({ where: { id: subId } });
const cacheAge = Date.now() - (sub.lastFetchedAt?.getTime() ?? 0);
const cacheTTL = 15 * 60 * 1000; // 15 minutes, configurable

if (cacheAge < cacheTTL && !options.forceRefresh) {
  // Use posts from DB instead of Reddit API
  posts = await loadPostsFromDB(sub.name, lookbackWindow);
} else {
  posts = await contentSource.fetchContent(sub.name, fetchOptions);
  await db.subreddit.update({
    where: { id: subId },
    data: { lastFetchedAt: new Date() },
  });
}
```

- Default TTL: 15 minutes
- `generate_digest` gets an optional `forceRefresh` boolean parameter
- Dramatically improves dev/test iteration speed

---

## Work Streams

### WS11: Search Infrastructure (8pt)

**Deps:** None | **Unblocks:** WS12, WS13

| Task | Pt | Acceptance Criteria |
|------|----|---------------------|
| pgvector extension + Docker image swap | 0.5 | `pgvector/pgvector:pg17` in docker-compose, `CREATE EXTENSION vector` in migration, existing tests pass |
| Composite tsvector column + GIN index + trigger | 2 | `search_vector` on posts, trigger rebuilds on post/summary changes, `ts_rank_cd` returns ranked results, tested with real data |
| Embedding column + HNSW index on post_summaries | 1 | `vector(1536)` column, HNSW index created, cosine similarity query returns results |
| Topics + post_topics tables | 1 | Schema + migration, CRUD operations work, foreign keys enforced |
| SearchService in @redgest/core | 2 | `searchByKeyword`, `searchBySimilarity`, `findSimilar`, `searchHybrid` methods, RRF fusion, tested with fixtures |
| Backfill script | 1.5 | (1) Populate search_vector for all posts (local, fast), then (2) generate embeddings for existing summaries (API calls, batched with rate limiting). Idempotent — skips already-populated rows. Resumable if interrupted. |

### WS12: MCP Tool Upgrades (5pt)

**Deps:** WS11 | **Unblocks:** Immediate user value

| Task | Pt | Acceptance Criteria |
|------|----|---------------------|
| Upgrade `search_posts` | 1.5 | FTS with ranking, snippet generation, filters (subreddit, since, sentiment, minScore), `search_posts("prefetch")` returns the Vercel post |
| Upgrade `search_digests` | 1 | Returns matched posts within digests (not full blob), grouped by digest date |
| New `find_similar` tool | 1 | Embedding similarity, cross-subreddit results, returns similarity score |
| New `ask_history` tool | 1.5 | Hybrid search, returns relevant posts with citations, `ask_history("What has r/nextjs said about Vercel pricing?")` returns relevant results |

### WS13: Conversational Memory (5pt)

**Deps:** WS11 | **Unblocks:** Temporal features

| Task | Pt | Acceptance Criteria |
|------|----|---------------------|
| Embed step in pipeline | 1.5 | Post-summarization batch embedding, llm_calls logged, non-fatal on failure, tested with fake embeddings |
| Topic extraction LLM step | 1.5 | Structured output, upserts to topics/post_topics, frequency tracking, non-fatal on failure |
| Triage context injection | 1 | Recent topics injected into triage system prompt, < 200 tokens, tested that triage still works |
| New `get_trending_topics` tool | 0.5 | Returns topics with frequency, sentiment trend, subreddit distribution |
| New `compare_periods` tool | 0.5 | Two-window diff: new/gone/changed topics with summary |

### WS14: Pipeline QoL (3pt)

**Deps:** None | **Unblocks:** Better dev experience

| Task | Pt | Acceptance Criteria |
|------|----|---------------------|
| Fetch caching | 1.5 | Freshness check, configurable TTL (default 15 min), `forceRefresh` option, tested that cached path returns DB data |
| Runtime model config | 0.5 | Orchestrator reads llmProvider/llmModel from DB at execution time, config changes take effect without restart |
| In-process delivery fallback | 1 | `DigestCompleted` handler in bootstrap, mirrors deliver-digest task, sends to configured channels |

### Bug Fixes (pre-Phase 3, not pointed)

- turbo.json `globalPassThroughEnv` (#33) — already fixed in working tree
- stdio dotenv loading (#34) — already fixed in working tree
- .mcp.json command fix — already fixed in working tree

---

## Dependency Graph

```
WS14 (QoL, 3pt) ──────────────────► can ship independently, sprint 1

WS11 (Search Infra, 8pt) ──► WS12 (MCP Tools, 5pt)
         │
         └──────────────────► WS13 (Conv Memory, 5pt)

WS12 and WS13 can run in parallel once WS11 is done.
```

**Critical path:** WS11 → WS12/WS13

**Suggested sprint order:**
1. Sprint 10: WS14 (3pt) + WS11 first half (4pt) = 7pt
2. Sprint 11: WS11 second half (4pt) + WS12 start (3pt) = 7pt
3. Sprint 12: WS12 finish (2pt) + WS13 (5pt) = 7pt

---

## Totals

| Stream | Points |
|--------|--------|
| WS11: Search Infrastructure | 8 |
| WS12: MCP Tool Upgrades | 5 |
| WS13: Conversational Memory | 5 |
| WS14: Pipeline QoL | 3 |
| **Total Phase 3** | **21pt** |

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search approach | Composite tsvector (not per-column search) | One index, one query, weighted ranking. Simpler than joining across 6 tables. |
| Embedding target | Post summaries (not raw posts) | Summaries are LLM-curated signal. Raw posts are noisy. |
| Embedding model | OpenAI text-embedding-3-small | 1536 dims, $0.02/1M tokens. Cheap enough for personal scale. |
| Vector index | HNSW (not IVFFlat) | Better recall at small scale, no training step. |
| Hybrid search fusion | Reciprocal Rank Fusion (RRF) | Simple, proven, no tuning. Works well when both signals are useful. |
| Topic extraction | LLM-based (not keyword-based) | Intelligent grouping ("Server Components" = "RSC"). One cheap call per digest. |
| Context injection | Triage prompt only (not summarization) | Triage is where selection decisions are made. 200 tokens fits within 8K budget. |
| Fetch caching | DB freshness check (not Redis) | Posts already in DB. No new dependency. Simple. |
| pgvector setup | Extension on existing Postgres | `pgvector/pgvector:pg17` Docker image. No new services. |
| `ask_history` design | Returns relevant posts (not LLM synthesis) | MCP philosophy: tools return data, Claude reasons. Composable. |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| tsvector trigger performance on large datasets | Low | Medium | Trigger only fires on INSERT/UPDATE, not SELECT. Monitor query times. |
| Embedding API cost at scale | Low | Low | text-embedding-3-small is $0.02/1M tokens. ~500 tokens per post. Negligible at personal scale. |
| pgvector HNSW memory usage | Low | Medium | At personal scale (< 10K posts), memory is not a concern. Monitor if scaling. |
| Topic extraction quality | Medium | Low | Non-fatal step. Bad topics don't break anything. Can tune prompt or switch to keyword fallback. |
| Prisma + raw SQL for tsvector/pgvector | Medium | Medium | Prisma doesn't natively support tsvector/pgvector. Use `$queryRaw` for search queries. SearchService encapsulates this. |
