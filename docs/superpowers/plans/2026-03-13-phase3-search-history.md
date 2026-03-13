# Phase 3: Search + Conversational History Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Redgest from a digest generator into a conversational knowledge base by adding full-text search (tsvector + GIN), semantic similarity (pgvector + HNSW), topic tracking, and historical context injection.

**Architecture:** Three-layer search (keyword FTS, semantic embeddings, hybrid RRF fusion) backed by Postgres extensions. Two new pipeline steps (embed, topic extraction) run post-summarization. Six MCP tools upgraded or added. All search queries encapsulated in a `SearchService` that uses `$queryRaw` with Zod-validated results.

**Tech Stack:** TypeScript 5.1+, Prisma v7 (`$queryRaw`), pgvector, tsvector + GIN, OpenAI `text-embedding-3-small`, Vitest, Zod 4

**Spec:** `docs/superpowers/specs/2026-03-13-phase3-search-history-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| **WS14: Pipeline QoL** | | |
| `packages/db/prisma/schema.prisma` | Modify | Add `lastFetchedAt` to Subreddit |
| `packages/core/src/pipeline/fetch-step.ts` | Modify | Cache-aware fetching with TTL check |
| `packages/core/src/pipeline/orchestrator.ts` | Modify | Read model config at runtime, pass forceRefresh |
| `packages/core/src/pipeline/types.ts` | Modify | Add `forceRefresh` to PipelineDeps |
| `packages/core/src/commands/types.ts` | Modify | Add `forceRefresh` to GenerateDigest params |
| `packages/core/src/commands/handlers/generate-digest.ts` | Modify | Pass forceRefresh through to job |
| `packages/core/src/digest-dispatch.ts` | Modify | Add DigestCompleted handler for in-process delivery |
| `packages/mcp-server/src/bootstrap.ts` | Modify | Wire delivery, move model read to runtime |
| `packages/mcp-server/src/tools.ts` | Modify | Add `force_refresh` param to generate_digest |
| `packages/core/src/__tests__/fetch-step-cache.test.ts` | Create | Cache bypass/hit tests |
| `packages/core/src/__tests__/delivery-dispatch.test.ts` | Create | In-process delivery tests |
| **WS11: Search Infrastructure** | | |
| `docker-compose.yml` | Modify | Swap `postgres:16-alpine` → `pgvector/pgvector:pg16` |
| `packages/db/prisma/schema.prisma` | Modify | New columns, tables, Unsupported types |
| `packages/db/prisma/migrations/YYYYMMDD_phase3_search/migration.sql` | Create | pgvector, tsvector, topics tables |
| `packages/core/src/search/types.ts` | Create | SearchResult, SearchOptions interfaces |
| `packages/core/src/search/schemas.ts` | Create | Zod schemas for raw SQL result validation |
| `packages/core/src/search/service.ts` | Create | SearchService implementation |
| `packages/core/src/search/index.ts` | Create | Barrel export |
| `packages/core/src/__tests__/search-service.test.ts` | Create | Integration tests with real DB |
| `scripts/backfill-search.ts` | Create | Populate search_vector + embeddings |
| `packages/core/src/utils/duration.ts` | Create | Shared `parseDuration()` utility for "7d", "24h", "30m" strings |
| **WS12: MCP Tool Upgrades** | | |
| `packages/core/src/queries/types.ts` | Modify | Updated SearchPosts/SearchDigests, new FindSimilar/AskHistory |
| `packages/core/src/queries/handlers/search-posts.ts` | Modify | FTS via SearchService |
| `packages/core/src/queries/handlers/search-digests.ts` | Modify | FTS grouped by digest |
| `packages/core/src/queries/handlers/find-similar.ts` | Create | Embedding similarity handler |
| `packages/core/src/queries/handlers/ask-history.ts` | Create | Hybrid search handler |
| `packages/core/src/queries/handlers/index.ts` | Modify | Register new handlers |
| `packages/mcp-server/src/tools.ts` | Modify | Updated + new tool registrations |
| `packages/mcp-server/src/bootstrap.ts` | Modify | Inject SearchService into context |
| `packages/core/src/context.ts` | Modify | Add SearchService to HandlerContext |
| **WS13: Conversational Memory** | | |
| `packages/core/src/pipeline/embed-step.ts` | Create | Batch embedding generation |
| `packages/core/src/pipeline/topic-step.ts` | Create | LLM topic extraction |
| `packages/core/src/pipeline/types.ts` | Modify | Add generateEmbedding, EmbedStepResult, TopicStepResult |
| `packages/core/src/pipeline/orchestrator.ts` | Modify | Chain embed + topic steps |
| `packages/llm/src/prompts/triage.ts` | Modify | Add recent topics context section |
| `packages/llm/src/generate-embedding.ts` | Create | OpenAI embedding wrapper |
| `packages/llm/src/generate-topics.ts` | Create | Topic extraction with structured output |
| `packages/llm/src/index.ts` | Modify | Export new functions |
| `packages/core/src/queries/types.ts` | Modify | Add GetTrendingTopics, ComparePeriods |
| `packages/core/src/queries/handlers/get-trending-topics.ts` | Create | Topic aggregation handler |
| `packages/core/src/queries/handlers/compare-periods.ts` | Create | Two-window topic diff |
| `packages/core/src/queries/handlers/index.ts` | Modify | Register new handlers |
| `packages/mcp-server/src/tools.ts` | Modify | New tool registrations |

---

## Chunk 1: WS14 — Pipeline QoL

### Task 1: Fetch Caching — Schema + Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `lastFetchedAt` to Subreddit model**

In `packages/db/prisma/schema.prisma`, add to the `Subreddit` model (after `updatedAt`):

```prisma
  lastFetchedAt DateTime? @map("last_fetched_at")
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
pnpm --filter @redgest/db exec prisma migrate dev --name add_fetch_caching
```
Expected: Migration created and applied. Adds nullable `last_fetched_at` column to `subreddits` table.

- [ ] **Step 3: Regenerate Prisma client**

Run: `turbo db:generate`
Expected: PASS — client regenerated with `lastFetchedAt` field on Subreddit model.

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `turbo test`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add lastFetchedAt column to subreddits for fetch caching"
```

---

### Task 2: Fetch Caching — Pipeline Changes

**Files:**
- Modify: `packages/core/src/pipeline/types.ts`
- Modify: `packages/core/src/pipeline/fetch-step.ts`
- Create: `packages/core/src/__tests__/fetch-step-cache.test.ts`

- [ ] **Step 1: Add `forceRefresh` to PipelineDeps**

In `packages/core/src/pipeline/types.ts`, add to the `PipelineDeps` interface (after `model?`):

```typescript
  /** Skip fetch cache — always fetch fresh from Reddit. */
  forceRefresh?: boolean;
```

- [ ] **Step 2: Write failing test for cache bypass**

Create `packages/core/src/__tests__/fetch-step-cache.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchStep } from "../pipeline/fetch-step.js";
import type { ContentSource, FetchedContent } from "../pipeline/types.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("fetchStep cache behavior", () => {
  const mockSource: ContentSource = {
    fetchContent: vi.fn<ContentSource["fetchContent"]>(),
  };

  const mockDb = {
    subreddit: { update: vi.fn() },
    post: { upsert: vi.fn().mockResolvedValue({ id: "post-1" }) },
    postComment: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  };

  const fakeFetchResult: FetchedContent = {
    subreddit: "test",
    posts: [
      {
        post: {
          id: "abc123",
          name: "t3_abc123",
          subreddit: "test",
          title: "Test Post",
          selftext: "body",
          author: "user1",
          score: 42,
          num_comments: 5,
          url: "https://reddit.com/r/test/abc123",
          permalink: "/r/test/abc123",
          link_flair_text: null,
          over_18: false,
          created_utc: Date.now() / 1000,
          is_self: true,
        },
        comments: [],
      },
    ],
    fetchedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockSource.fetchContent).mockResolvedValue(fakeFetchResult);
  });

  it("fetches from source when no lastFetchedAt exists", async () => {
    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: null },
      mockSource,
      mockDb as unknown as PrismaClient,
    );

    expect(mockSource.fetchContent).toHaveBeenCalled();
    expect(result.posts.length).toBeGreaterThan(0);
  });

  it("fetches from source when cache is stale", async () => {
    const staleDate = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago

    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: staleDate },
      mockSource,
      mockDb as unknown as PrismaClient,
    );

    expect(mockSource.fetchContent).toHaveBeenCalled();
  });

  it("skips fetch when cache is fresh and uses DB posts", async () => {
    const freshDate = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    mockDb.post.findMany = vi.fn().mockResolvedValue([]);

    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: freshDate },
      mockSource,
      mockDb as unknown as PrismaClient,
      { cacheTtlMs: 15 * 60 * 1000 },
    );

    expect(mockSource.fetchContent).not.toHaveBeenCalled();
    expect(mockDb.post.findMany).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/fetch-step-cache.test.ts`
Expected: FAIL — `fetchStep` doesn't accept `lastFetchedAt` param or cache options yet.

- [ ] **Step 4: Update fetchStep signature and add cache logic**

Modify `packages/core/src/pipeline/fetch-step.ts`:

```typescript
import type { PrismaClient } from "@redgest/db";
import { sanitizeContent } from "@redgest/reddit";
import type { ContentSource, FetchStepResult } from "./types.js";

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface FetchStepOptions {
  cacheTtlMs?: number;
}

/**
 * Fetch posts from a content source, filter NSFW if needed,
 * and upsert posts + comments to the database.
 *
 * When `lastFetchedAt` is recent (within cacheTtlMs), returns posts
 * from the database instead of hitting the Reddit API.
 */
export async function fetchStep(
  subreddit: {
    name: string;
    maxPosts: number;
    includeNsfw: boolean;
    lastFetchedAt?: Date | null;
  },
  source: ContentSource,
  db: PrismaClient,
  options?: FetchStepOptions,
): Promise<FetchStepResult> {
  const cacheTtl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheAge = subreddit.lastFetchedAt
    ? Date.now() - subreddit.lastFetchedAt.getTime()
    : Infinity;

  // Cache hit — load from DB instead of Reddit API
  if (cacheAge < cacheTtl) {
    const dbPosts = await db.post.findMany({
      where: { subreddit: subreddit.name },
      orderBy: { fetchedAt: "desc" },
      take: subreddit.maxPosts * 3, // fetch more to account for sort dedup
      include: { comments: { orderBy: { score: "desc" }, take: 10 } },
    });

    return {
      subreddit: subreddit.name,
      posts: dbPosts.map((p) => ({
        postId: p.id,
        redditId: p.redditId,
        post: {
          id: p.redditId,
          name: `t3_${p.redditId}`,
          subreddit: p.subreddit,
          title: p.title,
          selftext: p.body ?? "",
          author: p.author,
          score: p.score,
          num_comments: p.commentCount,
          url: p.url,
          permalink: p.permalink,
          link_flair_text: p.flair,
          over_18: p.isNsfw,
          created_utc: p.fetchedAt.getTime() / 1000,
          is_self: true,
        },
        comments: p.comments.map((c) => ({
          id: c.redditId,
          name: `t1_${c.redditId}`,
          author: c.author,
          body: c.body,
          score: c.score,
          depth: c.depth,
          created_utc: c.fetchedAt.getTime() / 1000,
        })),
      })),
      fetchedAt: subreddit.lastFetchedAt ?? new Date(),
    };
  }

  // Cache miss — fetch from source
  const content = await source.fetchContent(subreddit.name, {
    sorts: ["hot", "top", "rising"],
    limit: subreddit.maxPosts,
    commentsPerPost: 10,
    timeRange: "day",
  });

  const results: FetchStepResult["posts"] = [];

  for (const { post, comments } of content.posts) {
    if (post.over_18 && !subreddit.includeNsfw) continue;

    const dbPost = await db.post.upsert({
      where: { redditId: post.id },
      create: {
        redditId: post.id,
        subreddit: post.subreddit,
        title: sanitizeContent(post.title),
        body: sanitizeContent(post.selftext),
        author: post.author,
        score: post.score,
        commentCount: post.num_comments,
        url: post.url,
        permalink: post.permalink,
        flair: post.link_flair_text,
        isNsfw: post.over_18,
        fetchedAt: content.fetchedAt,
      },
      update: {
        score: post.score,
        commentCount: post.num_comments,
        fetchedAt: content.fetchedAt,
      },
    });

    await db.postComment.deleteMany({ where: { postId: dbPost.id } });
    if (comments.length > 0) {
      await db.postComment.createMany({
        data: comments.map((c) => ({
          postId: dbPost.id,
          redditId: c.id,
          author: c.author,
          body: sanitizeContent(c.body),
          score: c.score,
          depth: c.depth,
          fetchedAt: content.fetchedAt,
        })),
      });
    }

    results.push({ postId: dbPost.id, redditId: post.id, post, comments });
  }

  return {
    subreddit: subreddit.name,
    posts: results,
    fetchedAt: content.fetchedAt,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/fetch-step-cache.test.ts`
