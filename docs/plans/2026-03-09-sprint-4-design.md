# Sprint 4 Design: Command/Query Handlers, LLM Functions, Content Fetcher

**Goal:** Implement all command/query handlers and LLM generate functions to fully unblock WS6 (Pipeline).

**Sprint:** Sprint 4 (2026-03-09 — 2026-03-16) | 5.5pt committed

---

## ADRs

### ADR-005: One File Per Handler

Handler files are organized as one handler per file in `commands/handlers/` and `queries/handlers/`. Each gets a co-located test. A barrel `index.ts` builds the registry object for `createExecute()` / `createQuery()`.

**Rationale:** Clean diffs, test pairing, zero merge conflicts.

### ADR-006: Views Where They Exist, Tables Where They Don't

Query handlers use Prisma view models (`DigestView`, `PostView`, `RunView`, `SubredditView`) where available. `GetConfig` reads the `config` table directly. Search queries (`SearchPosts`, `SearchDigests`) query underlying tables with `contains` filters.

**Rationale:** Views encapsulate joins for standard reads. Forcing everything through views would require creating views just for search and config, which adds complexity without benefit.

### ADR-007: No Generic generate() Wrapper

The LLM layer provides `getModel(taskName)` + two task-specific functions (`generateTriageResult`, `generatePostSummary`). No generic wrapper around AI SDK's `generateText()`.

**Rationale:** Exactly two LLM call sites exist. A generic wrapper is premature abstraction. YAGNI.

### ADR-008: Content Fetcher Is Pure Data

`fetchSubredditContent()` returns raw data — no DB writes, no deduplication. Persistence belongs in WS6 (Pipeline orchestrator).

**Rationale:** Keeps `@redgest/reddit` independent of `@redgest/db`. Single responsibility.

---

## 1. Command Handlers (WS3, 1.5pt)

### File Structure

```
packages/core/src/commands/handlers/
├── generate-digest.ts
├── add-subreddit.ts
├── remove-subreddit.ts
├── update-subreddit.ts
├── update-config.ts
└── index.ts              # registry builder
```

### Handler Contracts

Each handler: `(params: CommandMap[K], ctx: HandlerContext) => Promise<{ data: CommandResultMap[K], event: payload | null }>`

| Command | DB Operation | Returns | Event |
|---------|-------------|---------|-------|
| GenerateDigest | `ctx.db.job.create({ status: "pending" })` | `{ jobId, status }` | `DigestRequested { jobId, subredditIds }` |
| AddSubreddit | `ctx.db.subreddit.create(...)` | `{ subredditId }` | `SubredditAdded { subredditId, name }` |
| RemoveSubreddit | `ctx.db.subreddit.update({ deletedAt: new Date() })` | `{ subredditId }` | `SubredditRemoved { subredditId }` |
| UpdateSubreddit | `ctx.db.subreddit.update(...)` | `{ subredditId }` | `null` (no event) |
| UpdateConfig | `ctx.db.config.upsert(...)` | `{ configId }` | `ConfigUpdated { configId }` |

### Registry Builder (index.ts)

```ts
import { handleGenerateDigest } from "./generate-digest.js";
// ... other imports
export function buildCommandHandlers(): HandlerRegistry {
  return {
    GenerateDigest: handleGenerateDigest,
    AddSubreddit: handleAddSubreddit,
    RemoveSubreddit: handleRemoveSubreddit,
    UpdateSubreddit: handleUpdateSubreddit,
    UpdateConfig: handleUpdateConfig,
  };
}
```

### dispatch.ts Fix

Add `RemoveSubreddit` case to `extractAggregateId()`:
```ts
if (type === "RemoveSubreddit" && typeof result.subredditId === "string") {
  return result.subredditId;
}
```

---

## 2. Query Handlers (WS3, 1pt)

### File Structure

```
packages/core/src/queries/handlers/
├── get-digest.ts
├── list-digests.ts
├── search-digests.ts
├── get-post.ts
├── search-posts.ts
├── get-run-status.ts
├── list-runs.ts
├── list-subreddits.ts
├── get-config.ts
└── index.ts              # registry builder
```

### Handler Contracts

| Query | Source | Returns |
|-------|--------|---------|
| GetDigest | `db.digestView.findUnique({ where: { digestId } })` | `DigestView \| null` |
| ListDigests | `db.digestView.findMany()` | `DigestView[]` |
| SearchDigests | `db.digest.findMany({ where: { contentMarkdown: { contains } } })` | `Digest[]` |
| GetPost | `db.postView.findUnique({ where: { postId } })` | `PostView \| null` |
| SearchPosts | `db.post.findMany({ where: { title: { contains } } })` | `Post[]` |
| GetRunStatus | `db.runView.findUnique({ where: { jobId } })` | `RunView \| null` |
| ListRuns | `db.runView.findMany()` | `RunView[]` |
| ListSubreddits | `db.subredditView.findMany()` | `SubredditView[]` |
| GetConfig | `db.config.findFirst()` | `Config \| null` |

### QueryResultMap Refinement

Update `packages/core/src/queries/types.ts` to use concrete Prisma-generated types instead of `unknown`. Import view/model types from `@redgest/db`.

---

## 3. Provider Abstraction (WS5, 0.5pt)

### File: `packages/llm/src/provider.ts`

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

const PROVIDERS = { anthropic, openai } as const;

interface ModelConfig {
  provider: keyof typeof PROVIDERS;
  model: string;
}

const DEFAULT_MODELS: Record<string, ModelConfig> = {
  triage: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  summarize: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
};

export function getModel(taskName: string, override?: ModelConfig): LanguageModel {
  const config = override ?? DEFAULT_MODELS[taskName];
  if (!config) throw new Error(`No model configured for task: ${taskName}`);
  const factory = PROVIDERS[config.provider];
  return factory(config.model);
}
```

---

## 4. LLM Generate Functions (WS5, 1.5pt)

### File: `packages/llm/src/generate-triage.ts`

```ts
import { generateText, Output } from "ai";
import { validatedTriageResultSchema } from "./schemas.js";
import { getModel } from "./provider.js";
import { triagePrompt } from "./prompts/triage.js";

export async function generateTriageResult(
  posts: TriageInput[],
  insightPrompt: string,
  model?: LanguageModel,
): Promise<ValidatedTriageResult> {
  const result = await generateText({
    model: model ?? getModel("triage"),
    prompt: triagePrompt(posts, insightPrompt),
    output: Output.object({ schema: validatedTriageResultSchema }),
  });
  return result.object;
}
```

### File: `packages/llm/src/generate-summary.ts`

Same pattern with `validatedPostSummarySchema` and `summaryPrompt`.

---

## 5. Content Fetcher (WS4, 1pt)

### File: `packages/reddit/src/fetcher.ts`

```ts
export interface FetchOptions {
  sorts: Array<"hot" | "top" | "rising">;
  limit: number;
  timeRange?: "hour" | "day" | "week" | "month" | "year" | "all";
  commentsPerPost: number;
}

export interface FetchedContent {
  subreddit: string;
  posts: Array<{ post: RedditPost; comments: RedditComment[] }>;
  fetchedAt: Date;
}

export async function fetchSubredditContent(
  client: RedditClient,
  subreddit: string,
  options: FetchOptions,
): Promise<FetchedContent> {
  // 1. Fetch posts from each sort
  // 2. Deduplicate by redditId
  // 3. Fetch comments for each post
  // 4. Return unified structure
}
```

Pure data function. No DB dependency. Rate limiting handled by existing `TokenBucket` in `RedditClient`.
