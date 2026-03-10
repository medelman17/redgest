# Sprint 7 Implementation Plan: Phase 1 MVP Validation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Validate the Phase 1 MVP end-to-end — E2E test via MCP stdio, integration tests against real Postgres, Docker Compose with MCP server service.

**Architecture:** Environment-driven test doubles (`REDGEST_TEST_MODE=1`) swap FakeContentSource and fake LLM functions into the pipeline. Real Postgres for all tests. MCP SDK Client + StdioClientTransport spawns the server as a child process for E2E. Integration tests call `runDigestPipeline()` directly.

**Tech Stack:** Vitest, `@modelcontextprotocol/sdk` Client, `StdioClientTransport`, Prisma (real Postgres), Docker Compose

---

## Task 1: Test Fixtures and Helpers

**Files:**
- Create: `tests/fixtures/reddit-data.ts`
- Create: `tests/fixtures/fake-content-source.ts`
- Create: `tests/fixtures/fake-llm.ts`
- Create: `tests/helpers/db.ts`
- Create: `tests/vitest.config.ts`
- Modify: `package.json` (root — add `test:e2e` script)

### Step 1: Create vitest config for tests/

```typescript
// tests/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
```

- `pool: "forks"` + `singleFork: true` — tests share one Postgres connection, run sequentially
- `testTimeout: 60_000` — E2E test needs time for child process startup + pipeline

### Step 2: Add test:e2e script to root package.json

Add to `scripts`:
```json
"test:e2e": "vitest run --config tests/vitest.config.ts"
```

### Step 3: Create Reddit fixture data

```typescript
// tests/fixtures/reddit-data.ts
import type { RedditPostData, RedditCommentData } from "@redgest/reddit";

function makePost(index: number, subreddit: string): RedditPostData {
  return {
    id: `post${index}`,
    name: `t3_post${index}`,
    subreddit,
    title: `Test Post ${index}: Interesting ${subreddit} Discussion`,
    selftext: `This is the body of test post ${index} in r/${subreddit}. It contains enough content to be meaningful for triage and summarization testing.`,
    author: `testuser${index}`,
    score: 100 + index * 50,
    num_comments: 10 + index,
    url: `https://reddit.com/r/${subreddit}/comments/post${index}`,
    permalink: `/r/${subreddit}/comments/post${index}`,
    link_flair_text: null,
    over_18: false,
    created_utc: Math.floor(Date.now() / 1000) - index * 3600,
    is_self: true,
  };
}

function makeComments(postIndex: number): RedditCommentData[] {
  return [
    {
      id: `comment${postIndex}_1`,
      name: `t1_comment${postIndex}_1`,
      author: `commenter_a${postIndex}`,
      body: `Great analysis on post ${postIndex}. I agree with the main points.`,
      score: 25,
      depth: 0,
      created_utc: Math.floor(Date.now() / 1000) - postIndex * 1800,
    },
    {
      id: `comment${postIndex}_2`,
      name: `t1_comment${postIndex}_2`,
      author: `commenter_b${postIndex}`,
      body: `Interesting perspective. Here's an additional data point for post ${postIndex}.`,
      score: 12,
      depth: 0,
      created_utc: Math.floor(Date.now() / 1000) - postIndex * 900,
    },
  ];
}

/** 3 posts with 2 comments each, for any subreddit. */
export function fixturePostsForSubreddit(subreddit: string) {
  return [0, 1, 2].map((i) => ({
    post: makePost(i, subreddit),
    comments: makeComments(i),
  }));
}
```

### Step 4: Create FakeContentSource

```typescript
// tests/fixtures/fake-content-source.ts
import type { ContentSource, FetchedContent, FetchOptions } from "@redgest/core";
import { fixturePostsForSubreddit } from "./reddit-data.js";

/**
 * Deterministic content source for testing.
 * Returns 3 fixture posts with 2 comments each for any subreddit.
 */
