# Sprint 4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all command/query handlers, LLM generate functions, and content fetcher to fully unblock WS6 (Pipeline).

**Architecture:** CQRS handlers dispatch through `createExecute()` and `createQuery()` factories built in Sprint 3. Command handlers write to Prisma tables inside transactions and return event payloads. Query handlers read from Prisma views (or tables for search/config). LLM functions wrap AI SDK v6 `generateText()` with `Output.object()`. Content fetcher orchestrates RedditClient + TokenBucket.

**Tech Stack:** TypeScript 5.9, Prisma v7 (views + tables), Vercel AI SDK v6, Vitest, Zod 4

**Design doc:** `docs/plans/2026-03-09-sprint-4-design.md`

---

## Dependencies Between Tasks

```
Task 1 (prerequisites) ──┬──> Task 2 (command handlers)
                          └──> Task 3 (query handlers)

Task 4 (provider) ──┬──> Task 5 (generateTriageResult)
                    └──> Task 6 (generatePostSummary)

Task 7 (content fetcher) — independent

Task 8 (barrel exports) — depends on all above
```

Tasks 2+3 can run in parallel. Tasks 5+6 can run in parallel. Task 7 is fully independent.

---

## Codebase Context

**Lint rules to respect:**
- `objectLiteralTypeAssertions: "never"` — cannot write `{} as Type`. Use `stub<T>()` helper or assign to variable first, then cast.
- All tests use `import { describe, it, expect, vi } from "vitest"`.

**Test helper pattern** (from `packages/core/src/__tests__/execute.test.ts`):
```ts
function stub<T>(): T {
  const empty = {};
  return empty as T;
}
```

**Key types already defined:**
- `CommandHandler<K>` — `(params: CommandMap[K], ctx: HandlerContext) => Promise<{ data: CommandResultMap[K], event: payload | null }>`
- `QueryHandler<K>` — `(params: QueryMap[K], ctx: HandlerContext) => Promise<QueryResultMap[K]>`
- `HandlerContext` — `{ db: DbClient, eventBus: DomainEventBus, config: RedgestConfig }`
- `DbClient` — `PrismaClient | TransactionClient`

**Prisma enum values:**
- `JobStatus`: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `PARTIAL`
- `DeliveryChannel`: `NONE`, `EMAIL`, `SLACK`, `ALL`

**Prisma views available:** `DigestView`, `PostView`, `RunView`, `SubredditView` (all with `@unique` identifier fields)

---

## Task 1: Prerequisite Fixes

**Files:**
- Modify: `packages/core/src/commands/types.ts:42` — change RemoveSubreddit result type
- Modify: `packages/core/src/commands/dispatch.ts:161-171` — fix extractAggregateId
- Modify: `packages/core/src/queries/types.ts` — refine QueryResultMap with Prisma types
- Modify: `packages/core/src/__tests__/execute.test.ts` — update RemoveSubreddit test expectations

**Step 1: Fix RemoveSubreddit result type**

In `packages/core/src/commands/types.ts`, change line 42:

```ts
// Before:
RemoveSubreddit: { success: true };
// After:
RemoveSubreddit: { subredditId: string };
```

This gives `extractAggregateId` access to the subreddit ID from the result.

**Step 2: Fix extractAggregateId in dispatch.ts**

In `packages/core/src/commands/dispatch.ts`, replace `extractAggregateId` (lines 161-171):

```ts
function extractAggregateId(type: CommandType, data: unknown): string {
  const result = data as Record<string, unknown>;
  if (type === "GenerateDigest" && typeof result.jobId === "string") {
    return result.jobId;
  }
  if (typeof result.subredditId === "string") {
    return result.subredditId;
  }
  if (type === "UpdateConfig") {
    return "config-singleton";
  }
  return "unknown";
}
```

The existing `typeof result.subredditId === "string"` check now covers AddSubreddit, RemoveSubreddit, AND UpdateSubreddit. UpdateConfig explicitly returns "config-singleton". The fallback "unknown" is a safety net that should never be reached.

**Step 3: Refine QueryResultMap with Prisma types**

Replace the entire content of `packages/core/src/queries/types.ts`:

```ts
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
```

**Step 4: Run typecheck**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: PASS (no type errors)

**Step 5: Run existing tests**

Run: `pnpm --filter @redgest/core exec vitest run`
Expected: All existing tests pass. The execute.test.ts RemoveSubreddit test (line 134-152) still works because it tests null event handling — the mock handler returns `{ data: { subredditId: "sub-1" }, event: null }` which matches the new result type.

**Step 6: Commit**

```bash
git add packages/core/src/commands/types.ts packages/core/src/commands/dispatch.ts packages/core/src/queries/types.ts
git commit -m "fix: RemoveSubreddit result type + extractAggregateId + typed QueryResultMap

- Change RemoveSubreddit result from { success: true } to { subredditId }
- Fix extractAggregateId to explicitly handle UpdateConfig
- Refine QueryResultMap with Prisma view/table types (was all unknown)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Command Handlers + Registry + Tests

**Files:**
- Create: `packages/core/src/commands/handlers/generate-digest.ts`
- Create: `packages/core/src/commands/handlers/add-subreddit.ts`
- Create: `packages/core/src/commands/handlers/remove-subreddit.ts`
- Create: `packages/core/src/commands/handlers/update-subreddit.ts`
- Create: `packages/core/src/commands/handlers/update-config.ts`
- Create: `packages/core/src/commands/handlers/index.ts`
- Create: `packages/core/src/__tests__/command-handlers.test.ts`

### Step 1: Write the test file

Create `packages/core/src/__tests__/command-handlers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HandlerContext } from "../context.js";
import { DomainEventBus } from "../events/bus.js";
import { handleGenerateDigest } from "../commands/handlers/generate-digest.js";
import { handleAddSubreddit } from "../commands/handlers/add-subreddit.js";
import { handleRemoveSubreddit } from "../commands/handlers/remove-subreddit.js";
import { handleUpdateSubreddit } from "../commands/handlers/update-subreddit.js";
import { handleUpdateConfig } from "../commands/handlers/update-config.js";

/** Cast helper — avoids objectLiteralTypeAssertions lint rule. */
function stub<T>(): T {
  const empty = {};
  return empty as T;
}

function makeCtx(dbMock: Record<string, unknown>): HandlerContext {
  const db = dbMock;
  return {
    db: db as unknown as HandlerContext["db"],
    eventBus: new DomainEventBus(),
    config: stub<HandlerContext["config"]>(),
  };
}

// ── GenerateDigest ────────────────────────────────────────