Expected: Tests pass (may need test adjustments for mock shape). Fix any issues.

- [ ] **Step 6: Update orchestrator to pass `lastFetchedAt` and update it after fetch**

In `packages/core/src/pipeline/orchestrator.ts`, modify the fetch step call (around line 157-165):

Replace:
```typescript
      const fetchResult = await fetchStep(
        {
          name: sub.name,
          maxPosts: sub.maxPosts,
          includeNsfw: sub.includeNsfw,
        },
        contentSource,
        db,
      );
```

With:
```typescript
      const forceRefresh = deps.forceRefresh ?? false;
      const fetchResult = await fetchStep(
        {
          name: sub.name,
          maxPosts: sub.maxPosts,
          includeNsfw: sub.includeNsfw,
          lastFetchedAt: forceRefresh ? null : sub.lastFetchedAt,
        },
        contentSource,
        db,
      );

      // Update lastFetchedAt on the subreddit after successful fetch
      await db.subreddit.update({
        where: { id: sub.id },
        data: { lastFetchedAt: fetchResult.fetchedAt },
      });
```

- [ ] **Step 7: Run full test suite**

Run: `turbo test`
Expected: All tests pass. Existing fetch-step tests may need `lastFetchedAt: null` added to their subreddit param.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/pipeline/fetch-step.ts packages/core/src/pipeline/types.ts packages/core/src/pipeline/orchestrator.ts packages/core/src/__tests__/fetch-step-cache.test.ts
git commit -m "feat(core): add fetch caching with configurable TTL

Skip Reddit API calls when subreddit was recently fetched (default 15 min).
Loads cached posts from DB instead. forceRefresh bypasses cache."
```

---

### Task 3: Fetch Caching — Command + MCP Plumbing

**Files:**
- Modify: `packages/core/src/commands/types.ts`
- Modify: `packages/core/src/commands/handlers/generate-digest.ts`
- Modify: `packages/core/src/events/types.ts`
- Modify: `packages/core/src/events/schemas.ts`
- Modify: `packages/core/src/digest-dispatch.ts`
- Modify: `packages/mcp-server/src/tools.ts`

- [ ] **Step 1: Add `forceRefresh` to GenerateDigest command params**

In `packages/core/src/commands/types.ts`, update `GenerateDigest`:

```typescript
  GenerateDigest: {
    subredditIds?: string[];
    lookbackHours?: number;
    forceRefresh?: boolean;
  };
```

- [ ] **Step 2: Pass `forceRefresh` through in command handler**

In `packages/core/src/commands/handlers/generate-digest.ts`, ensure `forceRefresh` is included in the Job record or event payload. The event's `DigestRequested` payload needs `forceRefresh` added:

In `packages/core/src/events/types.ts`, update `DigestRequested`:

```typescript
  DigestRequested: { jobId: string; subredditIds: string[]; forceRefresh?: boolean };
```

In `packages/core/src/events/schemas.ts`, update the schema for `DigestRequested` to include `forceRefresh`:

```typescript
  DigestRequested: z.object({
    jobId: z.string(),
    subredditIds: z.array(z.string()),
    forceRefresh: z.boolean().optional(),
  }),
```

In the command handler, pass `forceRefresh` in the event payload:

```typescript
    event: { jobId: job.id, subredditIds, forceRefresh: params.forceRefresh },
```

- [ ] **Step 3: Wire forceRefresh through digest dispatch**

In `packages/core/src/digest-dispatch.ts`, the `runInProcess` helper is a closure that captures `pipelineDeps`. To pass per-event `forceRefresh`, modify `runInProcess` to accept it as a parameter:

```typescript
  async function runInProcess(
    jobId: string,
    subredditIds: string[],
    forceRefresh?: boolean,
  ): Promise<void> {
    try {
      const deps = forceRefresh ? { ...pipelineDeps, forceRefresh } : pipelineDeps;
      await runDigestPipeline(jobId, subredditIds, deps);
    } catch (err) {
      // ... existing error handling unchanged
    }
  }
```

Then in the `eventBus.on("DigestRequested")` callback, destructure and pass `forceRefresh`:

```typescript
  eventBus.on("DigestRequested", async (event) => {
    const { jobId, subredditIds, forceRefresh } = event.payload;

    if (triggerSecretKey) {
      try {
        const { tasks } = await import("@trigger.dev/sdk/v3");
        // Note: Trigger.dev path does NOT propagate forceRefresh.
        // The worker task would need to accept it as a payload field.
        // Deferred to when worker tests are added (TD-005).
        await tasks.trigger("generate-digest", { jobId, subredditIds });
      } catch (err) {
        // ... fallback unchanged, but pass forceRefresh:
        await runInProcess(jobId, subredditIds, forceRefresh);
      }
    } else {
      await runInProcess(jobId, subredditIds, forceRefresh);
    }
  });
```

**Known limitation:** When using Trigger.dev dispatch, `forceRefresh` is not propagated to the worker task. It only works in the in-process path. This is acceptable for Phase 3 since `forceRefresh` is a dev/testing convenience.

- [ ] **Step 4: Add `force_refresh` to MCP generate_digest tool**

In `packages/mcp-server/src/tools.ts`, find the `generate_digest` tool registration and add to its Zod schema:

```typescript
force_refresh: z.boolean().optional().describe("Bypass fetch cache and always hit Reddit API"),
```

Pass it through in the handler:

```typescript
const result = await deps.execute("GenerateDigest", {
  subredditIds: args.subreddit_ids,
  lookbackHours: args.lookback_hours,
  forceRefresh: args.force_refresh,
}, deps.ctx);
```

- [ ] **Step 5: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/commands/types.ts packages/core/src/commands/handlers/generate-digest.ts packages/core/src/events/types.ts packages/core/src/events/schemas.ts packages/core/src/digest-dispatch.ts packages/mcp-server/src/tools.ts
git commit -m "feat: add forceRefresh option to generate_digest

Plumbs force_refresh from MCP tool through command → event → dispatch → pipeline."
```

---

### Task 4: Runtime Model Config

**Files:**
- Modify: `packages/core/src/pipeline/orchestrator.ts`
- Modify: `packages/mcp-server/src/bootstrap.ts`

- [ ] **Step 1: Move model config read from bootstrap to orchestrator**

In `packages/core/src/pipeline/orchestrator.ts`, at the top of `runPipelineBody()` (after loading subreddits and config), add runtime model read:

```typescript
  // Read LLM model config at runtime (not boot time)
  // so config changes take effect without restart
  const runtimeModel = (() => {
    if (deps.model) return deps.model; // explicit override (e.g., test mode)
    if (dbConfig?.llmProvider && dbConfig?.llmModel) {
      return {
        provider: dbConfig.llmProvider as "anthropic" | "openai",
        model: dbConfig.llmModel,
      };
    }
    return undefined;
  })();
```

Note: `dbConfig` is already loaded at line 134 (`const dbConfig = await db.config.findFirst()`). Use it for model resolution.

Then replace `deps.model` references with `runtimeModel`:

```typescript
  const triageModel = runtimeModel ? getModel("triage", runtimeModel) : undefined;
  // ...
  const sumModel = runtimeModel ? getModel("summarize", runtimeModel) : undefined;
```

- [ ] **Step 2: Simplify bootstrap — remove boot-time model read**

In `packages/mcp-server/src/bootstrap.ts`, find the `else` branch of the `REDGEST_TEST_MODE` check. Remove the `db.config.findFirst()` call and the `model` variable construction. Change the `pipelineDeps` assignment to omit `model`:

Find this pattern inside the `else` branch:
```typescript
    const dbConfig = await db.config.findFirst({ where: { id: 1 } });
    const model =
      dbConfig?.llmProvider && dbConfig?.llmModel
        ? {
            provider: dbConfig.llmProvider as "anthropic" | "openai",
            model: dbConfig.llmModel,
          }
        : undefined;

    pipelineDeps = { db, eventBus, contentSource, config, model };
```

Replace with:
```typescript
    pipelineDeps = { db, eventBus, contentSource, config };
```

The orchestrator now reads model config from DB at runtime (Step 1), so boot-time read is unnecessary.

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline/orchestrator.ts packages/mcp-server/src/bootstrap.ts
git commit -m "feat(core): read LLM model config at runtime instead of boot time

