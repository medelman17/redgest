# Compare Digests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `compare_digests` MCP tool that compares two digests, showing new/dropped posts, overlap percentage, and per-subreddit deltas.

**Architecture:** New `CompareDigests` query handler in `@redgest/core` performs pure set comparison on two digests. MCP tool in `@redgest/mcp-server` handles shorthand resolution (`"latest"` / `"previous"`) and delegates to the query handler.

**Tech Stack:** TypeScript, Prisma v7, Vitest, Zod, `@modelcontextprotocol/sdk`

**Spec:** `docs/superpowers/specs/2026-03-12-compare-digests-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/core/src/queries/types.ts` | Modify | Add custom types + QueryMap/QueryResultMap entries |
| `packages/core/src/queries/handlers/compare-digests.ts` | Create | Query handler — fetch two digests, compute set diff |
| `packages/core/src/queries/handlers/index.ts` | Modify | Register handler in registry |
| `packages/core/src/__tests__/query-handlers.test.ts` | Modify | Add handler tests |
| `packages/mcp-server/src/tools.ts` | Modify | Add tool handler + server.tool registration |
| `packages/mcp-server/src/__tests__/tools.test.ts` | Modify | Add tool tests |

---

## Chunk 1: Core Query Handler

### Task 1: Add types to QueryMap

**Files:**
- Modify: `packages/core/src/queries/types.ts`

- [ ] **Step 1: Add custom types for comparison result**

Add after the `RunStatusDetail` type (around line 83):

```typescript
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
```

- [ ] **Step 2: Add CompareDigests to QueryMap and QueryResultMap**

In the `QueryMap` interface, add:

```typescript
  CompareDigests: { digestIdA: string; digestIdB: string; subreddit?: string };
```

In the `QueryResultMap` interface, add:

```typescript
  CompareDigests: DigestComparisonResult;
```