describe("handleGenerateDigest", () => {
  it("creates a job and returns jobId + status", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "job-123",
      status: "QUEUED",
    });
    const ctx = makeCtx({ job: { create: mockCreate } });

    const result = await handleGenerateDigest(
      { subredditIds: ["sub-1", "sub-2"] },
      ctx,
    );

    expect(result.data).toEqual({ jobId: "job-123", status: "QUEUED" });
    expect(result.event).toEqual({
      jobId: "job-123",
      subredditIds: ["sub-1", "sub-2"],
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        status: "QUEUED",
        subreddits: ["sub-1", "sub-2"],
        lookback: "24h",
      },
    });
  });

  it("uses custom lookbackHours", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "job-456",
      status: "QUEUED",
    });
    const ctx = makeCtx({ job: { create: mockCreate } });

    await handleGenerateDigest({ lookbackHours: 48 }, ctx);

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ lookback: "48h" }),
    });
  });

  it("defaults subredditIds to empty array", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "job-789",
      status: "QUEUED",
    });
    const ctx = makeCtx({ job: { create: mockCreate } });

    const result = await handleGenerateDigest({}, ctx);

    expect(result.event).toEqual({
      jobId: "job-789",
      subredditIds: [],
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ subreddits: [] }),
    });
  });
});

// ── AddSubreddit ──────────────────────────────────────────

describe("handleAddSubreddit", () => {
  it("creates subreddit and returns id + event", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "sub-abc",
      name: "typescript",
    });
    const ctx = makeCtx({ subreddit: { create: mockCreate } });

    const result = await handleAddSubreddit(
      { name: "typescript", displayName: "TypeScript" },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-abc" });
    expect(result.event).toEqual({
      subredditId: "sub-abc",
      name: "typescript",
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: "typescript",
        insightPrompt: null,
        maxPosts: 5,
        includeNsfw: false,
      },
    });
  });

  it("passes optional fields through", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: "sub-def",
      name: "rust",
    });
    const ctx = makeCtx({ subreddit: { create: mockCreate } });

    await handleAddSubreddit(
      {
        name: "rust",
        displayName: "Rust",
        insightPrompt: "memory safety",
        maxPosts: 10,
        nsfw: true,
      },
      ctx,
    );

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: "rust",
        insightPrompt: "memory safety",
        maxPosts: 10,
        includeNsfw: true,
      },
    });
  });
});

// ── RemoveSubreddit ───────────────────────────────────────

describe("handleRemoveSubreddit", () => {
  it("soft-deletes subreddit by setting isActive=false", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({
      id: "sub-abc",
      name: "oldstuff",
    });
    const ctx = makeCtx({ subreddit: { update: mockUpdate } });

    const result = await handleRemoveSubreddit(
      { subredditId: "sub-abc" },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-abc" });
    expect(result.event).toEqual({
      subredditId: "sub-abc",
      name: "oldstuff",
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-abc" },
      data: { isActive: false },
      select: { id: true, name: true },
    });
  });
});

// ── UpdateSubreddit ───────────────────────────────────────

describe("handleUpdateSubreddit", () => {
  it("updates provided fields only", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-abc" });
    const ctx = makeCtx({ subreddit: { update: mockUpdate } });

    const result = await handleUpdateSubreddit(
      { subredditId: "sub-abc", insightPrompt: "new prompt", maxPosts: 20 },
      ctx,
    );

    expect(result.data).toEqual({ subredditId: "sub-abc" });
    expect(result.event).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-abc" },
      data: { insightPrompt: "new prompt", maxPosts: 20 },
    });
  });

  it("maps active param to isActive field", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-abc" });
    const ctx = makeCtx({ subreddit: { update: mockUpdate } });

    await handleUpdateSubreddit(
      { subredditId: "sub-abc", active: false },
      ctx,
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-abc" },
      data: { isActive: false },
    });
  });

  it("skips update fields that are undefined", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ id: "sub-abc" });
    const ctx = makeCtx({ subreddit: { update: mockUpdate } });

    await handleUpdateSubreddit({ subredditId: "sub-abc" }, ctx);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "sub-abc" },
      data: {},
    });
  });
});

// ── UpdateConfig ──────────────────────────────────────────