export class FakeContentSource implements ContentSource {
  async fetchContent(
    subreddit: string,
    _options: FetchOptions,
  ): Promise<FetchedContent> {
    return {
      subreddit,
      posts: fixturePostsForSubreddit(subreddit),
      fetchedAt: new Date(),
    };
  }
}
```

### Step 5: Create fake LLM functions

These replace `generateTriageResult` and `generatePostSummary` from `@redgest/llm`. They must match the exact function signatures.

```typescript
// tests/fixtures/fake-llm.ts
import type { TriagePostCandidate, TriageResult, PostSummary } from "@redgest/llm";
import type { LanguageModel } from "ai";

/**
 * Fake triage: selects ALL posts (no filtering).
 * Returns them in order with ascending relevance scores.
 */
export async function fakeGenerateTriageResult(
  posts: TriagePostCandidate[],
  _insightPrompts: string[],
  _targetCount: number,
  _model?: LanguageModel,
): Promise<TriageResult> {
  return {
    selectedPosts: posts.map((p, i) => ({
      index: p.index,
      relevanceScore: 5 + i,
      rationale: `Test rationale for post "${p.title}"`,
    })),
  };
}

/**
 * Fake summary: returns deterministic summary based on input post title.
 */
export async function fakeGeneratePostSummary(
  post: { title: string; subreddit: string; author: string; score: number; selftext: string },
  _comments: { author: string; score: number; body: string }[],
  _insightPrompts: string[],
  _model?: LanguageModel,
): Promise<PostSummary> {
  return {
    summary: `Summary of "${post.title}" by ${post.author} in r/${post.subreddit}.`,
    keyTakeaways: [
      `Key point 1 from ${post.title}`,
      `Key point 2 from ${post.title}`,
      `Key point 3 from ${post.title}`,
    ],
    insightNotes: `Insight notes for "${post.title}". Relevant to configured interests.`,
    communityConsensus: `Comments generally agree on the points in "${post.title}".`,
    commentHighlights: [
      { author: "commenter", insight: "Notable comment insight", score: 25 },
    ],
    sentiment: "positive",
    relevanceScore: 7,
    contentType: "text",
    notableLinks: [],
  };
}
```

### Step 6: Create test DB helper

```typescript
// tests/helpers/db.ts
import { prisma, type PrismaClient } from "@redgest/db";
import { execSync } from "node:child_process";

let _db: PrismaClient | null = null;

/**
 * Get a PrismaClient connected to the test database.
 * Runs migrations on first call.
 */
export async function getTestDb(): Promise<PrismaClient> {
  if (_db) return _db;

  // Run migrations against the test DB
  execSync("pnpm --filter @redgest/db exec prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env },
  });

  _db = prisma;
  return _db;
}

/** Truncate all tables (order matters for FK constraints). */
export async function truncateAll(db: PrismaClient): Promise<void> {
  // DigestPost is a join table — delete first
  await db.$executeRawUnsafe(`TRUNCATE "DigestPost" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "Digest" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "PostSummary" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "PostComment" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "Post" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "Event" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "Job" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "Subreddit" CASCADE`);
  await db.$executeRawUnsafe(`TRUNCATE "Config" CASCADE`);
}

/** Disconnect from the test database. */
export async function teardownTestDb(): Promise<void> {
  if (_db) {
    await _db.$disconnect();
    _db = null;
  }
}
```

### Step 7: Verify vitest config works

Run: `pnpm test:e2e`
Expected: No tests found (no test files yet), exits cleanly.

### Step 8: Commit

```bash
git add tests/ package.json
git commit -m "feat(tests): add test fixtures, helpers, and vitest config for E2E/integration"
```

---

## Task 2: Bootstrap Test Mode + Pipeline LLM Injection

To support environment-driven test doubles in the E2E child process (where `vi.mock()` is not available), we need:
1. Optional LLM function overrides on `PipelineDeps`
2. Step functions that use overrides when provided
3. Bootstrap that injects fakes when `REDGEST_TEST_MODE=1`

**Files:**
- Modify: `packages/core/src/pipeline/types.ts` (add optional LLM overrides to PipelineDeps)
- Modify: `packages/core/src/pipeline/triage-step.ts` (accept override)
- Modify: `packages/core/src/pipeline/summarize-step.ts` (accept override)
- Modify: `packages/core/src/pipeline/orchestrator.ts` (pass overrides to steps)
- Modify: `packages/mcp-server/src/bootstrap.ts` (test mode branch)

### Step 1: Add LLM function overrides to PipelineDeps

In `packages/core/src/pipeline/types.ts`, add to the `PipelineDeps` interface:

```typescript
// After model?: ModelConfig;