Config changes via update_config now take effect on next digest run
without requiring MCP server restart."
```

---

### Task 5: In-Process Delivery Fallback

**Files:**
- Modify: `packages/core/src/digest-dispatch.ts`
- Modify: `packages/mcp-server/src/bootstrap.ts`
- Create: `packages/core/src/__tests__/delivery-dispatch.test.ts`

- [ ] **Step 1: Write failing test for in-process delivery**

Create `packages/core/src/__tests__/delivery-dispatch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DomainEventBus } from "../events/bus.js";
import { wireDigestDispatch } from "../digest-dispatch.js";
import type { PipelineDeps } from "../pipeline/types.js";
import type { DomainEvent } from "../events/types.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("wireDigestDispatch — delivery", () => {
  it("registers DigestCompleted handler when deliverDigest callback provided", () => {
    const eventBus = new DomainEventBus();
    const onSpy = vi.spyOn(eventBus, "on");
    const pipelineDeps = stub<PipelineDeps>();

    wireDigestDispatch({
      eventBus,
      pipelineDeps,
      deliverDigest: vi.fn(),
    });

    // Verify DigestCompleted listener was registered
    expect(onSpy).toHaveBeenCalledWith("DigestCompleted", expect.any(Function));
  });

  it("does NOT register DigestCompleted handler when triggerSecretKey is set", () => {
    const eventBus = new DomainEventBus();
    const onSpy = vi.spyOn(eventBus, "on");
    const pipelineDeps = stub<PipelineDeps>();

    wireDigestDispatch({
      eventBus,
      pipelineDeps,
      triggerSecretKey: "some-key",
    });

    // Should only register DigestRequested, not DigestCompleted
    const digestCompletedCalls = onSpy.mock.calls.filter(
      ([type]) => type === "DigestCompleted",
    );
    expect(digestCompletedCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/delivery-dispatch.test.ts`
Expected: FAIL — `wireDigestDispatch` doesn't accept `deliverDigest` callback yet.

- [ ] **Step 3: Add delivery wiring to digest-dispatch**

**Architecture note:** `@redgest/core` must NOT import `@redgest/email` or `@redgest/slack` — that would break the dependency graph (`core` is a leaf that `email`/`slack` don't depend on). Instead, use a **callback injection** pattern: the caller (bootstrap.ts) provides a `deliverDigest` callback that `core` calls without knowing the implementation.

In `packages/core/src/digest-dispatch.ts`, update the `DigestDispatchDeps` interface and add a `DigestCompleted` handler:

```typescript
export interface DigestDispatchDeps {
  eventBus: DomainEventBus;
  pipelineDeps: PipelineDeps;
  triggerSecretKey?: string;
  /** Injected delivery function — called on DigestCompleted when Trigger.dev is not configured. */
  deliverDigest?: (digestId: string, jobId: string) => Promise<void>;
}

export function wireDigestDispatch(deps: DigestDispatchDeps): void {
  const { eventBus, pipelineDeps, triggerSecretKey, deliverDigest } = deps;
  // ... existing DigestRequested handler unchanged ...

  // In-process delivery on DigestCompleted (when Trigger.dev not available)
  if (!triggerSecretKey && deliverDigest) {
    eventBus.on("DigestCompleted", async (event) => {
      const { jobId, digestId } = event.payload;
      try {
        await deliverDigest(digestId, jobId);
      } catch (err) {
        console.error(
          `[DigestCompleted] In-process delivery failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    });
  }
}
```

- [ ] **Step 4: Implement delivery callback in bootstrap**

In `packages/mcp-server/src/bootstrap.ts`, create the delivery callback that imports from `@redgest/email` and `@redgest/slack` (the mcp-server package already depends on both):

```typescript
  // Build in-process delivery callback
  const deliverDigest = async (digestId: string, jobId: string) => {
    const digest = await db.digest.findUniqueOrThrow({
      where: { id: digestId },
      include: {
        digestPosts: {
          orderBy: { rank: "asc" },
          include: {
            post: {
              include: { summaries: { take: 1, orderBy: { createdAt: "desc" } } },
            },
          },
        },
      },
    });

    const { buildDeliveryData, sendDigestEmail } = await import("@redgest/email");
    const { sendDigestSlack } = await import("@redgest/slack");

    const data = buildDeliveryData(digest);
    const results: Array<{ channel: string; ok: boolean; error?: string }> = [];

    if (config.RESEND_API_KEY && config.DELIVERY_EMAIL) {
      try {
        await sendDigestEmail(data, config.DELIVERY_EMAIL, config.RESEND_API_KEY);
        results.push({ channel: "EMAIL", ok: true });
      } catch (err) {
        results.push({ channel: "EMAIL", ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (config.SLACK_WEBHOOK_URL) {
      try {
        await sendDigestSlack(data, config.SLACK_WEBHOOK_URL);
        results.push({ channel: "SLACK", ok: true });
      } catch (err) {
        results.push({ channel: "SLACK", ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Record delivery outcomes
    for (const r of results) {
      await db.delivery.create({
        data: {
          digestId,
          jobId,
          channel: r.channel as "EMAIL" | "SLACK",
          status: r.ok ? "SENT" : "FAILED",
          error: r.error ?? null,
          sentAt: r.ok ? new Date() : null,
        },
      });
    }

    console.log(
      `[DigestCompleted] In-process delivery: ${results.map((r) => `${r.channel}=${r.ok ? "ok" : "failed"}`).join(", ")}`,
    );
  };

  wireDigestDispatch({
    eventBus,
    pipelineDeps,
    triggerSecretKey: config.TRIGGER_SECRET_KEY,
    deliverDigest,
  });
```

- [ ] **Step 5: Run tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/digest-dispatch.ts packages/core/src/__tests__/delivery-dispatch.test.ts packages/mcp-server/src/bootstrap.ts
git commit -m "feat(core): add in-process delivery fallback on DigestCompleted

When Trigger.dev is not configured, delivery runs in-process via
DigestCompleted event handler. Sends email/Slack and records outcomes."
```

---

## Chunk 2: WS11 — Search Infrastructure (Schema + Migration)

### Task 6: Docker Image Swap + pgvector Extension

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update Docker Compose to use pgvector image**

In `docker-compose.yml`, replace the postgres image line:

Replace:
```yaml
    image: postgres:16-alpine
```

With:
```yaml
    image: pgvector/pgvector:pg16
```

- [ ] **Step 2: Recreate the Postgres container with new image**

Run:
```bash
docker compose down postgres && docker compose up -d postgres
```
Expected: Container restarts with pgvector-enabled image. Wait for health check.

- [ ] **Step 3: Verify pgvector extension is available**

Run:
```bash
docker compose exec postgres psql -U redgest -d redgest -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname = 'vector';"
```
Expected: Extension created, version displayed (e.g., `0.7.0` or similar).

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `turbo test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: swap postgres image to pgvector/pgvector:pg16

Enables the pgvector extension for semantic search embeddings."
```

---

### Task 7: Phase 3 Migration — New Columns + tsvector + Topics

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

This is the single combined migration for all Phase 3 schema changes. We create it as a manual migration because it includes raw SQL (triggers, extensions, Unsupported types).

- [ ] **Step 1: Update Prisma schema with new fields**

In `packages/db/prisma/schema.prisma`:

**Add to `PostSummary` model** (after `commentHighlights`):
```prisma
  communityConsensus String?  @map("community_consensus")
  sentiment          String?
  embedding          Unsupported("vector(1536)")?
```

**Add to `Post` model** (after `textSearch`):
```prisma
  searchVector  Unsupported("tsvector")?  @map("search_vector")
```

Remove the existing `textSearch` field from the `Post` model (it's unused — was `Unsupported("tsvector")?`).

**Add new models at the end of the schema:**
```prisma
model Topic {
  id        String       @id @default(uuid(7))
  name      String       @unique
  firstSeen DateTime     @default(now()) @map("first_seen")
  lastSeen  DateTime     @default(now()) @map("last_seen")
  frequency Int          @default(1)
  posts     PostTopic[]

  @@map("topics")
}

model PostTopic {
  postId    String  @map("post_id")
  topicId   String  @map("topic_id")
  relevance Float   @default(1.0)
  post      Post    @relation(fields: [postId], references: [id], onDelete: Cascade)
  topic     Topic   @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@id([postId, topicId])
  @@index([topicId])
  @@map("post_topics")
}
```

**Add `postTopics` relation to `Post` model:**
```prisma
  postTopics    PostTopic[]
```

- [ ] **Step 2: Create the migration manually (don't auto-apply)**

Run:
```bash
pnpm --filter @redgest/db exec prisma migrate dev --name phase3_search --create-only
```
Expected: Creates migration directory with initial SQL. We'll edit it to add the trigger and pgvector extension.

- [ ] **Step 3: Edit the migration SQL to include trigger + extension**

Open the generated `migration.sql` and ensure it contains (add if missing):

```sql
-- 1. pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. New columns on post_summaries
ALTER TABLE "post_summaries" ADD COLUMN "community_consensus" TEXT;
ALTER TABLE "post_summaries" ADD COLUMN "sentiment" TEXT;
ALTER TABLE "post_summaries" ADD COLUMN "embedding" vector(1536);

-- 3. Replace textSearch with search_vector on posts
ALTER TABLE "posts" DROP COLUMN IF EXISTS "text_search";
ALTER TABLE "posts" ADD COLUMN "search_vector" tsvector;

-- 4. GIN index on search_vector
CREATE INDEX "posts_search_idx" ON "posts" USING GIN ("search_vector");

-- 5. HNSW index on embeddings
CREATE INDEX "summaries_embedding_idx" ON "post_summaries" USING hnsw ("embedding" vector_cosine_ops);

-- 6. Topics tables (TEXT IDs to match existing schema convention — Prisma generates UUID v7 at application layer)
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frequency" INT NOT NULL DEFAULT 1,
    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "topics_name_key" ON "topics"("name");

CREATE TABLE "post_topics" (
    "post_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    CONSTRAINT "post_topics_pkey" PRIMARY KEY ("post_id","topic_id"),
    CONSTRAINT "post_topics_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
    CONSTRAINT "post_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE
);
CREATE INDEX "post_topics_topic_idx" ON "post_topics"("topic_id");

-- 7. Trigger function for composite search_vector
-- The UPDATE uses a self-join (posts p) to access column values for
-- tsvector construction. The outer `posts` in `UPDATE posts SET ...` is the
-- target row; the inner `posts p` in the FROM clause provides column values
-- (title, body) for the tsvector expression.
CREATE OR REPLACE FUNCTION update_post_search_vector() RETURNS trigger AS $$
DECLARE
  target_post_id TEXT;
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
           COALESCE((SELECT string_agg(elem, '. ') FROM jsonb_array_elements_text(ps.key_takeaways) AS elem), '') AS key_takeaways_text
    FROM post_summaries ps WHERE ps.post_id = target_post_id
    ORDER BY ps.created_at DESC LIMIT 1
  ) s ON true
  WHERE p.id = target_post_id AND posts.id = target_post_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Triggers
-- WHEN clause on posts trigger limits firing to title/body changes only,
-- preventing infinite recursion when the trigger itself UPDATEs search_vector.
CREATE TRIGGER posts_search_update
  AFTER INSERT OR UPDATE OF title, body ON posts
  FOR EACH ROW EXECUTE FUNCTION update_post_search_vector();

CREATE TRIGGER summaries_search_update
  AFTER INSERT OR UPDATE ON post_summaries
  FOR EACH ROW EXECUTE FUNCTION update_post_search_vector();
```

- [ ] **Step 4: Apply the migration**

Run:
```bash
pnpm --filter @redgest/db exec prisma migrate dev
```
Expected: Migration applied successfully. All tables, columns, indexes, and triggers created.

- [ ] **Step 5: Regenerate Prisma client**

Run: `turbo db:generate`
Expected: Client regenerated with new `Topic`, `PostTopic` models, `communityConsensus`/`sentiment` on `PostSummary`.

- [ ] **Step 6: Verify trigger works with a quick SQL test**

Run:
```bash
docker compose exec postgres psql -U redgest -d redgest -c "
  INSERT INTO posts (id, reddit_id, subreddit, title, body, author, score, comment_count, url, permalink, is_nsfw, fetched_at)
  VALUES (gen_random_uuid(), 'test_trigger_check', 'test', 'Hello World Test', 'This is a test body', 'testuser', 1, 0, 'http://test', '/r/test', false, now())
  ON CONFLICT (reddit_id) DO UPDATE SET title = EXCLUDED.title
  RETURNING id, search_vector IS NOT NULL AS has_vector;
"
```
Expected: Returns row with `has_vector = true`.

- [ ] **Step 7: Clean up test data**

Run:
```bash
docker compose exec postgres psql -U redgest -d redgest -c "DELETE FROM posts WHERE reddit_id = 'test_trigger_check';"
```

- [ ] **Step 8: Run full test suite**

Run: `turbo test`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): Phase 3 migration — pgvector, tsvector, topics

- CREATE EXTENSION vector
- search_vector (tsvector + GIN) on posts with trigger
- embedding (vector(1536) + HNSW) on post_summaries
- community_consensus + sentiment columns on post_summaries
- topics + post_topics tables for topic tracking"
```

---

### Task 8: Update DB Package Exports

**Files:**
- Modify: `packages/db/src/index.ts` (or wherever Prisma types are re-exported)

- [ ] **Step 1: Verify new types are exported**

Check that `Topic`, `PostTopic` are available from `@redgest/db`. Prisma auto-generates these from the schema, but the package barrel export may need updating.

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: Compiles. If `Topic` or `PostTopic` types aren't available, add them to the barrel export.

- [ ] **Step 2: Run typecheck across all packages**

Run: `pnpm typecheck`
Expected: All pass.

- [ ] **Step 3: Commit (if changes needed)**

```bash
git add packages/db/
git commit -m "chore(db): export Topic and PostTopic types"
```

---

## Chunk 3: WS11 — SearchService + Backfill

### Task 9: Search Types + Zod Schemas

**Files:**
- Create: `packages/core/src/search/types.ts`
- Create: `packages/core/src/search/schemas.ts`

- [ ] **Step 1: Create search types**

Create `packages/core/src/search/types.ts`:

```typescript
export interface SearchOptions {
  subreddit?: string;
  since?: Date;
  sentiment?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  postId: string;
  redditId: string;
  subreddit: string;
  title: string;
  score: number;
  summarySnippet: string | null;
  matchHighlights: string[];
  relevanceRank: number;
  sentiment: string | null;
  digestId: string | null;
  digestDate: Date | null;
}

export interface SearchService {
  searchByKeyword(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  searchBySimilarity(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>;
  findSimilar(postId: string, options?: SearchOptions): Promise<SearchResult[]>;
  searchHybrid(query: string, queryEmbedding: number[], options?: SearchOptions): Promise<SearchResult[]>;
}
```

- [ ] **Step 2: Create Zod schemas for raw SQL result validation**

Create `packages/core/src/search/schemas.ts`:

```typescript
import { z } from "zod";

/** Validates rows returned by $queryRaw for keyword/similarity search. */
export const RawSearchRowSchema = z.object({
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

export type RawSearchRow = z.infer<typeof RawSearchRowSchema>;

/** Validates rows returned by $queryRaw for ts_headline snippets. */
export const RawHighlightRowSchema = z.object({
  post_id: z.string(),
  headline: z.string(),
});

export type RawHighlightRow = z.infer<typeof RawHighlightRowSchema>;
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: Compiles (new files, no consumers yet).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/search/
git commit -m "feat(core): add SearchResult types and raw SQL Zod schemas"
```

---

### Task 10: SearchService Implementation

**Files:**
- Create: `packages/core/src/search/service.ts`
- Create: `packages/core/src/search/index.ts`

- [ ] **Step 1: Write failing test for keyword search**

Create `packages/core/src/__tests__/search-service.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@redgest/db";
import { createSearchService } from "../search/service.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("SearchService", () => {
  // These tests use a mock DB with $queryRaw returning empty results.
  // Integration tests against a real DB will verify actual SQL behavior.
  function createMockDb() {
    return {
      ...stub<PrismaClient>(),
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
  }

  describe("searchByKeyword", () => {
    it("returns empty array when no matches", async () => {
      const mockDb = createMockDb();
      const service = createSearchService(mockDb);
      const results = await service.searchByKeyword("nonexistent-xyz-query");
      expect(results).toEqual([]);
    });
  });

  describe("searchHybrid", () => {
    it("returns empty array with no embedding input", async () => {
      const mockDb = createMockDb();
      const service = createSearchService(mockDb);
      // Empty embedding → keyword-only path, returns empty
      const results = await service.searchHybrid("test", [], { limit: 5 });
      expect(Array.isArray(results)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/search-service.test.ts`
Expected: FAIL — `createSearchService` doesn't exist yet.

- [ ] **Step 3: Implement SearchService**

Create `packages/core/src/search/service.ts`:

```typescript
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
```

- [ ] **Step 4: Create barrel export**

Create `packages/core/src/search/index.ts`:

```typescript
export { createSearchService } from "./service.js";
export type { SearchService, SearchResult, SearchOptions } from "./types.js";
export { RawSearchRowSchema, RawHighlightRowSchema } from "./schemas.js";
```

- [ ] **Step 5: Export from core package**

In `packages/core/src/index.ts` (or wherever exports are), add:

```typescript
export { createSearchService } from "./search/index.js";
export type { SearchService, SearchResult, SearchOptions } from "./search/index.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/search-service.test.ts`
Expected: Tests pass (unit tests with stubs). Integration tests against real DB can be added during implementation if DB is available.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: All packages compile.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/search/ packages/core/src/index.ts packages/core/src/__tests__/search-service.test.ts
git commit -m "feat(core): implement SearchService with keyword, semantic, and hybrid search

Encapsulates tsvector and pgvector queries behind a clean interface.
Uses $queryRaw with Zod-validated results. RRF fusion for hybrid search."
```

---

### Task 11: Backfill Script

**Files:**
- Create: `scripts/backfill-search.ts`

- [ ] **Step 1: Create backfill script**

Create `scripts/backfill-search.ts`:

```typescript
import { config } from "dotenv";
config({ override: true });
// Dynamic import ensures dotenv loads before Prisma reads DATABASE_URL
const { prisma } = await import("@redgest/db");

const BATCH_SIZE = 50;

async function backfillSearchVectors(): Promise<void> {
  // The Postgres trigger handles search_vector on INSERT/UPDATE,
  // but existing rows need a touch to fire the trigger.
  // Batch update all rows at once — trigger fires per-row regardless.
  const result = await prisma.$executeRaw`
    UPDATE posts SET title = title
  `;

  console.log(`Backfilled search_vector for ${result} posts`);
}

async function backfillEmbeddings(): Promise<void> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.log("OPENAI_API_KEY not set — skipping embedding backfill");
    return;
  }

  // Find summaries without embeddings
  const summaries = await prisma.$queryRaw<
    Array<{ id: string; text: string }>
  >`
    SELECT
      ps.id::text,
      COALESCE(ps.summary, '') || ' ' ||
      COALESCE((SELECT string_agg(elem, '. ') FROM jsonb_array_elements_text(ps.key_takeaways) AS elem), '') || ' ' ||
      COALESCE(ps.insight_notes, '') AS text
    FROM post_summaries ps
    WHERE ps.embedding IS NULL
    ORDER BY ps.created_at ASC
  `;

  console.log(`Found ${summaries.length} summaries to embed`);

  if (summaries.length === 0) return;

  // Batch embed (OpenAI supports up to 2048 inputs per request)
  for (let i = 0; i < summaries.length; i += BATCH_SIZE) {
    const batch = summaries.slice(i, i + BATCH_SIZE);
    const texts = batch.map((s) => s.text);

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    for (const item of data.data) {
      const summary = batch[item.index];
      if (!summary) continue;
      const vecStr = `[${item.embedding.join(",")}]`;
      await prisma.$executeRaw`
        UPDATE post_summaries
        SET embedding = ${vecStr}::vector
        WHERE id = ${summary.id}
      `;
    }

    console.log(
      `  Embedded ${Math.min(i + BATCH_SIZE, summaries.length)}/${summaries.length} summaries`,
    );

    // Rate limit: 3 req/min for free tier, generous for paid
    if (i + BATCH_SIZE < summaries.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log("Embedding backfill complete");
}

async function main(): Promise<void> {
  console.log("=== Phase 3 Search Backfill ===\n");

  await backfillSearchVectors();
  console.log();
  await backfillEmbeddings();

  await prisma.$disconnect();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Test the backfill script runs without error (empty DB is fine)**

Run:
```bash
npx tsx scripts/backfill-search.ts
```
Expected: Prints counts, completes without error. If DB has existing posts, they get search vectors populated.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-search.ts
git commit -m "feat: add Phase 3 search backfill script

Populates search_vector for existing posts (via trigger touch) and
generates embeddings for existing summaries (via OpenAI API)."
```

---

## Chunk 4: WS12 — MCP Tool Upgrades

### Task 12: Update QueryMap Types for Search

**Files:**
- Modify: `packages/core/src/queries/types.ts`
- Modify: `packages/core/src/context.ts`

- [ ] **Step 1: Add SearchService to HandlerContext**

In `packages/core/src/context.ts`, add the optional `searchService` to `HandlerContext`:

```typescript
import type { SearchService } from "./search/types.js";

export interface HandlerContext {
  db: DbClient;
  eventBus: DomainEventBus;
  config: RedgestConfig;
  searchService?: SearchService;
}
```

- [ ] **Step 2: Update SearchPosts and SearchDigests in QueryMap**

In `packages/core/src/queries/types.ts`:

Import the SearchResult type:
```typescript
import type { SearchResult } from "./search/types.js";
```

Update `SearchPosts` in `QueryMap`:
```typescript
  SearchPosts: {
    query: string;
    subreddit?: string;
    since?: string;
    sentiment?: string;
    minScore?: number;
    limit?: number;
    cursor?: string;
  };
```

Update `SearchDigests` in `QueryMap`:
```typescript
  SearchDigests: {
    query: string;
    since?: string;
    subreddit?: string;
    limit?: number;
  };
```

Add new entries to `QueryMap`:
```typescript
  FindSimilar: { postId: string; limit?: number; subreddit?: string };
  AskHistory: { question: string; subreddits?: string[]; since?: string };
```

Update `SearchPosts` in `QueryResultMap`:
```typescript
  SearchPosts: Paginated<SearchResult>;
```

Update `SearchDigests` in `QueryResultMap`:
```typescript
  SearchDigests: {
    items: Array<{
      digestId: string;
      digestDate: Date;
      matchedPosts: SearchResult[];
    }>;
  };
```

Add new entries to `QueryResultMap`:
```typescript
  FindSimilar: {
    sourcePost: { id: string; title: string; subreddit: string };
    similar: SearchResult[];
  };
  AskHistory: {
    relevantPosts: SearchResult[];
    searchStrategy: "keyword" | "semantic" | "hybrid";
  };
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: FAIL — existing handlers don't match new type signatures. That's expected — we fix them next.

- [ ] **Step 4: Commit type changes**

```bash
git add packages/core/src/queries/types.ts packages/core/src/context.ts
git commit -m "feat(core): update QueryMap types for Phase 3 search tools

SearchPosts/SearchDigests now use FTS params and SearchResult.
New queries: FindSimilar, AskHistory."
```

---

### Task 13: Upgrade search_posts Handler

**Files:**
- Create: `packages/core/src/utils/duration.ts`
- Modify: `packages/core/src/queries/handlers/search-posts.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/__tests__/search-service.test.ts` (or create a new test file):

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleSearchPosts } from "../queries/handlers/search-posts.js";
import type { HandlerContext } from "../context.js";
import type { SearchService } from "../search/types.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("handleSearchPosts", () => {
  it("delegates to searchService.searchByKeyword", async () => {
    const mockSearch: SearchService = {
      searchByKeyword: vi.fn().mockResolvedValue([]),
      searchBySimilarity: vi.fn(),
      findSimilar: vi.fn(),
      searchHybrid: vi.fn(),
    };

    const ctx: HandlerContext = {
      ...stub<HandlerContext>(),
      searchService: mockSearch,
    };

    const result = await handleSearchPosts(
      { query: "test" },
      ctx,
    );

    expect(mockSearch.searchByKeyword).toHaveBeenCalledWith("test", expect.any(Object));
    expect(result.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/search-service.test.ts`
Expected: FAIL — handler still uses `ctx.db.post.findMany`.

- [ ] **Step 3: Create shared `parseDuration` utility**

Create `packages/core/src/utils/duration.ts` — this utility is used by 5 handlers across WS12 and WS13:

```typescript
/**
 * Parse duration string like "7d", "24h", "30m" to milliseconds.
 * Returns `defaultMs` (default: 7 days) if the string doesn't match.
 */
export function parseDuration(
  s: string,
  defaultMs: number = 7 * 24 * 60 * 60 * 1000,
): number {
  const match = s.match(/^(\d+)([dhm])$/);
  if (!match) return defaultMs;
  const val = parseInt(match[1] ?? "7", 10);
  const unit = match[2];
  switch (unit) {
    case "d": return val * 24 * 60 * 60 * 1000;
    case "h": return val * 60 * 60 * 1000;
    case "m": return val * 60 * 1000;
    default: return defaultMs;
  }
}
```

- [ ] **Step 4: Rewrite search_posts handler**

Replace `packages/core/src/queries/handlers/search-posts.ts`:

```typescript
import { DEFAULT_PAGE_SIZE, type QueryHandler } from "../types.js";
import { parseDuration } from "../utils/duration.js";

export const handleSearchPosts: QueryHandler<"SearchPosts"> = async (
  params,
  ctx,
) => {
  const limit = params.limit ?? DEFAULT_PAGE_SIZE;

  if (!ctx.searchService) {
    // Fallback: no SearchService (e.g., tests without DB)
    return { items: [], nextCursor: null, hasMore: false };
  }

  const since = params.since
    ? new Date(Date.now() - parseDuration(params.since))
    : undefined;

  const results = await ctx.searchService.searchByKeyword(params.query, {
    subreddit: params.subreddit,
    since,
    sentiment: params.sentiment,
    minScore: params.minScore,
    limit: limit + 1, // fetch one extra for pagination
  });

  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? lastItem.postId : null;

  return { items, nextCursor, hasMore };
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/search-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Update MCP tool schema for search_posts**

In `packages/mcp-server/src/tools.ts`, update the `search_posts` tool's Zod schema:

```typescript
{
  query: z.string().describe("Full-text search query"),
  subreddit: z.string().optional().describe("Filter to specific subreddit"),
  since: z.string().optional().describe("Duration filter, e.g. '7d', '24h'"),
  sentiment: z.string().optional().describe("Filter by sentiment: positive, negative, neutral, mixed"),
  min_score: z.number().optional().describe("Minimum Reddit score"),
  limit: z.number().optional().describe("Max results (default 10)"),
}
```

Update the handler to map `min_score` → `minScore`:
```typescript
const result = await deps.query("SearchPosts", {
  query: args.query,
  subreddit: args.subreddit,
  since: args.since,
  sentiment: args.sentiment,
  minScore: args.min_score,
  limit: args.limit,
}, deps.ctx);
```

- [ ] **Step 7: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/utils/duration.ts packages/core/src/queries/handlers/search-posts.ts packages/mcp-server/src/tools.ts
git commit -m "feat: upgrade search_posts to full-text search via SearchService

Replaces LIKE-based title search with tsvector FTS. Adds subreddit,
since, sentiment, and minScore filters. Extracts shared parseDuration
utility for reuse across handlers."
```

---

### Task 14: Upgrade search_digests Handler

**Files:**
- Modify: `packages/core/src/queries/handlers/search-digests.ts`

- [ ] **Step 1: Rewrite handler to use FTS grouped by digest**

Replace `packages/core/src/queries/handlers/search-digests.ts`:

```typescript
import type { QueryHandler } from "../types.js";
import { parseDuration } from "../utils/duration.js";

export const handleSearchDigests: QueryHandler<"SearchDigests"> = async (
  params,
  ctx,
) => {
  if (!ctx.searchService) {
    return { items: [] };
  }

  const since = params.since
    ? new Date(Date.now() - parseDuration(params.since))
    : undefined;

  const results = await ctx.searchService.searchByKeyword(params.query, {
    subreddit: params.subreddit,
    since,
    limit: (params.limit ?? 10) * 5, // fetch more to group
  });

  // Group matched posts by digest
  const digestMap = new Map<
    string,
    { digestId: string; digestDate: Date; matchedPosts: typeof results }
  >();

  for (const r of results) {
    if (!r.digestId || !r.digestDate) continue;
    let group = digestMap.get(r.digestId);
    if (!group) {
      group = { digestId: r.digestId, digestDate: r.digestDate, matchedPosts: [] };
      digestMap.set(r.digestId, group);
    }
    group.matchedPosts.push(r);
  }

  const items = Array.from(digestMap.values())
    .sort((a, b) => b.digestDate.getTime() - a.digestDate.getTime())
    .slice(0, params.limit ?? 10);

  return { items };
};
```

- [ ] **Step 2: Write test for search_digests handler**

Add to test file:
```typescript
describe("handleSearchDigests", () => {
  it("groups search results by digest", async () => {
    const mockSearch: SearchService = {
      searchByKeyword: vi.fn().mockResolvedValue([
        { postId: "p1", digestId: "d1", digestDate: new Date("2026-03-12"), subreddit: "test", title: "A", score: 10, summarySnippet: "...", matchHighlights: [], relevanceRank: 1, sentiment: null, redditId: "r1" },
        { postId: "p2", digestId: "d1", digestDate: new Date("2026-03-12"), subreddit: "test", title: "B", score: 5, summarySnippet: "...", matchHighlights: [], relevanceRank: 0.8, sentiment: null, redditId: "r2" },
      ]),
      searchBySimilarity: vi.fn(),
      findSimilar: vi.fn(),
      searchHybrid: vi.fn(),
    };

    const ctx: HandlerContext = {
      ...stub<HandlerContext>(),
      searchService: mockSearch,
    };

    const result = await handleSearchDigests({ query: "test" }, ctx);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.matchedPosts).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Update MCP tool schema for search_digests**

In `packages/mcp-server/src/tools.ts`, update the `search_digests` tool:

```typescript
{
  query: z.string().describe("Full-text search query"),
  since: z.string().optional().describe("Duration filter, e.g. '7d'"),
  subreddit: z.string().optional().describe("Filter to subreddit"),
  limit: z.number().optional().describe("Max digest results (default 10)"),
}
```

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/queries/handlers/search-digests.ts packages/mcp-server/src/tools.ts
git commit -m "feat: upgrade search_digests to FTS with per-post matches

Returns matched posts grouped by digest instead of raw markdown blob."
```

---

### Task 15: New `find_similar` Tool

**Files:**
- Create: `packages/core/src/queries/handlers/find-similar.ts`
- Modify: `packages/core/src/queries/handlers/index.ts`
- Modify: `packages/mcp-server/src/tools.ts`

- [ ] **Step 1: Write failing test**

Add to test file:
```typescript
describe("handleFindSimilar", () => {
  it("returns source post and similar results", async () => {
    const mockSearch: SearchService = {
      searchByKeyword: vi.fn(),
      searchBySimilarity: vi.fn(),
      findSimilar: vi.fn().mockResolvedValue([]),
      searchHybrid: vi.fn(),
    };

    const mockDb = {
      post: {
        findUnique: vi.fn().mockResolvedValue({
          id: "post-1",
          title: "Test",
          subreddit: "test",
        }),
      },
    };

    const ctx: HandlerContext = {
      ...stub<HandlerContext>(),
      db: mockDb as HandlerContext["db"],
      searchService: mockSearch,
    };

    const result = await handleFindSimilar({ postId: "post-1" }, ctx);
    expect(result.sourcePost).toEqual({ id: "post-1", title: "Test", subreddit: "test" });
    expect(result.similar).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement handler**

Create `packages/core/src/queries/handlers/find-similar.ts`:

```typescript
import type { QueryHandler } from "../types.js";
import { RedgestError } from "../../errors.js";

export const handleFindSimilar: QueryHandler<"FindSimilar"> = async (
  params,
  ctx,
) => {
  const post = await ctx.db.post.findUnique({
    where: { id: params.postId },
    select: { id: true, title: true, subreddit: true },
  });

  if (!post) {
    throw new RedgestError("NOT_FOUND", `Post ${params.postId} not found`);
  }

  if (!ctx.searchService) {
    return { sourcePost: post, similar: [] };
  }

  const similar = await ctx.searchService.findSimilar(params.postId, {
    subreddit: params.subreddit,
    limit: params.limit ?? 5,
  });

  return { sourcePost: post, similar };
};
```

- [ ] **Step 3: Register handler**

In `packages/core/src/queries/handlers/index.ts`, add import and registration:

```typescript
import { handleFindSimilar } from "./find-similar.js";
// ...
export const queryHandlers: QueryHandlerRegistry = {
  // ... existing handlers ...
  FindSimilar: handleFindSimilar,
};
// ...
export { handleFindSimilar };
```

- [ ] **Step 4: Add MCP tool**

In `packages/mcp-server/src/tools.ts`, add `find_similar` tool registration:

```typescript
server.tool(
  "find_similar",
  "Find posts similar to a given post using embedding similarity",
  {
    post_id: z.string().describe("Post ID to find similar posts for"),
    limit: z.number().optional().describe("Max results (default 5)"),
    subreddit: z.string().optional().describe("Filter to subreddit (omit for cross-subreddit)"),
  },
  safe(async (args) => {
    const result = await deps.query("FindSimilar", {
      postId: args.post_id,
      limit: args.limit,
      subreddit: args.subreddit,
    }, deps.ctx);
    return envelope(result);
  }),
);
```

- [ ] **Step 5: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/queries/handlers/find-similar.ts packages/core/src/queries/handlers/index.ts packages/mcp-server/src/tools.ts
git commit -m "feat: add find_similar MCP tool for embedding similarity search

Uses pgvector cosine similarity to find related posts. Cross-subreddit
by default to surface connections between communities."
```

---

### Task 16: New `ask_history` Tool

**Files:**
- Create: `packages/core/src/queries/handlers/ask-history.ts`
- Modify: `packages/core/src/queries/handlers/index.ts`
- Modify: `packages/mcp-server/src/tools.ts`

- [ ] **Step 1: Implement handler**

Create `packages/core/src/queries/handlers/ask-history.ts`:

```typescript
import type { QueryHandler } from "../types.js";
import { parseDuration } from "../utils/duration.js";

export const handleAskHistory: QueryHandler<"AskHistory"> = async (
  params,
  ctx,
) => {
  if (!ctx.searchService) {
    return { relevantPosts: [], searchStrategy: "keyword" as const };
  }

  const since = params.since
    ? new Date(Date.now() - parseDuration(params.since, 30 * 24 * 60 * 60 * 1000))
    : undefined;

  // Determine search strategy based on available capabilities
  // For now, we'll use keyword search. Hybrid search requires
  // generating an embedding for the question, which needs the
  // generateEmbedding function from PipelineDeps — we'll wire
  // that through in WS13 (embed step).
  const results = await ctx.searchService.searchByKeyword(params.question, {
    since,
    limit: 10,
  });

  // If subreddits filter provided, apply post-hoc
  const filtered = params.subreddits
    ? results.filter((r) => params.subreddits?.includes(r.subreddit))
    : results;

  return {
    relevantPosts: filtered,
    searchStrategy: "keyword" as const,
  };
};
```

Note: `ask_history` starts as keyword-only. WS13 adds the embedding generation needed for hybrid search. The handler will be updated in Task 20 (triage context injection) to use hybrid when embeddings are available.

- [ ] **Step 2: Register handler**

In `packages/core/src/queries/handlers/index.ts`:

```typescript
import { handleAskHistory } from "./ask-history.js";
// ...
  AskHistory: handleAskHistory,
// ...
export { handleAskHistory };
```

- [ ] **Step 3: Add MCP tool**

In `packages/mcp-server/src/tools.ts`:

```typescript
server.tool(
  "ask_history",
  "Search digest history with a natural language question. Returns relevant posts with context.",
  {
    question: z.string().describe("Natural language question about digest history"),
    subreddits: z.array(z.string()).optional().describe("Filter to specific subreddits"),
    since: z.string().optional().describe("Duration filter, e.g. '30d'"),
  },
  safe(async (args) => {
    const result = await deps.query("AskHistory", {
      question: args.question,
      subreddits: args.subreddits,
      since: args.since,
    }, deps.ctx);
    return envelope(result);
  }),
);
```

- [ ] **Step 4: Wire SearchService into bootstrap**

In `packages/mcp-server/src/bootstrap.ts`, create and inject SearchService:

```typescript
import { createSearchService } from "@redgest/core";

// After creating HandlerContext:
const searchService = createSearchService(db);
const ctx: HandlerContext = { db, eventBus, config, searchService };
```

- [ ] **Step 5: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/queries/handlers/ask-history.ts packages/core/src/queries/handlers/index.ts packages/mcp-server/src/tools.ts packages/mcp-server/src/bootstrap.ts
git commit -m "feat: add ask_history MCP tool and wire SearchService

ask_history uses keyword search (hybrid added in WS13 after embed step).
SearchService injected via HandlerContext in bootstrap."
```

---

## Chunk 5: WS13 — Conversational Memory

### Task 17: Embedding Generation Function

**Files:**
- Create: `packages/llm/src/generate-embedding.ts`
- Modify: `packages/llm/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/llm/src/__tests__/generate-embedding.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { generateEmbeddings } from "../generate-embedding.js";

describe("generateEmbeddings", () => {
  it("returns empty result for empty input", async () => {
    const result = await generateEmbeddings([], "test-key");
    expect(result.embeddings).toEqual([]);
    expect(result.log).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @redgest/llm exec vitest run src/__tests__/generate-embedding.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement embedding function**

Create `packages/llm/src/generate-embedding.ts`:

```typescript
import type { LlmCallLog } from "./middleware.js";

export interface EmbeddingResult {
  embeddings: number[][];
  log: LlmCallLog | null;
}

/**
 * Generate embeddings for a batch of texts using OpenAI text-embedding-3-small.
 * Returns empty result if no texts provided.
 */
export async function generateEmbeddings(
  texts: string[],
  apiKey: string,
): Promise<EmbeddingResult> {
  if (texts.length === 0) {
    return { embeddings: [], log: null };
  }

  const start = Date.now();

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI embedding API error: ${response.status} ${err}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage: { prompt_tokens: number; total_tokens: number };
  };

  const durationMs = Date.now() - start;

  // Sort by index to match input order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((d) => d.embedding);

  const log: LlmCallLog = {
    task: "embed",
    model: "text-embedding-3-small",
    inputTokens: data.usage.prompt_tokens,
    outputTokens: 0,
    totalTokens: data.usage.total_tokens,
    durationMs,
    cached: false,
    finishReason: "complete",
  };

  return { embeddings, log };
}
```

- [ ] **Step 4: Export from LLM package**

In `packages/llm/src/index.ts`, add:

```typescript
export { generateEmbeddings, type EmbeddingResult } from "./generate-embedding.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @redgest/llm exec vitest run src/__tests__/generate-embedding.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/llm/src/generate-embedding.ts packages/llm/src/__tests__/generate-embedding.test.ts packages/llm/src/index.ts
git commit -m "feat(llm): add generateEmbeddings function for text-embedding-3-small

Batch embedding via OpenAI API with LlmCallLog for observability."
```

---

### Task 18: Embed Pipeline Step

**Files:**
- Modify: `packages/core/src/pipeline/types.ts`
- Create: `packages/core/src/pipeline/embed-step.ts`
- Modify: `packages/core/src/pipeline/orchestrator.ts`

- [ ] **Step 1: Add types to PipelineDeps**

In `packages/core/src/pipeline/types.ts`, add to the `PipelineDeps` interface:

```typescript
  /** Override embedding function for testing. */
  generateEmbedding?: (texts: string[]) => Promise<{
    embeddings: number[][];
    log: { task: string; model: string; inputTokens: number; outputTokens: number; durationMs: number; cached: boolean; finishReason: string } | null;
  }>;
```

Add new step result type:

```typescript
/** Result of embedding generation for post summaries. */
export interface EmbedStepResult {
  embeddedCount: number;
  skippedCount: number;
}
```

- [ ] **Step 2: Write failing test**

Create `packages/core/src/__tests__/embed-step.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { embedStep } from "../pipeline/embed-step.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("embedStep", () => {
  it("generates embeddings for summaries and writes to DB", async () => {
    const fakeEmbedding = new Array(1536).fill(0.1);
    const mockGenerateEmbedding = vi.fn().mockResolvedValue({
      embeddings: [fakeEmbedding],
      log: { task: "embed", model: "test", inputTokens: 10, outputTokens: 0, durationMs: 100, cached: false, finishReason: "complete" },
    });

    const mockDb = {
      $executeRaw: vi.fn(),
      llmCall: { create: vi.fn() },
    };

    const summaries = [
      { postSummaryId: "sum-1", summary: { summary: "Test summary", keyTakeaways: ["takeaway"], insightNotes: "notes" } },
    ];

    const result = await embedStep(
      summaries,
      "job-1",
      stub(),
      mockGenerateEmbedding,
    );

    expect(result.embeddedCount).toBe(1);
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("returns zero counts when no generate function provided", async () => {
    const result = await embedStep([], "job-1", stub());
    expect(result.embeddedCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/embed-step.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement embed step**

Create `packages/core/src/pipeline/embed-step.ts`:

```typescript
import type { PrismaClient } from "@redgest/db";
import type { EmbedStepResult, PipelineDeps, PostSummary } from "./types.js";

interface SummaryInput {
  postSummaryId: string;
  summary: Pick<PostSummary, "summary" | "keyTakeaways" | "insightNotes">;
}

/**
 * Generate embeddings for post summaries and write to DB.
 * Non-fatal — if embedding fails, the digest is still complete.
 */
export async function embedStep(
  summaries: SummaryInput[],
  jobId: string,
  db: PrismaClient,
  generateEmbedding?: PipelineDeps["generateEmbedding"],
): Promise<EmbedStepResult> {
  if (!generateEmbedding || summaries.length === 0) {
    return { embeddedCount: 0, skippedCount: summaries.length };
  }

  try {
    // Build text blocks for embedding
    const texts = summaries.map((s) => {
      const takeaways = Array.isArray(s.summary.keyTakeaways)
        ? s.summary.keyTakeaways.join(". ")
        : "";
      return `${s.summary.summary} ${takeaways} ${s.summary.insightNotes ?? ""}`.trim();
    });

    const { embeddings, log } = await generateEmbedding(texts);

    // Write embeddings to DB
    let embeddedCount = 0;
    for (let i = 0; i < summaries.length; i++) {
      const embedding = embeddings[i];
      const summary = summaries[i];
      if (!embedding || !summary) continue;

      const vecStr = `[${embedding.join(",")}]`;
      await db.$executeRaw`
        UPDATE post_summaries
        SET embedding = ${vecStr}::vector
        WHERE id = ${summary.postSummaryId}
      `;
      embeddedCount++;
    }

    // Log the LLM call
    if (log) {
      await db.llmCall.create({
        data: {
          jobId,
          task: log.task,
          model: log.model,
          inputTokens: log.inputTokens,
          outputTokens: log.outputTokens,
          durationMs: log.durationMs,
          cached: log.cached,
          finishReason: log.finishReason,
        },
      });
    }

    return { embeddedCount, skippedCount: summaries.length - embeddedCount };
  } catch (err) {
    console.error(
      `[embedStep] Non-fatal error: ${err instanceof Error ? err.message : err}`,
    );
    return { embeddedCount: 0, skippedCount: summaries.length };
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/embed-step.test.ts`
Expected: PASS.

- [ ] **Step 6: Integrate into orchestrator**

In `packages/core/src/pipeline/orchestrator.ts`, import and call `embedStep` after assembleStep:

```typescript
import { embedStep } from "./embed-step.js";
```

After the assemble step (around line 348), before updating final job status:

```typescript
  // --- Post-assembly: Embed summaries (non-fatal) ---
  const allSummaries = subredditResults.flatMap((sr) =>
    sr.posts.map((p) => ({
      postSummaryId: p.postId, // Will need actual postSummaryId
      summary: p.summary,
    })),
  );

  // Build generateEmbedding from deps or config
  let generateEmbeddingFn = deps.generateEmbedding;
  if (!generateEmbeddingFn && deps.config.OPENAI_API_KEY) {
    const { generateEmbeddings } = await import("@redgest/llm");
    const apiKey = deps.config.OPENAI_API_KEY;
    generateEmbeddingFn = (texts: string[]) => generateEmbeddings(texts, apiKey);
  }

  await embedStep(allSummaries, jobId, db, generateEmbeddingFn);
```

Note: The `postSummaryId` mapping needs adjustment during implementation — `SummarizeStepResult` returns `postSummaryId` but it's not threaded through `SubredditPipelineResult`. The implementer should add `postSummaryId` to `SubredditPipelineResult.posts` during the summarize loop.

- [ ] **Step 7: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/pipeline/embed-step.ts packages/core/src/__tests__/embed-step.test.ts packages/core/src/pipeline/orchestrator.ts packages/core/src/pipeline/types.ts
git commit -m "feat(core): add embed step to pipeline for semantic search

Generates embeddings for post summaries post-assembly using
text-embedding-3-small. Non-fatal — pipeline completes without it."
```

---

### Task 19: Topic Extraction Step

**Files:**
- Create: `packages/llm/src/generate-topics.ts`
- Create: `packages/core/src/pipeline/topic-step.ts`
- Modify: `packages/core/src/pipeline/types.ts`

- [ ] **Step 1: Create topic extraction LLM function**

Create `packages/llm/src/generate-topics.ts`:

```typescript
import { z } from "zod";
import { getModel, type ModelConfig } from "./provider.js";
import { generateWithLogging, type LlmCallLog } from "./middleware.js";

const TopicExtractionSchema = z.object({
  topics: z.array(
    z.object({
      name: z.string().describe("Canonical topic name, e.g. 'Server Components' not 'RSC'"),
      relatedPosts: z.array(z.number()).describe("Indices into the input posts array"),
      sentiment: z.enum(["positive", "negative", "neutral", "mixed"]).describe("Overall sentiment"),
    }),
  ).describe("5-10 topics extracted from the summaries"),
});

export type TopicExtractionResult = z.infer<typeof TopicExtractionSchema>;

const SYSTEM_PROMPT = `You are a topic extraction system for a Reddit digest tool.
Given a list of post summaries, extract 5-10 distinct topics that are discussed.

Rules:
- Use canonical, widely-recognized names (e.g., "Server Components" not "RSC" or "React Server Components")
- Merge near-synonyms into one topic
- Each topic should appear in at least one post
- Sentiment reflects the overall community feeling about that topic`;

export async function generateTopicExtraction(
  summaries: Array<{ index: number; title: string; summary: string; subreddit: string }>,
  existingTopics: string[],
  model?: ModelConfig,
): Promise<{ data: TopicExtractionResult; log: LlmCallLog | null }> {
  const llmModel = model ? getModel("topics", model) : getModel("topics");

  const userPrompt = `Extract topics from these post summaries:

${summaries.map((s) => `${s.index}. [${s.subreddit}] "${s.title}" — ${s.summary}`).join("\n\n")}

${existingTopics.length > 0 ? `\nExisting topics in the system (reuse these names when they match):\n${existingTopics.map((t) => `- ${t}`).join("\n")}` : ""}

Return 5-10 topics.`;

  // Uses generateWithLogging which wraps generateText + Output.object internally
  const { output, log } = await generateWithLogging<TopicExtractionResult>({
    task: "topics",
    model: llmModel,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    schema: TopicExtractionSchema,
  });

  return { data: output, log };
}
```

Export from `packages/llm/src/index.ts`:
```typescript
export { generateTopicExtraction, type TopicExtractionResult } from "./generate-topics.js";
```

Note: `getModel("topics")` will fall through to the default model. Add `topics` to `DEFAULT_MODELS` in `provider.ts` using haiku (cheapest model for this task):

```typescript
  topics: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
```

- [ ] **Step 2: Add TopicStepResult to types**

In `packages/core/src/pipeline/types.ts`:

```typescript
/** Result of topic extraction for a pipeline run. */
export interface TopicStepResult {
  topicCount: number;
  newTopics: string[];
  updatedTopics: string[];
}
```

- [ ] **Step 3: Implement topic step**

Create `packages/core/src/pipeline/topic-step.ts`:

```typescript
import type { PrismaClient } from "@redgest/db";
import type { TopicStepResult, PostSummary } from "./types.js";

interface TopicInput {
  postId: string;
  title: string;
  subreddit: string;
  summary: PostSummary;
}

interface ExtractedTopic {
  name: string;
  relatedPosts: number[];
  sentiment: string;
}

/**
 * Extract topics from summaries and persist to topics/post_topics tables.
 * Non-fatal — topic extraction failure doesn't affect digest.
 */
export async function topicStep(
  posts: TopicInput[],
  jobId: string,
  db: PrismaClient,
  extractTopics?: (
    summaries: Array<{ index: number; title: string; summary: string; subreddit: string }>,
    existingTopics: string[],
  ) => Promise<{ data: { topics: ExtractedTopic[] }; log: unknown }>,
): Promise<TopicStepResult> {
  if (!extractTopics || posts.length === 0) {
    return { topicCount: 0, newTopics: [], updatedTopics: [] };
  }

  try {
    // Load existing topic names for canonicalization
    const existingTopics = await db.topic.findMany({
      select: { name: true },
      orderBy: { frequency: "desc" },
      take: 50,
    });
    const existingNames = existingTopics.map((t) => t.name);

    // Build input
    const summaryInputs = posts.map((p, i) => ({
      index: i,
      title: p.title,
      summary: p.summary.summary,
      subreddit: p.subreddit,
    }));

    const { data } = await extractTopics(summaryInputs, existingNames);

    const newTopics: string[] = [];
    const updatedTopics: string[] = [];

    for (const topic of data.topics) {
      // Upsert topic
      const existing = await db.topic.findUnique({
        where: { name: topic.name },
      });

      let topicId: string;
      if (existing) {
        await db.topic.update({
          where: { id: existing.id },
          data: {
            frequency: { increment: 1 },
            lastSeen: new Date(),
          },
        });
        topicId = existing.id;
        updatedTopics.push(topic.name);
      } else {
        const created = await db.topic.create({
          data: { name: topic.name },
        });
        topicId = created.id;
        newTopics.push(topic.name);
      }

      // Create post_topics links
      for (const postIndex of topic.relatedPosts) {
        const post = posts[postIndex];
        if (!post) continue;

        await db.postTopic.upsert({
          where: {
            postId_topicId: { postId: post.postId, topicId },
          },
          create: {
            postId: post.postId,
            topicId,
            relevance: 1.0,
          },
          update: {},
        });
      }
    }

    return {
      topicCount: data.topics.length,
      newTopics,
      updatedTopics,
    };
  } catch (err) {
    console.error(
      `[topicStep] Non-fatal error: ${err instanceof Error ? err.message : err}`,
    );
    return { topicCount: 0, newTopics: [], updatedTopics: [] };
  }
}
```

- [ ] **Step 4: Write test for topic step**

Create `packages/core/src/__tests__/topic-step.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { topicStep } from "../pipeline/topic-step.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("topicStep", () => {
  it("returns zero counts when no extractTopics function provided", async () => {
    const result = await topicStep([], "job-1", stub());
    expect(result.topicCount).toBe(0);
  });

  it("extracts topics and persists them", async () => {
    const mockExtract = vi.fn().mockResolvedValue({
      data: {
        topics: [
          { name: "Server Components", relatedPosts: [0], sentiment: "positive" },
        ],
      },
      log: null,
    });

    const mockDb = {
      topic: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "topic-1" }),
      },
      postTopic: {
        upsert: vi.fn(),
      },
    };

    const posts = [
      {
        postId: "post-1",
        title: "RSC Deep Dive",
        subreddit: "nextjs",
        summary: {
          summary: "Great overview of Server Components",
          keyTakeaways: [],
          insightNotes: "",
          communityConsensus: null,
          commentHighlights: [],
          sentiment: "positive" as const,
          relevanceScore: 0.8,
          contentType: "text" as const,
          notableLinks: [],
        },
      },
    ];

    const result = await topicStep(posts, "job-1", stub(), mockExtract);
    expect(result.topicCount).toBe(1);
    expect(result.newTopics).toContain("Server Components");
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/topic-step.test.ts`
Expected: PASS.

- [ ] **Step 6: Integrate into orchestrator**

In `packages/core/src/pipeline/orchestrator.ts`, import and call topicStep after embedStep:

```typescript
import { topicStep } from "./topic-step.js";
```

After the embed step call:

```typescript
  // --- Post-assembly: Extract topics (non-fatal) ---
  const topicInputs = subredditResults.flatMap((sr) =>
    sr.posts.map((p) => ({
      postId: p.postId,
      title: p.title,
      subreddit: sr.subreddit,
      summary: p.summary,
    })),
  );

  // Build topic extraction function from deps
  let extractTopicsFn: Parameters<typeof topicStep>[3];
  if (deps.config.ANTHROPIC_API_KEY || deps.config.OPENAI_API_KEY) {
    const { generateTopicExtraction } = await import("@redgest/llm");
    const model = runtimeModel;
    extractTopicsFn = (summaries, existingTopics) =>
      generateTopicExtraction(summaries, existingTopics, model);
  }

  await topicStep(topicInputs, jobId, db, extractTopicsFn);
```

- [ ] **Step 7: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add packages/llm/src/generate-topics.ts packages/llm/src/index.ts packages/core/src/pipeline/topic-step.ts packages/core/src/__tests__/topic-step.test.ts packages/core/src/pipeline/orchestrator.ts packages/core/src/pipeline/types.ts packages/llm/src/provider.ts
git commit -m "feat(core): add topic extraction step to pipeline

Extracts 5-10 topics per digest run via cheap LLM call. Upserts to
topics table with frequency tracking. Non-fatal on failure."
```

---

### Task 20: Triage Context Injection

**Files:**
- Modify: `packages/llm/src/prompts/triage.ts`
- Modify: `packages/core/src/pipeline/orchestrator.ts`

- [ ] **Step 1: Add recent topics context to triage prompt**

In `packages/llm/src/prompts/triage.ts`, update `buildTriageSystemPrompt` to accept optional recent topics:

```typescript
export interface RecentTopicContext {
  date: string;
  name: string;
  subreddit: string;
  sentiment: string;
}

export function buildTriageSystemPrompt(
  insightPrompts: string[],
  recentTopics?: RecentTopicContext[],
): string {
  let prompt = `You are a content evaluator for a personal Reddit digest system...`; // existing content

  if (recentTopics && recentTopics.length > 0) {
    prompt += `\n\n## Recent Digest Context
Topics from recent digests for context — use to identify novel angles vs repetition:
${recentTopics.map((t) => `- [${t.date}] ${t.name}: discussed in r/${t.subreddit} (${t.sentiment} sentiment)`).join("\n")}`;
  }

  return prompt;
}
```

- [ ] **Step 2: Load recent topics in orchestrator and pass to triage**

In `packages/core/src/pipeline/orchestrator.ts`, before the subreddit loop, load recent topics:

```typescript
  // Load recent topics for triage context injection
  const recentTopics = await db.$queryRaw<
    Array<{ name: string; subreddit: string; sentiment: string; last_seen: Date }>
  >`
    SELECT DISTINCT t.name, p.subreddit, ps.sentiment, t.last_seen
    FROM topics t
    JOIN post_topics pt ON pt.topic_id = t.id
    JOIN posts p ON p.id = pt.post_id
    JOIN LATERAL (
      SELECT ps2.sentiment FROM post_summaries ps2
      WHERE ps2.post_id = p.id
      ORDER BY ps2.created_at DESC LIMIT 1
    ) ps ON true
    WHERE t.last_seen > ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)}
    ORDER BY t.last_seen DESC
    LIMIT 10
  `;

  const topicContext = recentTopics.map((t) => ({
    date: t.last_seen.toISOString().split("T")[0] ?? "",
    name: t.name,
    subreddit: t.subreddit,
    sentiment: t.sentiment ?? "neutral",
  }));
```

Then pass `topicContext` to the triage call. The `buildTriageSystemPrompt` is called inside `generateTriageResult` in `@redgest/llm`. The cleanest approach: pass `topicContext` as an optional field in the triage step call, which forwards it to the prompt builder.

This requires updating `triageStep` and `generateTriageResult` to accept `recentTopics`. The implementer should thread this through:

1. `orchestrator.ts` → `triageStep(..., topicContext)`
2. `triage-step.ts` → `generateTriageResult(..., recentTopics)`
3. `generate-triage.ts` → `buildTriageSystemPrompt(insightPrompts, recentTopics)`

- [ ] **Step 3: Write test for context injection**

Add to triage prompt tests in `packages/llm/src/__tests__/prompts.test.ts`:

```typescript
it("includes recent topics context when provided", () => {
  const result = buildTriageSystemPrompt(["general tech news"], [
    { date: "2026-03-12", name: "Server Components", subreddit: "nextjs", sentiment: "mixed" },
  ]);
  expect(result).toContain("Recent Digest Context");
  expect(result).toContain("Server Components");
  expect(result).toContain("r/nextjs");
});

it("omits context section when no recent topics", () => {
  const result = buildTriageSystemPrompt(["general tech news"]);
  expect(result).not.toContain("Recent Digest Context");
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/prompts/triage.ts packages/llm/src/__tests__/prompts.test.ts packages/core/src/pipeline/orchestrator.ts
git commit -m "feat: inject recent topics into triage system prompt

Triage LLM now sees last 7 days of topics for context. Helps
deprioritize already-covered topics unless there's a new angle."
```

---

### Task 21: `get_trending_topics` Tool

**Files:**
- Modify: `packages/core/src/queries/types.ts`
- Create: `packages/core/src/queries/handlers/get-trending-topics.ts`
- Modify: `packages/core/src/queries/handlers/index.ts`
- Modify: `packages/mcp-server/src/tools.ts`

- [ ] **Step 1: Add types**

In `packages/core/src/queries/types.ts`, add:

```typescript
export interface TrendingTopic {
  name: string;
  frequency: number;
  sentimentTrend: "stable" | "improving" | "declining" | "volatile";
  subreddits: string[];
  examplePosts: Array<{ postId: string; title: string }>;
  firstSeen: string;
  lastSeen: string;
}
```

Add to `QueryMap`:
```typescript
  GetTrendingTopics: { since?: string; subreddits?: string[]; limit?: number };
```

Add to `QueryResultMap`:
```typescript
  GetTrendingTopics: { topics: TrendingTopic[] };
```

- [ ] **Step 2: Implement handler**

Create `packages/core/src/queries/handlers/get-trending-topics.ts`:

```typescript
import type { QueryHandler, TrendingTopic } from "../types.js";
import { parseDuration } from "../utils/duration.js";

export const handleGetTrendingTopics: QueryHandler<"GetTrendingTopics"> = async (
  params,
  ctx,
) => {
  const limit = params.limit ?? 10;
  const since = params.since
    ? new Date(Date.now() - parseDuration(params.since))
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // default 7d

  const topics = await ctx.db.topic.findMany({
    where: {
      lastSeen: { gte: since },
    },
    orderBy: { frequency: "desc" },
    take: limit,
    include: {
      posts: {
        include: {
          post: { select: { id: true, title: true, subreddit: true } },
        },
        take: 3,
      },
    },
  });

  const result: TrendingTopic[] = topics.map((t) => {
    const subreddits = [...new Set(t.posts.map((pt) => pt.post.subreddit))];
    return {
      name: t.name,
      frequency: t.frequency,
      sentimentTrend: "stable", // Simplified — full trend analysis deferred
      subreddits,
      examplePosts: t.posts.map((pt) => ({
        postId: pt.post.id,
        title: pt.post.title,
      })),
      firstSeen: t.firstSeen.toISOString(),
      lastSeen: t.lastSeen.toISOString(),
    };
  });

  // Apply subreddits filter if provided
  const filtered = params.subreddits
    ? result.filter((t) =>
        t.subreddits.some((s) => params.subreddits?.includes(s)),
      )
    : result;

  return { topics: filtered };
};
```

- [ ] **Step 3: Register handler + add MCP tool**

Register in `packages/core/src/queries/handlers/index.ts`.

Add MCP tool in `packages/mcp-server/src/tools.ts`:

```typescript
server.tool(
  "get_trending_topics",
  "Get trending topics across recent digests",
  {
    since: z.string().optional().describe("Duration filter, e.g. '7d' (default)"),
    subreddits: z.array(z.string()).optional().describe("Filter to specific subreddits"),
    limit: z.number().optional().describe("Max topics (default 10)"),
  },
  safe(async (args) => {
    const result = await deps.query("GetTrendingTopics", {
      since: args.since,
      subreddits: args.subreddits,
      limit: args.limit,
    }, deps.ctx);
    return envelope(result);
  }),
);
```

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/queries/types.ts packages/core/src/queries/handlers/get-trending-topics.ts packages/core/src/queries/handlers/index.ts packages/mcp-server/src/tools.ts
git commit -m "feat: add get_trending_topics MCP tool

Returns topics with frequency, subreddit distribution, and example
posts from recent digests."
```

---

### Task 22: `compare_periods` Tool

**Files:**
- Modify: `packages/core/src/queries/types.ts`
- Create: `packages/core/src/queries/handlers/compare-periods.ts`
- Modify: `packages/core/src/queries/handlers/index.ts`
- Modify: `packages/mcp-server/src/tools.ts`

- [ ] **Step 1: Add types**

In `packages/core/src/queries/types.ts`, add:

```typescript
export interface TopicSummary {
  name: string;
  frequency: number;
  sentiment: string;
}

export interface TopicChange {
  name: string;
  period1Sentiment: string;
  period2Sentiment: string;
  frequencyChange: number;
}
```

Add to `QueryMap`:
```typescript
  ComparePeriods: { period1: string; period2: string; subreddits?: string[] };
```

Add to `QueryResultMap`:
```typescript
  ComparePeriods: {
    newTopics: TopicSummary[];
    goneTopics: TopicSummary[];
    changedTopics: TopicChange[];
    summary: string;
  };
```

- [ ] **Step 2: Implement handler**

Create `packages/core/src/queries/handlers/compare-periods.ts`:

```typescript
import type { QueryHandler, TopicSummary, TopicChange } from "../types.js";

export const handleComparePeriods: QueryHandler<"ComparePeriods"> = async (
  params,
  ctx,
) => {
  const [start1, end1] = parsePeriod(params.period1);
  const [start2, end2] = parsePeriod(params.period2);

  // Fetch topics that have posts in each period (via post_topics → posts join)
  const [period1Topics, period2Topics] = await Promise.all([
    ctx.db.topic.findMany({
      where: {
        posts: {
          some: {
            post: { fetchedAt: { gte: start1, lte: end1 } },
          },
        },
      },
      select: { name: true, frequency: true },
    }),
    ctx.db.topic.findMany({
      where: {
        posts: {
          some: {
            post: { fetchedAt: { gte: start2, lte: end2 } },
          },
        },
      },
      select: { name: true, frequency: true },
    }),
  ]);

  const p1Names = new Set(period1Topics.map((t) => t.name));
  const p2Names = new Set(period2Topics.map((t) => t.name));

  const newTopics: TopicSummary[] = period2Topics
    .filter((t) => !p1Names.has(t.name))
    .map((t) => ({ name: t.name, frequency: t.frequency, sentiment: "neutral" }));

  const goneTopics: TopicSummary[] = period1Topics
    .filter((t) => !p2Names.has(t.name))
    .map((t) => ({ name: t.name, frequency: t.frequency, sentiment: "neutral" }));

  const changedTopics: TopicChange[] = [];
  for (const t2 of period2Topics) {
    const t1 = period1Topics.find((t) => t.name === t2.name);
    if (t1 && t1.frequency !== t2.frequency) {
      changedTopics.push({
        name: t2.name,
        period1Sentiment: "neutral",
        period2Sentiment: "neutral",
        frequencyChange: t2.frequency - t1.frequency,
      });
    }
  }

  const summary = `${newTopics.length} new topics, ${goneTopics.length} dropped, ${changedTopics.length} changed frequency.`;

  return { newTopics, goneTopics, changedTopics, summary };
};

/** Parse period string like "0d-7d" to [start, end] dates. */
function parsePeriod(period: string): [Date, Date] {
  const match = period.match(/^(\d+)d-(\d+)d$/);
  if (!match) {
    return [new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), new Date()];
  }
  const startDays = parseInt(match[2] ?? "7", 10);
  const endDays = parseInt(match[1] ?? "0", 10);
  return [
    new Date(Date.now() - startDays * 24 * 60 * 60 * 1000),
    new Date(Date.now() - endDays * 24 * 60 * 60 * 1000),
  ];
}
```

- [ ] **Step 3: Register handler + add MCP tool**

Register in `packages/core/src/queries/handlers/index.ts`.

Add MCP tool in `packages/mcp-server/src/tools.ts`:

```typescript
server.tool(
  "compare_periods",
  "Compare topics between two time periods to see what's new, gone, or changed",
  {
    period1: z.string().describe("First period, e.g. '7d-14d' (7-14 days ago)"),
    period2: z.string().describe("Second period, e.g. '0d-7d' (last 7 days)"),
    subreddits: z.array(z.string()).optional().describe("Filter to specific subreddits"),
  },
  safe(async (args) => {
    const result = await deps.query("ComparePeriods", {
      period1: args.period1,
      period2: args.period2,
      subreddits: args.subreddits,
    }, deps.ctx);
    return envelope(result);
  }),
);
```

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/queries/types.ts packages/core/src/queries/handlers/compare-periods.ts packages/core/src/queries/handlers/index.ts packages/mcp-server/src/tools.ts
git commit -m "feat: add compare_periods MCP tool

Two-window topic diff showing new, gone, and changed topics
between arbitrary time periods."
```

---

### Task 23: Upgrade `ask_history` to Hybrid Search

**Files:**
- Modify: `packages/core/src/queries/handlers/ask-history.ts`
- Modify: `packages/core/src/context.ts`

- [ ] **Step 1: Add embedding function to HandlerContext**

In `packages/core/src/context.ts`:

```typescript
export interface HandlerContext {
  db: DbClient;
  eventBus: DomainEventBus;
  config: RedgestConfig;
  searchService?: SearchService;
  generateEmbedding?: (texts: string[]) => Promise<{ embeddings: number[][]; log: unknown }>;
}
```

- [ ] **Step 2: Update ask_history to use hybrid search when available**

In `packages/core/src/queries/handlers/ask-history.ts` (keep existing imports, add `parseDuration` import from `../utils/duration.js` if not already present):

```typescript
import type { QueryHandler } from "../types.js";
import { parseDuration } from "../utils/duration.js";

export const handleAskHistory: QueryHandler<"AskHistory"> = async (
  params,
  ctx,
) => {
  if (!ctx.searchService) {
    return { relevantPosts: [], searchStrategy: "keyword" as const };
  }

  const since = params.since
    ? new Date(Date.now() - parseDuration(params.since))
    : undefined;

  const options = { since, limit: 10 };

  // Try hybrid search if embedding function available
  if (ctx.generateEmbedding) {
    try {
      const { embeddings } = await ctx.generateEmbedding([params.question]);
      const questionEmbedding = embeddings[0];
      if (questionEmbedding) {
        const results = await ctx.searchService.searchHybrid(
          params.question,
          questionEmbedding,
          options,
        );

        const filtered = params.subreddits
          ? results.filter((r) => params.subreddits?.includes(r.subreddit))
          : results;

        return { relevantPosts: filtered, searchStrategy: "hybrid" as const };
      }
    } catch {
      // Fall through to keyword search
    }
  }

  // Fallback: keyword only
  const results = await ctx.searchService.searchByKeyword(params.question, options);
  const filtered = params.subreddits
    ? results.filter((r) => params.subreddits?.includes(r.subreddit))
    : results;

  return { relevantPosts: filtered, searchStrategy: "keyword" as const };
};
```

- [ ] **Step 3: Wire embedding function in bootstrap**

In `packages/mcp-server/src/bootstrap.ts`, add after SearchService creation:

```typescript
  let generateEmbedding: HandlerContext["generateEmbedding"];
  if (config.OPENAI_API_KEY) {
    const openaiKey = config.OPENAI_API_KEY;
    generateEmbedding = async (texts: string[]) => {
      const { generateEmbeddings } = await import("@redgest/llm");
      return generateEmbeddings(texts, openaiKey);
    };
  }

  const ctx: HandlerContext = { db, eventBus, config, searchService, generateEmbedding };
```

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/queries/handlers/ask-history.ts packages/core/src/context.ts packages/mcp-server/src/bootstrap.ts
git commit -m "feat: upgrade ask_history to hybrid search with RRF fusion

When OPENAI_API_KEY is available, ask_history generates a question
embedding and uses RRF to merge keyword + semantic results."
```

---

### Task 24: Persist Summary Fields (communityConsensus, sentiment)

**Files:**
- Modify: `packages/core/src/pipeline/summarize-step.ts`

- [ ] **Step 1: Update summarize step to persist new fields**

In `packages/core/src/pipeline/summarize-step.ts`, find where the `PostSummary` is created in the DB and add the new fields:

```typescript
  // In the create call, add:
  communityConsensus: sumResult.summary.communityConsensus,
  sentiment: sumResult.summary.sentiment,
```

These fields already exist on the `PostSummary` Zod schema output but weren't being persisted to DB columns (the columns didn't exist until Task 7's migration).

- [ ] **Step 2: Run typecheck + tests**

Run: `pnpm check`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/pipeline/summarize-step.ts
git commit -m "feat(core): persist communityConsensus and sentiment to post_summaries

These fields were already in the LLM output schema but not written to DB.
Now persisted for use in search filtering and tsvector indexing."
```

---

## Summary

| Chunk | Work Stream | Tasks | Points |
|-------|------------|-------|--------|
| 1 | WS14: Pipeline QoL | 1-5 | 3pt |
| 2 | WS11: Schema + Migration | 6-8 | 3pt |
| 3 | WS11: SearchService + Backfill | 9-11 | 5pt |
| 4 | WS12: MCP Tool Upgrades | 12-16 | 5pt |
| 5 | WS13: Conversational Memory | 17-24 | 5pt |
| **Total** | | **24 tasks** | **21pt** |

### Dependency Order

```
Chunk 1 (WS14) ──────────────────► can ship independently

Chunk 2 (WS11 schema) ──► Chunk 3 (WS11 service) ──► Chunk 4 (WS12 tools)
                                        │
                                        └──► Chunk 5 (WS13 memory)
```

Chunks 4 and 5 can run in parallel once Chunk 3 is complete.