describe("handleUpdateConfig", () => {
  it("upserts config with provided fields", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    const result = await handleUpdateConfig(
      { globalInsightPrompt: "tech news", llmProvider: "anthropic" },
      ctx,
    );

    expect(result.data).toEqual({ success: true });
    expect(result.event).toEqual({
      changes: { globalInsightPrompt: "tech news", llmProvider: "anthropic" },
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: { globalInsightPrompt: "tech news", llmProvider: "anthropic" },
      create: expect.objectContaining({
        id: 1,
        globalInsightPrompt: "tech news",
        llmProvider: "anthropic",
      }),
    });
  });

  it("converts lookbackHours to string format", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    await handleUpdateConfig({ defaultLookbackHours: 48 }, ctx);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { defaultLookback: "48h" },
      }),
    );
  });

  it("emits event with only changed fields", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
    const ctx = makeCtx({ config: { upsert: mockUpsert } });

    const result = await handleUpdateConfig({ llmModel: "gpt-4.1" }, ctx);

    expect(result.event).toEqual({ changes: { llmModel: "gpt-4.1" } });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/command-handlers.test.ts`
Expected: FAIL — handler modules don't exist yet.

### Step 3: Create directory structure

Run: `mkdir -p packages/core/src/commands/handlers`

### Step 4: Implement GenerateDigest handler

Create `packages/core/src/commands/handlers/generate-digest.ts`:

```ts
import type { CommandHandler } from "../types.js";

export const handleGenerateDigest: CommandHandler<"GenerateDigest"> = async (
  params,
  ctx,
) => {
  const job = await ctx.db.job.create({
    data: {
      status: "QUEUED",
      subreddits: params.subredditIds ?? [],
      lookback: params.lookbackHours ? `${params.lookbackHours}h` : "24h",
    },
  });

  return {
    data: { jobId: job.id, status: job.status },
    event: { jobId: job.id, subredditIds: params.subredditIds ?? [] },
  };
};
```

### Step 5: Implement AddSubreddit handler

Create `packages/core/src/commands/handlers/add-subreddit.ts`:

```ts
import type { CommandHandler } from "../types.js";

export const handleAddSubreddit: CommandHandler<"AddSubreddit"> = async (
  params,
  ctx,
) => {
  const subreddit = await ctx.db.subreddit.create({
    data: {
      name: params.name,
      insightPrompt: params.insightPrompt ?? null,
      maxPosts: params.maxPosts ?? 5,
      includeNsfw: params.nsfw ?? false,
    },
  });

  return {
    data: { subredditId: subreddit.id },
    event: { subredditId: subreddit.id, name: subreddit.name },
  };
};
```

### Step 6: Implement RemoveSubreddit handler

Create `packages/core/src/commands/handlers/remove-subreddit.ts`:

```ts
import type { CommandHandler } from "../types.js";

export const handleRemoveSubreddit: CommandHandler<"RemoveSubreddit"> = async (
  params,
  ctx,
) => {
  const subreddit = await ctx.db.subreddit.update({
    where: { id: params.subredditId },
    data: { isActive: false },
    select: { id: true, name: true },
  });

  return {
    data: { subredditId: subreddit.id },
    event: { subredditId: subreddit.id, name: subreddit.name },
  };
};
```

### Step 7: Implement UpdateSubreddit handler

Create `packages/core/src/commands/handlers/update-subreddit.ts`:

```ts
import type { CommandHandler } from "../types.js";

export const handleUpdateSubreddit: CommandHandler<"UpdateSubreddit"> = async (
  params,
  ctx,
) => {
  const data: Record<string, unknown> = {};
  if (params.insightPrompt !== undefined) data.insightPrompt = params.insightPrompt;
  if (params.maxPosts !== undefined) data.maxPosts = params.maxPosts;
  if (params.active !== undefined) data.isActive = params.active;

  await ctx.db.subreddit.update({
    where: { id: params.subredditId },
    data,
  });

  return {
    data: { subredditId: params.subredditId },
    event: null,
  };
};
```

### Step 8: Implement UpdateConfig handler

Create `packages/core/src/commands/handlers/update-config.ts`:

```ts
import type { CommandHandler } from "../types.js";

export const handleUpdateConfig: CommandHandler<"UpdateConfig"> = async (
  params,
  ctx,
) => {
  const changes: Record<string, unknown> = {};
  if (params.globalInsightPrompt !== undefined) {
    changes.globalInsightPrompt = params.globalInsightPrompt;
  }
  if (params.defaultLookbackHours !== undefined) {
    changes.defaultLookback = `${params.defaultLookbackHours}h`;
  }
  if (params.llmProvider !== undefined) {
    changes.llmProvider = params.llmProvider;
  }
  if (params.llmModel !== undefined) {
    changes.llmModel = params.llmModel;
  }

  await ctx.db.config.upsert({
    where: { id: 1 },
    update: changes,
    create: {
      id: 1,
      globalInsightPrompt: (params.globalInsightPrompt as string) ?? "",
      llmProvider: (params.llmProvider as string) ?? "anthropic",
      llmModel: (params.llmModel as string) ?? "claude-sonnet-4-20250514",
      ...changes,
    },
  });

  return {
    data: { success: true as const },
    event: { changes },
  };
};
```

**Note on the `as string` casts**: The `create` branch needs concrete string values for required fields. `params.globalInsightPrompt` is `string | undefined`, and `?? ""` already handles the undefined case, but TypeScript may widen the nullish coalescing result. If the compiler is satisfied without the cast, remove it.

### Step 9: Create handler registry

Create `packages/core/src/commands/handlers/index.ts`:

```ts
import type { CommandType, CommandHandler } from "../types.js";
import { handleGenerateDigest } from "./generate-digest.js";
import { handleAddSubreddit } from "./add-subreddit.js";
import { handleRemoveSubreddit } from "./remove-subreddit.js";
import { handleUpdateSubreddit } from "./update-subreddit.js";
import { handleUpdateConfig } from "./update-config.js";

type HandlerRegistry = {
  [K in CommandType]?: CommandHandler<K>;
};

export const commandHandlers: HandlerRegistry = {
  GenerateDigest: handleGenerateDigest,
  AddSubreddit: handleAddSubreddit,
  RemoveSubreddit: handleRemoveSubreddit,
  UpdateSubreddit: handleUpdateSubreddit,
  UpdateConfig: handleUpdateConfig,
};

export {
  handleGenerateDigest,
  handleAddSubreddit,
  handleRemoveSubreddit,
  handleUpdateSubreddit,
  handleUpdateConfig,
};
```

### Step 10: Run tests

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/command-handlers.test.ts`
Expected: All 10 tests PASS.

### Step 11: Run full core test suite

Run: `pnpm --filter @redgest/core exec vitest run`
Expected: All tests pass (existing + new).

### Step 12: Commit

```bash
git add packages/core/src/commands/handlers/
git add packages/core/src/__tests__/command-handlers.test.ts
git commit -m "feat(core): add 5 command handlers with registry

- GenerateDigest: creates job with QUEUED status
- AddSubreddit: creates subreddit record
- RemoveSubreddit: soft-deletes via isActive=false
- UpdateSubreddit: partial update, no event
- UpdateConfig: upserts singleton config row
- Handler registry for createExecute() integration

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Query Handlers + Registry + Tests

**Files:**
- Create: `packages/core/src/queries/handlers/get-digest.ts`
- Create: `packages/core/src/queries/handlers/list-digests.ts`
- Create: `packages/core/src/queries/handlers/search-digests.ts`
- Create: `packages/core/src/queries/handlers/get-post.ts`
- Create: `packages/core/src/queries/handlers/search-posts.ts`
- Create: `packages/core/src/queries/handlers/get-run-status.ts`
- Create: `packages/core/src/queries/handlers/list-runs.ts`
- Create: `packages/core/src/queries/handlers/list-subreddits.ts`
- Create: `packages/core/src/queries/handlers/get-config.ts`
- Create: `packages/core/src/queries/handlers/index.ts`
- Create: `packages/core/src/__tests__/query-handlers.test.ts`

### Step 1: Write the test file

Create `packages/core/src/__tests__/query-handlers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { HandlerContext } from "../context.js";
import { DomainEventBus } from "../events/bus.js";
import { handleGetDigest } from "../queries/handlers/get-digest.js";
import { handleListDigests } from "../queries/handlers/list-digests.js";
import { handleSearchDigests } from "../queries/handlers/search-digests.js";
import { handleGetPost } from "../queries/handlers/get-post.js";
import { handleSearchPosts } from "../queries/handlers/search-posts.js";
import { handleGetRunStatus } from "../queries/handlers/get-run-status.js";
import { handleListRuns } from "../queries/handlers/list-runs.js";
import { handleListSubreddits } from "../queries/handlers/list-subreddits.js";
import { handleGetConfig } from "../queries/handlers/get-config.js";

/** Cast helper — avoids objectLiteralTypeAssertions lint rule. */
function stub<T>(): T {
  const empty = {};
  return empty as T;
}

function makeCtx(dbMock: Record<string, unknown>): HandlerContext {
  const db = dbMock;
  return {
    db: db as unknown as HandlerContext["db"],
    eventBus: new DomainEventBus(),
    config: stub<HandlerContext["config"]>(),
  };
}

// ── View-based queries ────────────────────────────────────

describe("handleGetDigest", () => {
  it("returns digest by ID from view", async () => {
    const digest = { digestId: "d-1", contentMarkdown: "# Digest" };
    const mockFindUnique = vi.fn().mockResolvedValue(digest);
    const ctx = makeCtx({ digestView: { findUnique: mockFindUnique } });

    const result = await handleGetDigest({ digestId: "d-1" }, ctx);

    expect(result).toEqual(digest);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { digestId: "d-1" },
    });
  });

  it("returns null when digest not found", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ digestView: { findUnique: mockFindUnique } });

    const result = await handleGetDigest({ digestId: "nonexistent" }, ctx);

    expect(result).toBeNull();
  });
});