/** Override triage function (used in test mode to avoid real LLM calls). */
generateTriage?: (
  posts: import("@redgest/llm").TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: import("ai").LanguageModel,
) => Promise<import("@redgest/llm").TriageResult>;

/** Override summary function (used in test mode to avoid real LLM calls). */
generateSummary?: (
  post: { title: string; subreddit: string; author: string; score: number; selftext: string },
  comments: { author: string; score: number; body: string }[],
  insightPrompts: string[],
  model?: import("ai").LanguageModel,
) => Promise<PostSummary>;
```

Wait — `PipelineDeps` avoids importing from `@redgest/llm` to prevent circular deps. Use structural typing instead.

**Revised approach** — add the overrides with structural parameter types that already exist locally:

```typescript
/** Override triage function for testing. */
generateTriage?: (
  posts: Array<{
    index: number;
    subreddit: string;
    title: string;
    score: number;
    numComments: number;
    createdUtc: number;
    selftext: string;
  }>,
  insightPrompts: string[],
  targetCount: number,
  model?: unknown,
) => Promise<{
  selectedPosts: Array<{
    index: number;
    relevanceScore: number;
    rationale: string;
  }>;
}>;

/** Override summary function for testing. */
generateSummary?: (
  post: { title: string; subreddit: string; author: string; score: number; selftext: string },
  comments: Array<{ author: string; score: number; body: string }>,
  insightPrompts: string[],
  model?: unknown,
) => Promise<PostSummary>;
```

### Step 2: Update triageStep to accept override

In `packages/core/src/pipeline/triage-step.ts`, the function calls `generateTriageResult` directly. Change the orchestrator to pass the override instead.

No change to `triageStep` itself — the orchestrator will call the override directly if available, or call `triageStep` which uses the default import.

**Actually**, the cleaner approach: pass the generate function down. Modify `triageStep`:

```typescript
// packages/core/src/pipeline/triage-step.ts
import type { LanguageModel } from "ai";
import type { TriagePostCandidate } from "@redgest/llm";
import { generateTriageResult } from "@redgest/llm";
import { applyTriageBudget } from "./token-budget.js";
import type { TriageStepResult } from "./types.js";

type TriageFn = typeof generateTriageResult;

export async function triageStep(
  candidates: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: LanguageModel,
  triageFn?: TriageFn,
): Promise<TriageStepResult> {
  if (candidates.length === 0) {
    return { selected: [] };
  }

  const effectiveTarget = Math.min(targetCount, candidates.length);
  const budgeted = applyTriageBudget(candidates);

  const generate = triageFn ?? generateTriageResult;
  const result = await generate(budgeted, insightPrompts, effectiveTarget, model);

  return {
    selected: result.selectedPosts.map((sp) => ({
      index: sp.index,
      relevanceScore: sp.relevanceScore,
      rationale: sp.rationale,
    })),
  };
}
```

### Step 3: Update summarizeStep to accept override

```typescript
// packages/core/src/pipeline/summarize-step.ts
// Add parameter after `selectionRationale`:
//   summarizeFn?: typeof generatePostSummary

import type { LanguageModel } from "ai";
import type { PrismaClient } from "@redgest/db";
import type { SummarizationPost, SummarizationComment } from "@redgest/llm";
import { generatePostSummary } from "@redgest/llm";
import { applySummarizationBudget } from "./token-budget.js";
import type { SummarizeStepResult } from "./types.js";