- [ ] **Step 3: Run typecheck to verify types compile**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: PASS (new types are unused but valid)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/queries/types.ts
git commit -m "feat(core): add CompareDigests types to QueryMap (#24)"
```

---

### Task 2: Write query handler tests

**Files:**
- Modify: `packages/core/src/__tests__/query-handlers.test.ts`

The test file uses `makeCtx()` with mock DB methods and `stub<T>()` helper (defined at line 18). Follow the existing test patterns exactly.

- [ ] **Step 1: Write tests for handleCompareDigests**

Add a new `describe("handleCompareDigests", ...)` block after the `handleGetSubredditStats` tests (before the `queryHandlers registry` describe). Import `handleCompareDigests` at top of file.

Add import at top:
```typescript
import { handleCompareDigests } from "../queries/handlers/compare-digests.js";
```

Add tests:

```typescript
describe("handleCompareDigests", () => {
  // Helper to build a mock digest with digestPosts
  function mockDigestWithPosts(
    id: string,
    createdAt: Date,
    posts: Array<{ id: string; redditId: string; title: string; subreddit: string; score: number; rank: number }>,
  ) {
    return {
      id,
      createdAt,
      digestPosts: posts.map((p) => ({
        rank: p.rank,
        subreddit: p.subreddit,
        post: { id: p.id, redditId: p.redditId, title: p.title, subreddit: p.subreddit, score: p.score },
      })),
    };
  }

  it("computes overlap, added, and removed posts between two digests", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), [
      { id: "p1", redditId: "t3_aaa", title: "Post A1", subreddit: "typescript", score: 100, rank: 1 },
      { id: "p2", redditId: "t3_bbb", title: "Post A2", subreddit: "typescript", score: 80, rank: 2 },
      { id: "p3", redditId: "t3_ccc", title: "Post A3", subreddit: "rust", score: 60, rank: 3 },
    ]);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), [
      { id: "p2", redditId: "t3_bbb", title: "Post A2", subreddit: "typescript", score: 85, rank: 1 },
      { id: "p4", redditId: "t3_ddd", title: "Post B1", subreddit: "rust", score: 90, rank: 2 },
      { id: "p5", redditId: "t3_eee", title: "Post B2", subreddit: "nextjs", score: 70, rank: 3 },
    ]);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    // Digest summaries
    expect(result.digestA.id).toBe("d-a");
    expect(result.digestA.postCount).toBe(3);
    expect(result.digestA.subreddits).toEqual(["rust", "typescript"]);
    expect(result.digestB.id).toBe("d-b");
    expect(result.digestB.postCount).toBe(3);
    expect(result.digestB.subreddits).toEqual(["nextjs", "rust", "typescript"]);

    // Overlap: t3_bbb is in both
    expect(result.overlap.count).toBe(1);
    expect(result.overlap.percentage).toBeCloseTo(33.33, 1);
    expect(result.overlap.posts[0]?.redditId).toBe("t3_bbb");

    // Added: t3_ddd, t3_eee (in B, not A)
    expect(result.added.count).toBe(2);
    expect(result.added.posts.map((p) => p.redditId).sort()).toEqual(["t3_ddd", "t3_eee"]);

    // Removed: t3_aaa, t3_ccc (in A, not B)
    expect(result.removed.count).toBe(2);
    expect(result.removed.posts.map((p) => p.redditId).sort()).toEqual(["t3_aaa", "t3_ccc"]);

    // Subreddit deltas
    expect(result.subredditDeltas).toContainEqual({ subreddit: "typescript", countA: 2, countB: 1, delta: -1 });
    expect(result.subredditDeltas).toContainEqual({ subreddit: "rust", countA: 1, countB: 1, delta: 0 });
    expect(result.subredditDeltas).toContainEqual({ subreddit: "nextjs", countA: 0, countB: 1, delta: 1 });
  });

  it("handles complete overlap (identical digests by content)", async () => {
    const posts = [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
    ];
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), posts);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), posts);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    expect(result.overlap.count).toBe(1);
    expect(result.overlap.percentage).toBe(100);
    expect(result.added.count).toBe(0);
    expect(result.removed.count).toBe(0);
  });

  it("handles no overlap", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
    ]);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), [
      { id: "p2", redditId: "t3_bbb", title: "Post 2", subreddit: "rust", score: 90, rank: 1 },
    ]);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    expect(result.overlap.count).toBe(0);
    expect(result.overlap.percentage).toBe(0);
    expect(result.added.count).toBe(1);
    expect(result.removed.count).toBe(1);
  });

  it("handles both digests empty", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), []);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), []);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    expect(result.overlap.count).toBe(0);
    expect(result.overlap.percentage).toBe(0);
    expect(result.added.count).toBe(0);
    expect(result.removed.count).toBe(0);
    expect(result.subredditDeltas).toEqual([]);
  });

  it("handles empty digest A (percentage is 0)", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), []);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
    ]);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    expect(result.overlap.percentage).toBe(0);
    expect(result.added.count).toBe(1);
    expect(result.removed.count).toBe(0);
  });

  it("applies subreddit filter", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
      { id: "p2", redditId: "t3_bbb", title: "Post 2", subreddit: "rust", score: 80, rank: 2 },
    ]);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
      { id: "p3", redditId: "t3_ccc", title: "Post 3", subreddit: "typescript", score: 70, rank: 2 },
    ]);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b", subreddit: "typescript" },
      ctx,
    );

    // Only typescript posts considered
    expect(result.digestA.postCount).toBe(1);
    expect(result.digestB.postCount).toBe(2);
    expect(result.overlap.count).toBe(1);
    expect(result.added.count).toBe(1);
    expect(result.removed.count).toBe(0);
    // Subreddit deltas only include filtered subreddit
    expect(result.subredditDeltas).toHaveLength(1);
    expect(result.subredditDeltas[0]).toEqual({ subreddit: "typescript", countA: 1, countB: 2, delta: 1 });
  });

  it("throws RedgestError NOT_FOUND when digest A not found", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    await expect(
      handleCompareDigests({ digestIdA: "missing", digestIdB: "d-b" }, ctx),
    ).rejects.toThrow("Digest missing not found");
  });

  it("fetches digests with correct include shape", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), []);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), []);
    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    await handleCompareDigests({ digestIdA: "d-a", digestIdB: "d-b" }, ctx);

    const expectedQuery = {
      where: { id: "d-a" },
      include: {
        digestPosts: {
          orderBy: { rank: "asc" },
          include: { post: true },
        },
      },
    };
    expect(mockFindUnique).toHaveBeenCalledWith(expectedQuery);
    expect(mockFindUnique).toHaveBeenCalledWith({
      ...expectedQuery,
      where: { id: "d-b" },
    });
  });
});
```

- [ ] **Step 2: Update the registry test count**

In the `queryHandlers registry` describe block (around line 755), update:

```typescript
  it("registers all 13 handlers", () => {
    // ... existing expects ...
    expect(queryHandlers.CompareDigests).toBe(handleCompareDigests);
  });

  it("has exactly 13 entries", () => {
    const handlerCount = Object.keys(queryHandlers).length;
    expect(handlerCount).toBe(13);
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/query-handlers.test.ts`
Expected: FAIL — `handleCompareDigests` does not exist yet

---

### Task 3: Implement query handler

**Files:**
- Create: `packages/core/src/queries/handlers/compare-digests.ts`
- Modify: `packages/core/src/queries/handlers/index.ts`

- [ ] **Step 1: Create the handler**

Create `packages/core/src/queries/handlers/compare-digests.ts`:

```typescript
import { RedgestError } from "../../errors.js";
import type { QueryHandler, ComparisonPost, DigestComparisonResult } from "../types.js";

interface DigestPostRow {
  rank: number;
  subreddit: string;
  post: {
    id: string;
    redditId: string;
    title: string;
    subreddit: string;
    score: number;
  };
}

interface DigestWithPosts {
  id: string;
  createdAt: Date;
  digestPosts: DigestPostRow[];
}

function toComparisonPost(dp: DigestPostRow): ComparisonPost {
  return {
    postId: dp.post.id,
    redditId: dp.post.redditId,
    title: dp.post.title,
    subreddit: dp.post.subreddit,
    score: dp.post.score,
  };
}

export const handleCompareDigests: QueryHandler<"CompareDigests"> = async (
  params,
  ctx,
) => {
  const includeShape = {
    digestPosts: {
      orderBy: { rank: "asc" as const },
      include: { post: true },
    },
  };

  const [rawA, rawB] = await Promise.all([
    ctx.db.digest.findUnique({ where: { id: params.digestIdA }, include: includeShape }),
    ctx.db.digest.findUnique({ where: { id: params.digestIdB }, include: includeShape }),
  ]);

  if (!rawA) {
    throw new RedgestError("NOT_FOUND", `Digest ${params.digestIdA} not found`);
  }
  if (!rawB) {
    throw new RedgestError("NOT_FOUND", `Digest ${params.digestIdB} not found`);
  }

  const digestA = rawA as DigestWithPosts;
  const digestB = rawB as DigestWithPosts;

  // Apply subreddit filter if provided
  const filter = params.subreddit?.toLowerCase();
  const postsA = filter
    ? digestA.digestPosts.filter((dp) => dp.subreddit.toLowerCase() === filter)
    : digestA.digestPosts;
  const postsB = filter
    ? digestB.digestPosts.filter((dp) => dp.subreddit.toLowerCase() === filter)
    : digestB.digestPosts;

  // Build sets by redditId
  const setA = new Set(postsA.map((dp) => dp.post.redditId));
  const setB = new Set(postsB.map((dp) => dp.post.redditId));

  // Compute overlap, added, removed
  const overlapPosts = postsB.filter((dp) => setA.has(dp.post.redditId));
  const addedPosts = postsB.filter((dp) => !setA.has(dp.post.redditId));
  const removedPosts = postsA.filter((dp) => !setB.has(dp.post.redditId));

  // Overlap percentage: fraction of A's posts that survived into B
  const percentage = postsA.length > 0
    ? (overlapPosts.length / postsA.length) * 100
    : 0;

  // Subreddit deltas
  const allSubreddits = new Set([
    ...postsA.map((dp) => dp.subreddit),
    ...postsB.map((dp) => dp.subreddit),
  ]);
  const subredditDeltas = [...allSubreddits].sort().map((sub) => {
    const countA = postsA.filter((dp) => dp.subreddit === sub).length;
    const countB = postsB.filter((dp) => dp.subreddit === sub).length;
    return { subreddit: sub, countA, countB, delta: countB - countA };
  });

  // Unique sorted subreddit lists
  const subredditsA = [...new Set(postsA.map((dp) => dp.subreddit))].sort();
  const subredditsB = [...new Set(postsB.map((dp) => dp.subreddit))].sort();

  const result: DigestComparisonResult = {
    digestA: {
      id: digestA.id,
      createdAt: digestA.createdAt.toISOString(),
      postCount: postsA.length,
      subreddits: subredditsA,
    },
    digestB: {
      id: digestB.id,
      createdAt: digestB.createdAt.toISOString(),
      postCount: postsB.length,
      subreddits: subredditsB,
    },
    overlap: {
      count: overlapPosts.length,
      percentage: Math.round(percentage * 100) / 100,
      posts: overlapPosts.map(toComparisonPost),
    },
    added: {
      count: addedPosts.length,
      posts: addedPosts.map(toComparisonPost),
    },
    removed: {
      count: removedPosts.length,
      posts: removedPosts.map(toComparisonPost),
    },
    subredditDeltas,
  };

  return result;
};
```

- [ ] **Step 2: Register in handler index**

In `packages/core/src/queries/handlers/index.ts`, add the import and registration:

Import:
```typescript
import { handleCompareDigests } from "./compare-digests.js";
```

In registry object add:
```typescript
  CompareDigests: handleCompareDigests,
```

In re-exports add:
```typescript
  handleCompareDigests,
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/query-handlers.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Run full package check**

Run: `pnpm --filter @redgest/core exec tsc --noEmit && pnpm --filter @redgest/core exec vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

- [ ] **Step 6: Update packages/core/src/index.ts re-exports**

In `packages/core/src/index.ts`, add the new types to the query type re-exports:

```typescript
  DigestComparisonResult,
  DigestSummaryInfo,
  ComparisonPost,
  SubredditDelta,
```

And add `handleCompareDigests` to the query handler re-exports:

```typescript
  handleCompareDigests,
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/queries/handlers/compare-digests.ts packages/core/src/queries/handlers/index.ts packages/core/src/__tests__/query-handlers.test.ts packages/core/src/index.ts packages/core/src/queries/types.ts
git commit -m "feat(core): add CompareDigests query handler (#24)"
```

---

## Chunk 2: MCP Tool

### Task 4: Write MCP tool tests

**Files:**
- Modify: `packages/mcp-server/src/__tests__/tools.test.ts`

The test file uses `createMockDeps()`, `invoke()`, `parseEnvelope()` helpers. For tools that access `deps.db` directly, use `Object.assign(deps.result.db, { ... })` to inject mock DB methods (see `preview_digest` tests at line 856 for the pattern).

- [ ] **Step 1: Add compare_digests tests**

Add a new `describe("compare_digests", ...)` block after the `preview_digest` tests:

```typescript
describe("compare_digests", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("delegates to CompareDigests query with resolved UUIDs", async () => {
    const comparisonResult = {
      digestA: { id: "d-a", createdAt: "2026-03-10T00:00:00.000Z", postCount: 3, subreddits: ["typescript"] },
      digestB: { id: "d-b", createdAt: "2026-03-11T00:00:00.000Z", postCount: 2, subreddits: ["rust"] },
      overlap: { count: 1, percentage: 33.33, posts: [] },
      added: { count: 1, posts: [] },
      removed: { count: 2, posts: [] },
      subredditDeltas: [],
    };
    deps.query.mockResolvedValue(comparisonResult);

    const result = await invoke(handlers, "compare_digests", {
      digestIdA: "d-a",
      digestIdB: "d-b",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(comparisonResult);
    expect(deps.query).toHaveBeenCalledWith(
      "CompareDigests",
      { digestIdA: "d-a", digestIdB: "d-b", subreddit: undefined },
      deps.result.ctx,
    );
  });

  it("resolves 'latest' and 'previous' shorthand", async () => {
    Object.assign(deps.result.db, {
      digest: {
        findMany: vi.fn().mockResolvedValue([
          { id: "d-latest", createdAt: new Date("2026-03-11") },
          { id: "d-previous", createdAt: new Date("2026-03-10") },
        ]),
      },
    });
    deps.query.mockResolvedValue({
      digestA: { id: "d-previous" },
      digestB: { id: "d-latest" },
      overlap: { count: 0, percentage: 0, posts: [] },
      added: { count: 0, posts: [] },
      removed: { count: 0, posts: [] },
      subredditDeltas: [],
    });

    await invoke(handlers, "compare_digests", {
      digestIdA: "previous",
      digestIdB: "latest",
    });

    expect(deps.query).toHaveBeenCalledWith(
      "CompareDigests",
      { digestIdA: "d-previous", digestIdB: "d-latest", subreddit: undefined },
      deps.result.ctx,
    );
  });

  it("returns NOT_FOUND when fewer than 2 digests exist for shorthand", async () => {
    Object.assign(deps.result.db, {
      digest: {
        findMany: vi.fn().mockResolvedValue([
          { id: "d-only", createdAt: new Date("2026-03-11") },
        ]),
      },
    });

    const result = await invoke(handlers, "compare_digests", {
      digestIdA: "previous",
      digestIdB: "latest",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_ERROR when both IDs resolve to same digest", async () => {
    const result = await invoke(handlers, "compare_digests", {
      digestIdA: "d-same",
      digestIdB: "d-same",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("VALIDATION_ERROR");
  });

  it("passes subreddit filter to query", async () => {
    deps.query.mockResolvedValue({
      digestA: { id: "d-a" },
      digestB: { id: "d-b" },
      overlap: { count: 0, percentage: 0, posts: [] },
      added: { count: 0, posts: [] },
      removed: { count: 0, posts: [] },
      subredditDeltas: [],
    });

    await invoke(handlers, "compare_digests", {
      digestIdA: "d-a",
      digestIdB: "d-b",
      subreddit: "typescript",
    });

    expect(deps.query).toHaveBeenCalledWith(
      "CompareDigests",
      { digestIdA: "d-a", digestIdB: "d-b", subreddit: "typescript" },
      deps.result.ctx,
    );
  });
});
```

- [ ] **Step 2: Update use_redgest guide test**

In the `use_redgest` test (around line 119), add:
```typescript
    expect(guide).toContain("compare_digests");
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts`
Expected: FAIL — `compare_digests` handler does not exist

---

### Task 5: Implement MCP tool

**Files:**
- Modify: `packages/mcp-server/src/tools.ts`

- [ ] **Step 1: Add handler to createToolHandlers**

In the `handlers` object inside `createToolHandlers()`, before the closing `};` (around line 572), add the `compare_digests` handler:

```typescript
    compare_digests: async (args) => {
      return safe(async () => {
        let digestIdA = args.digestIdA as string;
        let digestIdB = args.digestIdB as string;
        const subreddit = args.subreddit as string | undefined;

        // Resolve shorthand
        const needsResolution = digestIdA === "latest" || digestIdA === "previous"
          || digestIdB === "latest" || digestIdB === "previous";

        if (needsResolution) {
          const recent = await deps.db.digest.findMany({
            take: 2,
            orderBy: { createdAt: "desc" },
            select: { id: true, createdAt: true },
          });

          const resolveId = (value: string): string | null => {
            if (value !== "latest" && value !== "previous") return value;
            if (value === "latest") {
              const first = recent[0];
              return first ? first.id : null;
            }
            const second = recent[1];
            return second ? second.id : null;
          };

          const resolvedA = resolveId(digestIdA);
          const resolvedB = resolveId(digestIdB);

          if (!resolvedA || !resolvedB) {
            const needed = recent.length < 2 ? "Need at least 2 digests to compare" : "No previous digest found";
            return envelopeError(ErrorCode.NOT_FOUND, needed);
          }

          digestIdA = resolvedA;
          digestIdB = resolvedB;
        }

        // Validate not comparing same digest
        if (digestIdA === digestIdB) {
          return envelopeError(ErrorCode.VALIDATION_ERROR, "Cannot compare a digest with itself");
        }

        const result = await deps.query("CompareDigests", { digestIdA, digestIdB, subreddit }, deps.ctx);
        return envelope(result);
      });
    },
```

- [ ] **Step 2: Register server.tool in createToolServer**

In `createToolServer()`, before the closing `return server;`, add:

```typescript
  server.tool(
    "compare_digests",
    "Compare two digests to see new/dropped posts, overlap percentage, and subreddit trends. Use for trend analysis across runs.",
    {
      digestIdA: z.string().describe("Digest UUID, 'latest', or 'previous'"),
      digestIdB: z.string().describe("Digest UUID, 'latest', or 'previous'"),
      subreddit: z.string().optional().describe("Filter comparison to a specific subreddit name"),
    },
    async (args) => call("compare_digests", args),
  );
```

- [ ] **Step 3: Add compare_digests to the use_redgest guide string**

Find the `use_redgest` handler and add `compare_digests` to the guide text. Add a line like:
```
- **compare_digests** — Compare two digests: new/dropped posts, overlap, subreddit trends
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full check**

Run: `pnpm check`
Expected: ALL PASS (lint + typecheck + test across all packages)

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server/src/tools.ts packages/mcp-server/src/__tests__/tools.test.ts
git commit -m "feat(mcp): add compare_digests tool (#24)"
```

---

## Chunk 3: Finalize

### Task 6: Close issue and verify

- [ ] **Step 1: Run full verification**

Run: `pnpm check`
Expected: ALL PASS

- [ ] **Step 2: Close the GitHub issue**

```bash
gh issue close 24 --comment "Implemented in this branch. Added CompareDigests query handler and compare_digests MCP tool with shorthand resolution (latest/previous), subreddit filter, and full test coverage."
```