describe("handleListDigests", () => {
  it("returns all digests with default ordering", async () => {
    const digests = [{ digestId: "d-1" }, { digestId: "d-2" }];
    const mockFindMany = vi.fn().mockResolvedValue(digests);
    const ctx = makeCtx({ digestView: { findMany: mockFindMany } });

    const result = await handleListDigests({}, ctx);

    expect(result).toEqual(digests);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: undefined,
    });
  });

  it("respects limit param", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ digestView: { findMany: mockFindMany } });

    await handleListDigests({ limit: 5 }, ctx);

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });
});

describe("handleGetPost", () => {
  it("returns post by ID from view", async () => {
    const post = { postId: "p-1", title: "Test Post" };
    const mockFindUnique = vi.fn().mockResolvedValue(post);
    const ctx = makeCtx({ postView: { findUnique: mockFindUnique } });

    const result = await handleGetPost({ postId: "p-1" }, ctx);

    expect(result).toEqual(post);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { postId: "p-1" },
    });
  });
});

describe("handleGetRunStatus", () => {
  it("returns run by jobId from view", async () => {
    const run = { jobId: "j-1", status: "RUNNING" };
    const mockFindUnique = vi.fn().mockResolvedValue(run);
    const ctx = makeCtx({ runView: { findUnique: mockFindUnique } });

    const result = await handleGetRunStatus({ jobId: "j-1" }, ctx);

    expect(result).toEqual(run);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { jobId: "j-1" },
    });
  });
});

describe("handleListRuns", () => {
  it("returns runs ordered by creation date", async () => {
    const runs = [{ jobId: "j-1" }];
    const mockFindMany = vi.fn().mockResolvedValue(runs);
    const ctx = makeCtx({ runView: { findMany: mockFindMany } });

    const result = await handleListRuns({}, ctx);

    expect(result).toEqual(runs);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: undefined,
    });
  });
});

describe("handleListSubreddits", () => {
  it("returns all active subreddits from view", async () => {
    const subs = [{ id: "s-1", name: "typescript" }];
    const mockFindMany = vi.fn().mockResolvedValue(subs);
    const ctx = makeCtx({ subredditView: { findMany: mockFindMany } });

    const result = await handleListSubreddits({}, ctx);

    expect(result).toEqual(subs);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
    });
  });
});

// ── Table-based queries ───────────────────────────────────

describe("handleGetConfig", () => {
  it("returns the singleton config row", async () => {
    const config = { id: 1, globalInsightPrompt: "tech" };
    const mockFindFirst = vi.fn().mockResolvedValue(config);
    const ctx = makeCtx({ config: { findFirst: mockFindFirst } });

    const result = await handleGetConfig({}, ctx);

    expect(result).toEqual(config);
    expect(mockFindFirst).toHaveBeenCalledWith();
  });
});

describe("handleSearchPosts", () => {
  it("searches posts by title containing query", async () => {
    const posts = [{ id: "p-1", title: "TypeScript Tips" }];
    const mockFindMany = vi.fn().mockResolvedValue(posts);
    const ctx = makeCtx({ post: { findMany: mockFindMany } });

    const result = await handleSearchPosts(
      { query: "TypeScript", limit: 10 },
      ctx,
    );

    expect(result).toEqual(posts);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { title: { contains: "TypeScript", mode: "insensitive" } },
      orderBy: { fetchedAt: "desc" },
      take: 10,
    });
  });

  it("defaults limit to undefined", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ post: { findMany: mockFindMany } });

    await handleSearchPosts({ query: "rust" }, ctx);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { title: { contains: "rust", mode: "insensitive" } },
      orderBy: { fetchedAt: "desc" },
      take: undefined,
    });
  });
});