type SummaryFn = typeof generatePostSummary;

export async function summarizeStep(
  post: SummarizationPost,
  comments: SummarizationComment[],
  insightPrompts: string[],
  jobId: string,
  postId: string,
  db: PrismaClient,
  model?: LanguageModel,
  selectionRationale?: string,
  summarizeFn?: SummaryFn,
): Promise<SummarizeStepResult> {
  const budgeted = applySummarizationBudget(post.selftext, comments);

  const truncatedPost: SummarizationPost = {
    ...post,
    selftext: budgeted.selftext,
  };

  const generate = summarizeFn ?? generatePostSummary;
  const summary = await generate(truncatedPost, budgeted.comments, insightPrompts, model);

  const isModelObject = model != null && typeof model === "object";
  const llmProvider =
    isModelObject && "provider" in model ? model.provider : "anthropic";
  const llmModel =
    isModelObject && "modelId" in model
      ? model.modelId
      : "claude-sonnet-4-20250514";

  const record = await db.postSummary.create({
    data: {
      postId,
      jobId,
      summary: summary.summary,
      keyTakeaways: summary.keyTakeaways,
      insightNotes: summary.insightNotes,
      commentHighlights: summary.commentHighlights,
      selectionRationale: selectionRationale ?? "",
      llmProvider,
      llmModel,
    },
  });

  return { postSummaryId: record.id, summary };
}
```

### Step 4: Update orchestrator to pass overrides from deps

In `packages/core/src/pipeline/orchestrator.ts`, pass `deps.generateTriage` and `deps.generateSummary` (cast as needed since `PipelineDeps` uses structural types):

At the triage call site (around line 138):
```typescript
const triageResult = await triageStep(
  candidates,
  insightPrompts,
  sub.maxPosts,
  deps.model ? getModel("triage", deps.model) : undefined,
  deps.generateTriage as Parameters<typeof triageStep>[4],
);
```

At the summarize call site (around line 172):
```typescript
const sumResult = await summarizeStep(
  { ... },
  sumComments,
  insightPrompts,
  jobId,
  postData.postId,
  db,
  deps.model ? getModel("summarize", deps.model) : undefined,
  sel.rationale,
  deps.generateSummary as Parameters<typeof summarizeStep>[8],
);
```

### Step 5: Run existing tests to verify no breakage

Run: `pnpm turbo test`
Expected: All 303+ tests pass. The new optional parameters have no effect when not provided.

### Step 6: Add test mode branch to bootstrap.ts

In `packages/mcp-server/src/bootstrap.ts`, after loading config but before wiring the event bus:

```typescript
export async function bootstrap(): Promise<BootstrapResult> {
  const config = loadConfig();
  const db = prisma;
  const eventBus = new DomainEventBus();
  const ctx: HandlerContext = { db, eventBus, config };

  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);

  let pipelineDeps: PipelineDeps;

  if (process.env.REDGEST_TEST_MODE === "1") {
    // Dynamic import from tests/fixtures — only in test mode
    const { FakeContentSource } = await import(
      "../../../tests/fixtures/fake-content-source.js"
    );
    const { fakeGenerateTriageResult, fakeGeneratePostSummary } = await import(
      "../../../tests/fixtures/fake-llm.js"
    );

    pipelineDeps = {
      db,
      eventBus,
      contentSource: new FakeContentSource(),
      config,
      generateTriage: fakeGenerateTriageResult,
      generateSummary: fakeGeneratePostSummary,
    };
  } else {
    const redditClient = new RedditClient({
      clientId: config.REDDIT_CLIENT_ID,
      clientSecret: config.REDDIT_CLIENT_SECRET,
      userAgent: "redgest/1.0.0",
    });
    const rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
    const contentSource = new RedditContentSource(redditClient, rateLimiter);

    pipelineDeps = { db, eventBus, contentSource, config };
  }

  // Phase 1: in-process execution; swap to Trigger.dev in Phase 2
  eventBus.on("DigestRequested", async (event) => {
    const { jobId, subredditIds } = event.payload;
    try {
      await runDigestPipeline(jobId, subredditIds, pipelineDeps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DigestRequested] Pipeline failed for job ${jobId}: ${message}`);
    }
  });

  return { execute, query, ctx, config, db };
}
```

**Note:** The dynamic import path `../../../tests/fixtures/` is relative from `packages/mcp-server/src/bootstrap.ts`. When the E2E test spawns the child process, it runs from the repo root, so this resolves correctly because the compiled output in `dist/` maintains the same relative path. **However**, since we compile with `tsc` and the test fixtures are outside the package, we need the child process to run the source (not compiled) via a loader. The E2E test will spawn with `tsx` or `node --import tsx` to handle TypeScript directly.

### Step 7: Run all tests again

Run: `pnpm turbo test`
Expected: All tests pass. Bootstrap mock in existing tests still works because `REDGEST_TEST_MODE` is not set.

### Step 8: Commit

```bash
git add packages/core/src/pipeline/types.ts \
       packages/core/src/pipeline/triage-step.ts \
       packages/core/src/pipeline/summarize-step.ts \
       packages/core/src/pipeline/orchestrator.ts \
       packages/mcp-server/src/bootstrap.ts
git commit -m "feat: add test mode support — injectable LLM fakes and REDGEST_TEST_MODE bootstrap"
```

---

## Task 3: Integration Tests

Integration tests call `runDigestPipeline()` directly against real Postgres with fake content source and fake LLM functions. Four test cases from the design doc.

**Files:**
- Create: `tests/integration/pipeline.test.ts`

**Prerequisites:** Postgres running (`docker compose up -d postgres`), `DATABASE_URL` pointing to test DB.

### Step 1: Write integration test file

```typescript
// tests/integration/pipeline.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestDb, truncateAll, teardownTestDb } from "../helpers/db.js";
import { FakeContentSource } from "../fixtures/fake-content-source.js";
import {
  fakeGenerateTriageResult,
  fakeGeneratePostSummary,
} from "../fixtures/fake-llm.js";
import {
  runDigestPipeline,
  DomainEventBus,
  type PipelineDeps,
} from "@redgest/core";
import { loadConfig } from "@redgest/config";
import type { PrismaClient } from "@redgest/db";

let db: PrismaClient;
let deps: PipelineDeps;

beforeAll(async () => {
  db = await getTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll(db);

  deps = {
    db,
    eventBus: new DomainEventBus(),
    contentSource: new FakeContentSource(),
    config: loadConfig(),
    generateTriage: fakeGenerateTriageResult,
    generateSummary: fakeGeneratePostSummary,
  };
});

/** Helper: create a subreddit + config + job in the DB, return IDs. */
async function setupSubreddit(
  name: string,
  opts?: { insightPrompt?: string; maxPosts?: number },
) {
  const sub = await db.subreddit.create({
    data: {
      name,
      insightPrompt: opts?.insightPrompt ?? "test insight prompt",
      maxPosts: opts?.maxPosts ?? 10,
    },
  });

  // Ensure singleton config exists
  await db.config.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", globalInsightPrompt: "global test prompt" },
    update: {},
  });

  return sub;
}

async function createJob(subredditIds: string[]) {
  const job = await db.job.create({
    data: {
      status: "QUEUED",
      subreddits: subredditIds,
      lookback: 24,
      delivery: "NONE",
    },
  });
  return job;
}

describe("Integration: runDigestPipeline", () => {
  it("writes correct DB records for one subreddit", async () => {
    const sub = await setupSubreddit("typescript");
    const job = await createJob([sub.id]);

    const result = await runDigestPipeline(job.id, [sub.id], deps);

    // Pipeline result
    expect(result.status).toBe("COMPLETED");
    expect(result.digestId).toBeDefined();
    expect(result.errors).toHaveLength(0);
    expect(result.subredditResults).toHaveLength(1);
    expect(result.subredditResults[0].posts.length).toBeGreaterThan(0);

    // Job updated in DB
    const updatedJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(updatedJob.status).toBe("COMPLETED");
    expect(updatedJob.startedAt).toBeTruthy();
    expect(updatedJob.completedAt).toBeTruthy();

    // Posts written
    const posts = await db.post.findMany();
    expect(posts.length).toBe(3); // FakeContentSource returns 3 posts

    // PostSummaries linked to job and posts
    const summaries = await db.postSummary.findMany();
    expect(summaries.length).toBe(3); // All 3 posts selected by fake triage
    for (const s of summaries) {
      expect(s.jobId).toBe(job.id);
    }

    // Digest created with markdown
    const digest = await db.digest.findUnique({
      where: { jobId: job.id },
    });
    expect(digest).toBeTruthy();
    expect(digest!.contentMarkdown).toContain("Test Post");

    // Events logged
    const events = await db.event.findMany({ orderBy: { createdAt: "asc" } });
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("PostsFetched");
    expect(eventTypes).toContain("PostsTriaged");
    expect(eventTypes).toContain("PostsSummarized");
    expect(eventTypes).toContain("DigestCompleted");
  });

  it("SQL views return correct shapes after pipeline run", async () => {
    const sub = await setupSubreddit("react");
    const job = await createJob([sub.id]);

    await runDigestPipeline(job.id, [sub.id], deps);

    // digest_view
    const digestViews = await db.$queryRaw<
      Array<{ digestId: string; jobId: string; postCount: bigint }>
    >`SELECT "digestId", "jobId", "postCount" FROM digest_view`;
    expect(digestViews.length).toBe(1);
    expect(digestViews[0].jobId).toBe(job.id);

    // run_view
    const runViews = await db.$queryRaw<
      Array<{ jobId: string; status: string }>
    >`SELECT "jobId", status FROM run_view WHERE "jobId" = ${job.id}`;
    expect(runViews.length).toBe(1);
    expect(runViews[0].status).toBe("COMPLETED");

    // post_view
    const postViews = await db.$queryRaw<
      Array<{ postId: string; summary: string }>
    >`SELECT "postId", summary FROM post_view`;
    expect(postViews.length).toBeGreaterThan(0);

    // subreddit_view
    const subViews = await db.$queryRaw<
      Array<{ name: string }>
    >`SELECT name FROM subreddit_view WHERE name = 'react'`;
    expect(subViews.length).toBe(1);
  });

  it("deduplicates posts across runs", async () => {
    const sub = await setupSubreddit("node");

    // First run
    const job1 = await createJob([sub.id]);
    const result1 = await runDigestPipeline(job1.id, [sub.id], deps);
    expect(result1.status).toBe("COMPLETED");
    const firstRunPostCount = result1.subredditResults[0].posts.length;
    expect(firstRunPostCount).toBe(3);

    // Second run — same subreddit, same fixture data
    const job2 = await createJob([sub.id]);
    const result2 = await runDigestPipeline(job2.id, [sub.id], deps);

    // Second run should skip all posts (already in first digest)
    const secondRunPostCount = result2.subredditResults[0].posts.length;
    expect(secondRunPostCount).toBe(0);
  });

  it("handles partial failure — one subreddit fails, another succeeds", async () => {
    const goodSub = await setupSubreddit("typescript");

    // Create a "bad" subreddit that the content source will fail for
    const badSub = await setupSubreddit("__fail__");

    // Override content source with one that fails for __fail__
    const failingSource = {
      async fetchContent(subreddit: string, options: Parameters<typeof deps.contentSource.fetchContent>[1]) {
        if (subreddit === "__fail__") {
          throw new Error("Simulated fetch failure");
        }
        return new FakeContentSource().fetchContent(subreddit, options);
      },
    };

    const partialDeps = { ...deps, contentSource: failingSource };
    const job = await createJob([goodSub.id, badSub.id]);

    const result = await runDigestPipeline(job.id, [goodSub.id, badSub.id], partialDeps);

    expect(result.status).toBe("PARTIAL");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("__fail__");

    // The good subreddit should still have posts
    const goodResult = result.subredditResults.find(
      (r) => r.subreddit === "typescript",
    );
    expect(goodResult).toBeDefined();
    expect(goodResult!.posts.length).toBeGreaterThan(0);

    // Digest still created (from good subreddit)
    expect(result.digestId).toBeDefined();
  });
});
```

### Step 2: Run integration tests

Run: `pnpm test:e2e -- --testPathPattern integration`
Expected: All 4 tests pass.

### Step 3: Commit

```bash
git add tests/integration/
git commit -m "feat(tests): add integration tests — pipeline records, views, dedup, partial failure"
```

---

## Task 4: E2E Test via MCP Stdio

The E2E test spawns the MCP server as a child process with `REDGEST_TEST_MODE=1`, then uses `@modelcontextprotocol/sdk` Client + `StdioClientTransport` to send real JSON-RPC calls through the full protocol path.

**Files:**
- Create: `tests/e2e/mcp-e2e.test.ts`

**Prerequisites:** Postgres running, `DATABASE_URL` set, `tsx` available (for running TypeScript child process).

### Step 1: Install E2E test dependencies

```bash
pnpm add -D @modelcontextprotocol/sdk tsx --filter redgest
```

(`@modelcontextprotocol/sdk` provides Client + StdioClientTransport; `tsx` runs the stdio.ts entry directly)

**Note:** `@modelcontextprotocol/sdk` may already be installed as a dependency of `@redgest/mcp-server`. Check first — only add to root devDeps if needed for the test process.

### Step 2: Write E2E test

```typescript
// tests/e2e/mcp-e2e.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getTestDb, truncateAll, teardownTestDb } from "../helpers/db.js";
import type { PrismaClient } from "@redgest/db";
import { resolve } from "node:path";

let client: Client;
let transport: StdioClientTransport;
let db: PrismaClient;

beforeAll(async () => {
  db = await getTestDb();
  await truncateAll(db);

  // Spawn MCP server as child process with test mode
  const serverPath = resolve("packages/mcp-server/src/stdio.ts");

  transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", serverPath],
    env: {
      ...process.env,
      REDGEST_TEST_MODE: "1",
    },
  });

  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
}, 30_000); // 30s for child process startup

afterAll(async () => {
  try {
    await client.close();
  } catch {
    // Child may already be gone
  }
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
});

/** Helper to call an MCP tool and parse the envelope. */
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });

  // MCP tool results come as content array
  const textContent = result.content as Array<{ type: string; text: string }>;
  const text = textContent.find((c) => c.type === "text")?.text ?? "";
  return JSON.parse(text);
}

describe("E2E: MCP stdio protocol", () => {
  it("lists all tools", async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(15);
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("generate_digest");
    expect(toolNames).toContain("add_subreddit");
    expect(toolNames).toContain("get_digest");
    expect(toolNames).toContain("get_run_status");
  });

  it("full pipeline: add_subreddit → generate_digest → poll status → get_digest", async () => {
    // 1. Add a subreddit
    const addResult = await callTool("add_subreddit", {
      name: "typescript",
      insightPrompt: "Focus on new TypeScript features and patterns",
    });
    expect(addResult.ok).toBe(true);
    const subredditId = addResult.data.id;
    expect(subredditId).toBeDefined();

    // 2. Generate digest
    const genResult = await callTool("generate_digest", {
      subredditIds: [subredditId],
    });
    expect(genResult.ok).toBe(true);
    const jobId = genResult.data.jobId;
    expect(jobId).toBeDefined();

    // 3. Poll run status until complete (with timeout)
    let status = "QUEUED";
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      const statusResult = await callTool("get_run_status", { jobId });
      expect(statusResult.ok).toBe(true);
      status = statusResult.data.status;
      if (status === "COMPLETED" || status === "FAILED" || status === "PARTIAL") {
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(status).toBe("COMPLETED");

    // 4. Get digest
    const digestResult = await callTool("get_digest", { jobId });
    expect(digestResult.ok).toBe(true);
    expect(digestResult.data.contentMarkdown).toBeDefined();
    expect(digestResult.data.contentMarkdown).toContain("Test Post");

    // 5. Verify list_digests
    const listResult = await callTool("list_digests");
    expect(listResult.ok).toBe(true);
    expect(listResult.data.length).toBeGreaterThanOrEqual(1);

    // 6. Verify list_subreddits
    const subsResult = await callTool("list_subreddits");
    expect(subsResult.ok).toBe(true);
    expect(subsResult.data.length).toBe(1);
    expect(subsResult.data[0].name).toBe("typescript");
  }, 60_000); // 60s timeout for full pipeline
});
```

### Step 3: Run E2E test

Run: `pnpm test:e2e -- --testPathPattern e2e`
Expected: Both tests pass — tools listed, full pipeline completes.

### Step 4: Commit

```bash
git add tests/e2e/
git commit -m "feat(tests): add E2E test — MCP SDK client via stdio, full pipeline validation"
```

---

## Task 5: Docker Compose Update

Add MCP server service to `docker-compose.yml` and add health check.

**Files:**
- Modify: `docker-compose.yml`

### Step 1: Add health check to Postgres service

The Postgres service needs a health check so `mcp-server` can use `depends_on: condition: service_healthy`.

### Step 2: Add mcp-server service

Update `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: redgest
      POSTGRES_PASSWORD: redgest
      POSTGRES_DB: redgest
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U redgest"]
      interval: 10s
      timeout: 3s
      start_period: 5s

  mcp-server:
    build:
      context: .
      dockerfile: Dockerfile.mcp
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3100:3100"
    environment:
      DATABASE_URL: postgresql://redgest:redgest@postgres:5432/redgest
      MCP_SERVER_API_KEY: ${MCP_SERVER_API_KEY}
      MCP_SERVER_PORT: 3100
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-placeholder}
      REDDIT_CLIENT_ID: ${REDDIT_CLIENT_ID:-placeholder}
      REDDIT_CLIENT_SECRET: ${REDDIT_CLIENT_SECRET:-placeholder}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3100/health').then(r => process.exit(r.ok ? 0 : 1))"]
      interval: 30s
      timeout: 3s
      start_period: 15s

volumes:
  pgdata:
```

**Notes:**
- `MCP_SERVER_API_KEY` must be set in `.env` or shell (required, no default)
- `ANTHROPIC_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` default to `placeholder` — they're only needed for actual digest generation, not health checks or tool listing
- `start_period: 15s` — gives time for Prisma migrations + server startup in Docker
- Database URL uses Docker internal hostname `postgres` (service name)

### Step 3: Verify compose config is valid

Run: `docker compose config`
Expected: YAML parses correctly, no errors.

### Step 4: Commit

```bash
git add docker-compose.yml
git commit -m "feat: add MCP server to Docker Compose with health checks"
```

---

## Execution Order & Dependencies

```
Task 1 (fixtures/helpers) → Task 2 (bootstrap test mode) → Task 3 (integration) ─┐
                                                                                     ├→ Task 5 (docker compose)
                                                             Task 4 (E2E)       ─────┘
```

- Tasks 1 and 2 are sequential (2 depends on 1's fixtures)
- Task 3 depends on 1 and 2
- Task 4 depends on 1 and 2
- Tasks 3 and 4 are independent of each other (can run in parallel)
- Task 5 is independent of 3 and 4

## Verification Checklist

After all tasks:
- [ ] `pnpm turbo test` — all existing 303+ unit tests still pass
- [ ] `pnpm test:e2e -- --testPathPattern integration` — 4 integration tests pass
- [ ] `pnpm test:e2e -- --testPathPattern e2e` — 2 E2E tests pass
- [ ] `docker compose config` — valid YAML
- [ ] `docker compose up -d && curl http://localhost:3100/health` — `{"status":"ok"}`