describe("handleSearchDigests", () => {
  it("searches digests by content containing query", async () => {
    const digests = [{ id: "d-1", contentMarkdown: "# Tech digest" }];
    const mockFindMany = vi.fn().mockResolvedValue(digests);
    const ctx = makeCtx({ digest: { findMany: mockFindMany } });

    const result = await handleSearchDigests(
      { query: "Tech", limit: 5 },
      ctx,
    );

    expect(result).toEqual(digests);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { contentMarkdown: { contains: "Tech", mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });
});
```

### Step 2: Run tests to verify failure

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/query-handlers.test.ts`
Expected: FAIL — handler modules don't exist yet.

### Step 3: Create directory structure

Run: `mkdir -p packages/core/src/queries/handlers`

### Step 4: Implement all 9 query handlers

Create `packages/core/src/queries/handlers/get-digest.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleGetDigest: QueryHandler<"GetDigest"> = async (
  params,
  ctx,
) => {
  return ctx.db.digestView.findUnique({
    where: { digestId: params.digestId },
  });
};
```

Create `packages/core/src/queries/handlers/list-digests.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleListDigests: QueryHandler<"ListDigests"> = async (
  params,
  ctx,
) => {
  return ctx.db.digestView.findMany({
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });
};
```

Create `packages/core/src/queries/handlers/search-digests.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleSearchDigests: QueryHandler<"SearchDigests"> = async (
  params,
  ctx,
) => {
  return ctx.db.digest.findMany({
    where: { contentMarkdown: { contains: params.query, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });
};
```

Create `packages/core/src/queries/handlers/get-post.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleGetPost: QueryHandler<"GetPost"> = async (params, ctx) => {
  return ctx.db.postView.findUnique({
    where: { postId: params.postId },
  });
};
```

Create `packages/core/src/queries/handlers/search-posts.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleSearchPosts: QueryHandler<"SearchPosts"> = async (
  params,
  ctx,
) => {
  return ctx.db.post.findMany({
    where: { title: { contains: params.query, mode: "insensitive" } },
    orderBy: { fetchedAt: "desc" },
    take: params.limit,
  });
};
```

Create `packages/core/src/queries/handlers/get-run-status.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleGetRunStatus: QueryHandler<"GetRunStatus"> = async (
  params,
  ctx,
) => {
  return ctx.db.runView.findUnique({
    where: { jobId: params.jobId },
  });
};
```

Create `packages/core/src/queries/handlers/list-runs.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleListRuns: QueryHandler<"ListRuns"> = async (
  params,
  ctx,
) => {
  return ctx.db.runView.findMany({
    orderBy: { createdAt: "desc" },
    take: params.limit,
  });
};
```

Create `packages/core/src/queries/handlers/list-subreddits.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleListSubreddits: QueryHandler<"ListSubreddits"> = async (
  _params,
  ctx,
) => {
  return ctx.db.subredditView.findMany({
    orderBy: { name: "asc" },
  });
};
```

Create `packages/core/src/queries/handlers/get-config.ts`:

```ts
import type { QueryHandler } from "../types.js";

export const handleGetConfig: QueryHandler<"GetConfig"> = async (
  _params,
  ctx,
) => {
  return ctx.db.config.findFirst();
};
```

### Step 5: Create query handler registry

Create `packages/core/src/queries/handlers/index.ts`:

```ts
import type { QueryType, QueryHandler } from "../types.js";
import { handleGetDigest } from "./get-digest.js";
import { handleListDigests } from "./list-digests.js";
import { handleSearchDigests } from "./search-digests.js";
import { handleGetPost } from "./get-post.js";
import { handleSearchPosts } from "./search-posts.js";
import { handleGetRunStatus } from "./get-run-status.js";
import { handleListRuns } from "./list-runs.js";
import { handleListSubreddits } from "./list-subreddits.js";
import { handleGetConfig } from "./get-config.js";

type QueryHandlerRegistry = {
  [K in QueryType]?: QueryHandler<K>;
};

export const queryHandlers: QueryHandlerRegistry = {
  GetDigest: handleGetDigest,
  ListDigests: handleListDigests,
  SearchDigests: handleSearchDigests,
  GetPost: handleGetPost,
  SearchPosts: handleSearchPosts,
  GetRunStatus: handleGetRunStatus,
  ListRuns: handleListRuns,
  ListSubreddits: handleListSubreddits,
  GetConfig: handleGetConfig,
};

export {
  handleGetDigest,
  handleListDigests,
  handleSearchDigests,
  handleGetPost,
  handleSearchPosts,
  handleGetRunStatus,
  handleListRuns,
  handleListSubreddits,
  handleGetConfig,
};
```

### Step 6: Run tests

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/query-handlers.test.ts`
Expected: All 13 tests PASS.

### Step 7: Run full core test suite

Run: `pnpm --filter @redgest/core exec vitest run`
Expected: All tests pass.

### Step 8: Commit

```bash
git add packages/core/src/queries/handlers/
git add packages/core/src/__tests__/query-handlers.test.ts
git commit -m "feat(core): add 9 query handlers with registry

- View-based: GetDigest, ListDigests, GetPost, GetRunStatus, ListRuns, ListSubreddits
- Table-based: GetConfig (singleton), SearchPosts, SearchDigests (case-insensitive contains)
- All handlers ordered by createdAt desc or name asc
- Query handler registry for createQuery() integration

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Provider Abstraction — getModel()

**Files:**
- Modify: `packages/llm/package.json` — add AI SDK dependencies
- Create: `packages/llm/src/provider.ts`
- Create: `packages/llm/src/__tests__/provider.test.ts`

### Step 1: Install AI SDK dependencies

Run:
```bash
pnpm --filter @redgest/llm add ai @ai-sdk/anthropic @ai-sdk/openai
```

### Step 2: Write the test

Create `packages/llm/src/__tests__/provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn((model: string) => ({
    provider: "anthropic",
    modelId: model,
  })),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn((model: string) => ({
    provider: "openai",
    modelId: model,
  })),
}));

import { getModel } from "../provider.js";

describe("getModel", () => {
  it("returns anthropic model for triage task", () => {
    const model = getModel("triage");
    expect(model).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
  });

  it("returns anthropic model for summarize task", () => {
    const model = getModel("summarize");
    expect(model).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
  });

  it("accepts custom override", () => {
    const model = getModel("triage", {
      provider: "openai",
      model: "gpt-4.1",
    });
    expect(model).toEqual({
      provider: "openai",
      modelId: "gpt-4.1",
    });
  });

  it("throws for unknown task without override", () => {
    expect(() => getModel("nonexistent")).toThrow(
      "No model configured for task: nonexistent",
    );
  });
});
```

### Step 3: Run test to verify failure

Run: `pnpm --filter @redgest/llm exec vitest run src/__tests__/provider.test.ts`
Expected: FAIL — `provider.ts` doesn't exist.

### Step 4: Implement getModel

Create `packages/llm/src/provider.ts`:

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

const PROVIDERS = { anthropic, openai } as const;

export interface ModelConfig {
  provider: keyof typeof PROVIDERS;
  model: string;
}

const DEFAULT_MODELS: Record<string, ModelConfig> = {
  triage: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  summarize: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
};

export function getModel(
  taskName: string,
  override?: ModelConfig,
): LanguageModel {
  const config = override ?? DEFAULT_MODELS[taskName];
  if (!config) {
    throw new Error(`No model configured for task: ${taskName}`);
  }
  const factory = PROVIDERS[config.provider];
  return factory(config.model);
}
```

### Step 5: Run test to verify pass

Run: `pnpm --filter @redgest/llm exec vitest run src/__tests__/provider.test.ts`
Expected: All 4 tests PASS.

### Step 6: Run full LLM test suite

Run: `pnpm --filter @redgest/llm exec vitest run`
Expected: All tests pass.

### Step 7: Commit

```bash
git add packages/llm/package.json packages/llm/src/provider.ts packages/llm/src/__tests__/provider.test.ts
git commit -m "feat(llm): add provider abstraction with getModel()

- Registry maps task names to provider/model pairs
- Defaults: anthropic/claude-sonnet-4 for triage and summarize
- Supports runtime override for model swapping
- Installs ai, @ai-sdk/anthropic, @ai-sdk/openai

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: generateTriageResult()

**Files:**
- Create: `packages/llm/src/generate-triage.ts`
- Create: `packages/llm/src/__tests__/generate-triage.test.ts`

### Step 1: Write the test

Create `packages/llm/src/__tests__/generate-triage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  Output: {
    object: vi.fn((opts: { schema: unknown }) => ({
      type: "object",
      schema: opts.schema,
    })),
  },
}));

vi.mock("../provider.js", () => ({
  getModel: vi.fn(() => ({ provider: "mock", modelId: "mock-model" })),
}));

import { generateTriageResult } from "../generate-triage.js";
import type { TriagePostCandidate } from "../prompts/triage.js";

const samplePost: TriagePostCandidate = {
  index: 0,
  subreddit: "typescript",
  title: "New TypeScript Feature",
  score: 500,
  numComments: 120,
  createdUtc: Date.now() / 1000 - 3600,
  selftext: "Check out this new feature...",
};

describe("generateTriageResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateText with system prompt, user prompt, and output schema", async () => {
    const triageResult = {
      selectedPosts: [
        { index: 0, relevanceScore: 9.2, rationale: "Highly relevant" },
      ],
    };
    mockGenerateText.mockResolvedValue({ object: triageResult });

    const result = await generateTriageResult(
      [samplePost],
      ["typescript", "web development"],
      3,
    );

    expect(result).toEqual(triageResult);
    expect(mockGenerateText).toHaveBeenCalledOnce();

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBeDefined();
    expect(callArgs.system).toContain("content evaluator");
    expect(callArgs.prompt).toContain("typescript");
    expect(callArgs.prompt).toContain("Select the top 3");
    expect(callArgs.output).toBeDefined();
  });

  it("accepts custom model override", async () => {
    mockGenerateText.mockResolvedValue({
      object: { selectedPosts: [] },
    });

    const customModel = { provider: "custom", modelId: "custom-model" };

    await generateTriageResult(
      [samplePost],
      ["tech"],
      1,
      customModel as Parameters<typeof generateTriageResult>[3],
    );

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBe(customModel);
  });

  it("passes empty insight prompts", async () => {
    mockGenerateText.mockResolvedValue({
      object: { selectedPosts: [] },
    });

    await generateTriageResult([samplePost], [], 1);

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.system).toBeDefined();
  });
});
```

### Step 2: Run test to verify failure

Run: `pnpm --filter @redgest/llm exec vitest run src/__tests__/generate-triage.test.ts`
Expected: FAIL — module doesn't exist.

### Step 3: Implement generateTriageResult

Create `packages/llm/src/generate-triage.ts`:

```ts
import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { TriageResultSchema } from "./schemas.js";
import type { TriageResult } from "./schemas.js";
import {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
} from "./prompts/index.js";
import type { TriagePostCandidate } from "./prompts/index.js";
import { getModel } from "./provider.js";

export async function generateTriageResult(
  posts: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: LanguageModel,
): Promise<TriageResult> {
  const result = await generateText({
    model: model ?? getModel("triage"),
    system: buildTriageSystemPrompt(insightPrompts),
    prompt: buildTriageUserPrompt(posts, targetCount),
    output: Output.object({ schema: TriageResultSchema }),
  });

  return result.object;
}
```

### Step 4: Run test to verify pass

Run: `pnpm --filter @redgest/llm exec vitest run src/__tests__/generate-triage.test.ts`
Expected: All 3 tests PASS.

### Step 5: Commit

```bash
git add packages/llm/src/generate-triage.ts packages/llm/src/__tests__/generate-triage.test.ts
git commit -m "feat(llm): add generateTriageResult() with Output.object()

- Calls AI SDK generateText with structured output schema
- Uses triage system/user prompt builders
- Defaults to getModel('triage'), accepts override

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: generatePostSummary()

**Files:**
- Create: `packages/llm/src/generate-summary.ts`
- Create: `packages/llm/src/__tests__/generate-summary.test.ts`

### Step 1: Write the test

Create `packages/llm/src/__tests__/generate-summary.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  Output: {
    object: vi.fn((opts: { schema: unknown }) => ({
      type: "object",
      schema: opts.schema,
    })),
  },
}));

vi.mock("../provider.js", () => ({
  getModel: vi.fn(() => ({ provider: "mock", modelId: "mock-model" })),
}));

import { generatePostSummary } from "../generate-summary.js";
import type { SummarizationPost, SummarizationComment } from "../prompts/summarization.js";

const samplePost: SummarizationPost = {
  title: "New TypeScript Feature",
  subreddit: "typescript",
  author: "tsdev",
  score: 500,
  selftext: "Check out this new feature for TypeScript 6.0...",
};

const sampleComments: SummarizationComment[] = [
  { author: "commenter1", score: 50, body: "This is great!" },
  { author: "commenter2", score: 30, body: "How does this compare to Go?" },
];

describe("generatePostSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateText with system prompt, user prompt, and output schema", async () => {
    const summaryResult = {
      summary: "A new TypeScript feature was announced.",
      keyTakeaways: ["Faster compilation"],
      insightNotes: "Relevant to TypeScript development",
      communityConsensus: "Generally positive",
      commentHighlights: [],
      sentiment: "positive" as const,
      relevanceScore: 8,
      contentType: "text" as const,
      notableLinks: [],
    };
    mockGenerateText.mockResolvedValue({ object: summaryResult });

    const result = await generatePostSummary(
      samplePost,
      sampleComments,
      ["typescript", "web development"],
    );

    expect(result).toEqual(summaryResult);
    expect(mockGenerateText).toHaveBeenCalledOnce();

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBeDefined();
    expect(callArgs.system).toContain("content summarizer");
    expect(callArgs.prompt).toContain("New TypeScript Feature");
    expect(callArgs.prompt).toContain("commenter1");
    expect(callArgs.output).toBeDefined();
  });

  it("handles empty comments", async () => {
    mockGenerateText.mockResolvedValue({
      object: {
        summary: "Summary",
        keyTakeaways: [],
        insightNotes: "",
        communityConsensus: null,
        commentHighlights: [],
        sentiment: "neutral",
        relevanceScore: 5,
        contentType: "text",
        notableLinks: [],
      },
    });

    await generatePostSummary(samplePost, [], ["tech"]);

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.prompt).toContain("No comments available");
  });

  it("accepts custom model override", async () => {
    mockGenerateText.mockResolvedValue({
      object: {
        summary: "s",
        keyTakeaways: [],
        insightNotes: "",
        communityConsensus: null,
        commentHighlights: [],
        sentiment: "neutral",
        relevanceScore: 1,
        contentType: "text",
        notableLinks: [],
      },
    });

    const customModel = { provider: "custom", modelId: "custom-model" };

    await generatePostSummary(
      samplePost,
      [],
      ["tech"],
      customModel as Parameters<typeof generatePostSummary>[3],
    );

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBe(customModel);
  });
});
```

### Step 2: Run test to verify failure

Run: `pnpm --filter @redgest/llm exec vitest run src/__tests__/generate-summary.test.ts`
Expected: FAIL — module doesn't exist.

### Step 3: Implement generatePostSummary

Create `packages/llm/src/generate-summary.ts`:

```ts
import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { PostSummarySchema } from "./schemas.js";
import type { PostSummary } from "./schemas.js";
import {
  buildSummarizationSystemPrompt,
  buildSummarizationUserPrompt,
} from "./prompts/index.js";
import type {
  SummarizationPost,
  SummarizationComment,
} from "./prompts/index.js";
import { getModel } from "./provider.js";

export async function generatePostSummary(
  post: SummarizationPost,
  comments: SummarizationComment[],
  insightPrompts: string[],
  model?: LanguageModel,
): Promise<PostSummary> {
  const result = await generateText({
    model: model ?? getModel("summarize"),
    system: buildSummarizationSystemPrompt(insightPrompts),
    prompt: buildSummarizationUserPrompt(post, comments),
    output: Output.object({ schema: PostSummarySchema }),
  });

  return result.object;
}
```

### Step 4: Run test to verify pass

Run: `pnpm --filter @redgest/llm exec vitest run src/__tests__/generate-summary.test.ts`
Expected: All 3 tests PASS.

### Step 5: Run full LLM test suite

Run: `pnpm --filter @redgest/llm exec vitest run`
Expected: All tests pass.

### Step 6: Commit

```bash
git add packages/llm/src/generate-summary.ts packages/llm/src/__tests__/generate-summary.test.ts
git commit -m "feat(llm): add generatePostSummary() with Output.object()

- Calls AI SDK generateText with PostSummarySchema
- Uses summarization system/user prompt builders
- Defaults to getModel('summarize'), accepts override

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Content Fetcher — fetchSubredditContent()

**Files:**
- Create: `packages/reddit/src/fetcher.ts`
- Create: `packages/reddit/src/__tests__/fetcher.test.ts`

### Step 1: Write the test

Create `packages/reddit/src/__tests__/fetcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RedditClient } from "../client.js";
import type { TokenBucket } from "../rate-limiter.js";
import type { RedditListing, RedditPostData, RedditCommentData } from "../types.js";
import { fetchSubredditContent } from "../fetcher.js";

function makeListing<T>(items: T[]): RedditListing<T> {
  return {
    kind: "Listing",
    data: {
      after: null,
      before: null,
      children: items.map((data) => ({ kind: "t3", data })),
    },
  };
}

function makeCommentListing(
  post: RedditPostData,
  comments: RedditCommentData[],
): [RedditListing<RedditPostData>, RedditListing<RedditCommentData>] {
  return [
    makeListing([post]),
    {
      kind: "Listing",
      data: {
        after: null,
        before: null,
        children: comments.map((data) => ({ kind: "t1", data })),
      },
    },
  ];
}

function makePost(id: string, title: string): RedditPostData {
  return {
    id,
    name: `t3_${id}`,
    subreddit: "typescript",
    title,
    selftext: "body",
    author: "user",
    score: 100,
    num_comments: 10,
    url: `https://reddit.com/r/typescript/${id}`,
    permalink: `/r/typescript/comments/${id}/test/`,
    link_flair_text: null,
    over_18: false,
    created_utc: Date.now() / 1000,
    is_self: true,
  };
}

function makeComment(id: string): RedditCommentData {
  return {
    id,
    name: `t1_${id}`,
    author: "commenter",
    body: "Great post!",
    score: 25,
    depth: 0,
    created_utc: Date.now() / 1000,
  };
}

describe("fetchSubredditContent", () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let client: RedditClient;
  let mockAcquire: ReturnType<typeof vi.fn>;
  let rateLimiter: TokenBucket;

  beforeEach(() => {
    mockGet = vi.fn();
    const clientObj = { get: mockGet };
    client = clientObj as unknown as RedditClient;

    mockAcquire = vi.fn().mockResolvedValue(undefined);
    const limiterObj = { acquire: mockAcquire };
    rateLimiter = limiterObj as unknown as TokenBucket;
  });

  it("fetches posts from single sort and comments for each", async () => {
    const post1 = makePost("abc", "Post A");
    const comment1 = makeComment("c1");

    // First call: hot listing
    mockGet.mockResolvedValueOnce(makeListing([post1]));
    // Second call: comments for post1
    mockGet.mockResolvedValueOnce(makeCommentListing(post1, [comment1]));

    const result = await fetchSubredditContent(client, rateLimiter, "typescript", {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 5,
    });

    expect(result.subreddit).toBe("typescript");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.post.id).toBe("abc");
    expect(result.posts[0]?.comments).toHaveLength(1);
    expect(result.posts[0]?.comments[0]?.id).toBe("c1");
    expect(result.fetchedAt).toBeInstanceOf(Date);

    // 1 listing + 1 comment fetch = 2 acquire calls
    expect(mockAcquire).toHaveBeenCalledTimes(2);
  });

  it("deduplicates posts across multiple sorts", async () => {
    const post1 = makePost("abc", "Post A");
    const post2 = makePost("def", "Post B");

    // Hot: returns post1 + post2
    mockGet.mockResolvedValueOnce(makeListing([post1, post2]));
    // Top: returns post1 (duplicate) + post2 (duplicate)
    mockGet.mockResolvedValueOnce(makeListing([post1, post2]));
    // Comments for post1
    mockGet.mockResolvedValueOnce(makeCommentListing(post1, []));
    // Comments for post2
    mockGet.mockResolvedValueOnce(makeCommentListing(post2, []));

    const result = await fetchSubredditContent(client, rateLimiter, "typescript", {
      sorts: ["hot", "top"],
      limit: 10,
      commentsPerPost: 5,
    });

    // Only 2 unique posts despite appearing in both sorts
    expect(result.posts).toHaveLength(2);

    // 2 sort fetches + 2 comment fetches = 4 acquire calls
    expect(mockAcquire).toHaveBeenCalledTimes(4);
  });

  it("passes timeRange to top sort only", async () => {
    mockGet.mockResolvedValueOnce(makeListing([])); // hot
    mockGet.mockResolvedValueOnce(makeListing([])); // top

    await fetchSubredditContent(client, rateLimiter, "typescript", {
      sorts: ["hot", "top"],
      limit: 25,
      timeRange: "week",
      commentsPerPost: 3,
    });

    // Hot call — no timeRange
    const hotCall = mockGet.mock.calls[0]?.[0] as string;
    expect(hotCall).toContain("/r/typescript/hot");
    expect(hotCall).not.toContain("t=");

    // Top call — has timeRange
    const topCall = mockGet.mock.calls[1]?.[0] as string;
    expect(topCall).toContain("/r/typescript/top");
    expect(topCall).toContain("t=week");
  });

  it("filters out non-comment children (e.g., 'more' nodes)", async () => {
    const post1 = makePost("abc", "Post A");
    const comment1 = makeComment("c1");

    mockGet.mockResolvedValueOnce(makeListing([post1]));

    // Comment listing with a mix of t1 (comment) and "more" node
    const commentListing: [
      RedditListing<RedditPostData>,
      RedditListing<RedditCommentData>,
    ] = [
      makeListing([post1]),
      {
        kind: "Listing",
        data: {
          after: null,
          before: null,
          children: [
            { kind: "t1", data: comment1 },
            { kind: "more", data: comment1 }, // "more" nodes should be filtered
          ],
        },
      },
    ];
    mockGet.mockResolvedValueOnce(commentListing);

    const result = await fetchSubredditContent(client, rateLimiter, "typescript", {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 5,
    });

    expect(result.posts[0]?.comments).toHaveLength(1);
  });

  it("handles empty listing results", async () => {
    mockGet.mockResolvedValueOnce(makeListing([]));

    const result = await fetchSubredditContent(client, rateLimiter, "typescript", {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 5,
    });

    expect(result.posts).toHaveLength(0);
    expect(mockAcquire).toHaveBeenCalledTimes(1); // Just the listing call
  });
});
```

### Step 2: Run test to verify failure

Run: `pnpm --filter @redgest/reddit exec vitest run src/__tests__/fetcher.test.ts`
Expected: FAIL — module doesn't exist.

### Step 3: Implement fetchSubredditContent

Create `packages/reddit/src/fetcher.ts`:

```ts
import type { RedditClient } from "./client.js";
import type { TokenBucket } from "./rate-limiter.js";
import type {
  RedditListing,
  RedditPostData,
  RedditCommentData,
} from "./types.js";

export interface FetchOptions {
  sorts: Array<"hot" | "top" | "rising">;
  limit: number;
  timeRange?: "hour" | "day" | "week" | "month" | "year" | "all";
  commentsPerPost: number;
}

export interface FetchedContent {
  subreddit: string;
  posts: Array<{
    post: RedditPostData;
    comments: RedditCommentData[];
  }>;
  fetchedAt: Date;
}

export async function fetchSubredditContent(
  client: RedditClient,
  rateLimiter: TokenBucket,
  subreddit: string,
  options: FetchOptions,
): Promise<FetchedContent> {
  const allPosts = new Map<string, RedditPostData>();

  for (const sort of options.sorts) {
    await rateLimiter.acquire();

    const params = new URLSearchParams({ limit: String(options.limit) });
    if (sort === "top" && options.timeRange) {
      params.set("t", options.timeRange);
    }

    const listing = await client.get<RedditListing<RedditPostData>>(
      `/r/${subreddit}/${sort}?${params.toString()}`,
    );

    for (const child of listing.data.children) {
      allPosts.set(child.data.id, child.data);
    }
  }

  const results: FetchedContent["posts"] = [];

  for (const post of allPosts.values()) {
    await rateLimiter.acquire();

    const response = await client.get<
      [RedditListing<RedditPostData>, RedditListing<RedditCommentData>]
    >(
      `/r/${subreddit}/comments/${post.id}?limit=${options.commentsPerPost}&sort=top`,
    );

    const comments = response[1].data.children
      .filter((c) => c.kind === "t1")
      .map((c) => c.data);

    results.push({ post, comments });
  }

  return {
    subreddit,
    posts: results,
    fetchedAt: new Date(),
  };
}
```

### Step 4: Run test to verify pass

Run: `pnpm --filter @redgest/reddit exec vitest run src/__tests__/fetcher.test.ts`
Expected: All 5 tests PASS.

### Step 5: Run full Reddit test suite

Run: `pnpm --filter @redgest/reddit exec vitest run`
Expected: All tests pass.

### Step 6: Commit

```bash
git add packages/reddit/src/fetcher.ts packages/reddit/src/__tests__/fetcher.test.ts
git commit -m "feat(reddit): add fetchSubredditContent() orchestrator

- Fetches posts from multiple sorts (hot/top/rising)
- Deduplicates posts across sorts by Reddit ID
- Fetches top comments for each unique post
- Respects TokenBucket rate limiting before each API call
- Filters out 'more' nodes from comment children
- Pure data function: no DB writes, no deduplication against existing data

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Barrel Exports + Full Verification

**Files:**
- Modify: `packages/core/src/index.ts` — add handler exports
- Modify: `packages/llm/src/index.ts` — add provider + generate function exports
- Modify: `packages/reddit/src/index.ts` — add fetcher exports

### Step 1: Update core barrel

In `packages/core/src/index.ts`, add after the existing exports:

```ts
// Command handlers
export { commandHandlers } from "./commands/handlers/index.js";
export {
  handleGenerateDigest,
  handleAddSubreddit,
  handleRemoveSubreddit,
  handleUpdateSubreddit,
  handleUpdateConfig,
} from "./commands/handlers/index.js";

// Query handlers
export { queryHandlers } from "./queries/handlers/index.js";
export {
  handleGetDigest,
  handleListDigests,
  handleSearchDigests,
  handleGetPost,
  handleSearchPosts,
  handleGetRunStatus,
  handleListRuns,
  handleListSubreddits,
  handleGetConfig,
} from "./queries/handlers/index.js";
```

### Step 2: Update LLM barrel

In `packages/llm/src/index.ts`, add:

```ts
export { getModel, type ModelConfig } from "./provider.js";
export { generateTriageResult } from "./generate-triage.js";
export { generatePostSummary } from "./generate-summary.js";
```

### Step 3: Update Reddit barrel

In `packages/reddit/src/index.ts`, add:

```ts
export { fetchSubredditContent } from "./fetcher.js";
export type { FetchOptions, FetchedContent } from "./fetcher.js";
```

### Step 4: Run typecheck across all modified packages

Run: `pnpm --filter @redgest/core exec tsc --noEmit && pnpm --filter @redgest/llm exec tsc --noEmit && pnpm --filter @redgest/reddit exec tsc --noEmit`
Expected: No type errors.

### Step 5: Run full test suite

Run: `turbo test`
Expected: All tests pass across all packages.

### Step 6: Verify test count

Run: `turbo test 2>&1 | grep -E "Tests|tests"`
Expected: Previous count (100 tests from Sprint 3) + new tests from Sprint 4.

**Expected new test counts:**
- `command-handlers.test.ts`: ~10 tests
- `query-handlers.test.ts`: ~13 tests
- `provider.test.ts`: 4 tests
- `generate-triage.test.ts`: 3 tests
- `generate-summary.test.ts`: 3 tests
- `fetcher.test.ts`: 5 tests
- **Total new**: ~38 tests

### Step 7: Commit

```bash
git add packages/core/src/index.ts packages/llm/src/index.ts packages/reddit/src/index.ts
git commit -m "feat: update barrel exports for Sprint 4 handlers and functions

- Core: export command/query handler registries and individual handlers
- LLM: export getModel, generateTriageResult, generatePostSummary
- Reddit: export fetchSubredditContent + types

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Post-Implementation Checklist

After all 8 tasks are complete, verify:

- [ ] `turbo test` — all tests pass
- [ ] `turbo typecheck` — no type errors
- [ ] `turbo lint` — no lint errors
- [ ] 5 command handlers registered in `commandHandlers` registry
- [ ] 9 query handlers registered in `queryHandlers` registry
- [ ] `getModel()` defaults to anthropic for triage and summarize
- [ ] `generateTriageResult()` and `generatePostSummary()` call AI SDK with correct schemas
- [ ] `fetchSubredditContent()` deduplicates across sorts and respects rate limiting
- [ ] `extractAggregateId` correctly handles RemoveSubreddit
- [ ] `QueryResultMap` uses concrete Prisma types (no `unknown`)
- [ ] All barrel exports updated
- [ ] Mark Sprint 4 tasks as complete in `docs/mgmt/pm/SPRINTS.md`
