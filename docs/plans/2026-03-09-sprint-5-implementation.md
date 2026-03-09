# Sprint 5: Pipeline Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the complete digest pipeline (fetch → triage → summarize → assemble) with error recovery, token budgeting, and deduplication.

**Architecture:** Decomposed step functions in `packages/core/src/pipeline/`, composable by an orchestrator. `ContentSource` interface in core, `RedditContentSource` in reddit package. Two-level error recovery (per-subreddit, per-post). Character-based token budgeting with comments-first truncation.

**Tech Stack:** TypeScript, Prisma v7, Vitest, AI SDK v6 (`@redgest/llm`), Reddit client (`@redgest/reddit`)

**Design Doc:** `docs/plans/2026-03-09-sprint-5-design.md` (ADR-009 through ADR-015)

---

## Task Dependency Graph

```
Task 1 (types) ──┬──► Task 4 (RedditContentSource)
                 ├──► Task 5 (fetch step)
Task 2 (budget) ─┼──► Task 6 (triage step)
                 ├──► Task 7 (summarize step)
                 └──► Task 8 (assemble step)
Task 3 (dedup) ──────► Task 9 (orchestrator) ──► Task 10 (exports)
```

**Parallelization:** Tasks 1+2+3 are independent. Tasks 4-8 depend on 1 and/or 2 but are independent of each other. Task 9 depends on 3+5+6+7+8. Task 10 depends on all.

---

## Task 1: Pipeline Types + ContentSource Interface

**Files:**
- Create: `packages/core/src/pipeline/types.ts`
- Test: `packages/core/src/__tests__/pipeline-types.test.ts`

**Context:** This is the foundation. All other pipeline tasks import from here. The `ContentSource` interface enables swapping Reddit for other sources (HN, RSS) in the future. Types are intentionally minimal — they describe what the pipeline needs, not implementation details.

**Key dependencies to import:**
- `FetchOptions`, `FetchedContent`, `RedditPostData`, `RedditCommentData` from `@redgest/reddit`
- `PostSummary`, `ModelConfig` from `@redgest/llm`
- `DomainEventBus` from `../events/bus.js`
- `RedgestConfig` from `@redgest/config`
- Prisma types from `@redgest/db`

**Implementation — `packages/core/src/pipeline/types.ts`:**

```typescript
import type { FetchOptions, FetchedContent, RedditPostData, RedditCommentData } from "@redgest/reddit";
import type { PostSummary, ModelConfig } from "@redgest/llm";
import type { DomainEventBus } from "../events/bus.js";
import type { RedgestConfig } from "@redgest/config";
import type { PrismaClient } from "@redgest/db";

/** Abstraction over content sources (Reddit, HN, RSS, etc.) */
export interface ContentSource {
  fetchContent(
    subreddit: string,
    options: FetchOptions,
  ): Promise<FetchedContent>;
}

/** All external dependencies the pipeline needs — injected, not imported. */
export interface PipelineDeps {
  db: PrismaClient;
  eventBus: DomainEventBus;
  contentSource: ContentSource;
  config: RedgestConfig;
  model?: ModelConfig;
}

/** Result of fetching + persisting posts from one subreddit. */
export interface FetchStepResult {
  subreddit: string;
  posts: Array<{
    postId: string;
    redditId: string;
    post: RedditPostData;
    comments: RedditCommentData[];
  }>;
  fetchedAt: Date;
}

/** Result of LLM triage — which posts were selected and why. */
export interface TriageStepResult {
  selected: Array<{
    index: number;
    relevanceScore: number;
    rationale: string;
  }>;
}

/** Result of LLM summarization for a single post. */
export interface SummarizeStepResult {
  postSummaryId: string;
  summary: PostSummary;
}

/** Result of assembling the final digest document. */
export interface AssembleStepResult {
  digestId: string;
  contentMarkdown: string;
  postCount: number;
}

/** Aggregated results for one subreddit's pipeline run. */
export interface SubredditPipelineResult {
  subreddit: string;
  posts: Array<{
    postId: string;
    redditId: string;
    title: string;
    summary: PostSummary;
    selectionRationale: string;
  }>;
  error?: string;
}

/** Final pipeline result with status and all subreddit outcomes. */
export interface PipelineResult {
  jobId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  digestId?: string;
  subredditResults: SubredditPipelineResult[];
  errors: string[];
}
```

**Tests:** Verify all types are importable and `ContentSource` interface is structurally correct (a mock implementation satisfies it). Minimal — these are just type definitions.

**Commit:** `feat(core): add pipeline types and ContentSource interface`

---

## Task 2: Token Budget Utility

**Files:**
- Create: `packages/core/src/pipeline/token-budget.ts`
- Test: `packages/core/src/__tests__/token-budget.test.ts`

**Context:** Character-based token estimation (ADR-010) with comments-first truncation (ADR-011). The `3.5` divisor gives ~12% safety margin over the typical 4:1 ratio. Two budgets: 8K for triage candidates, 9.7K for summarization per post.

**Implementation — `packages/core/src/pipeline/token-budget.ts`:**

```typescript
import type { RedditCommentData } from "@redgest/reddit";
import type { TriagePostCandidate, SummarizationComment } from "@redgest/llm";

const CHARS_PER_TOKEN = 3.5;
const TRUNCATION_MARKER = "\n\n[truncated]";

export const TRIAGE_TOKEN_BUDGET = 8_000;
export const SUMMARIZATION_TOKEN_BUDGET = 9_700;

/** Estimate token count from text length. Conservative (overestimates). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Truncate text to fit within a token budget, appending a marker. */
export function truncateText(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  if (text.length <= maxChars) return text;
  const markerLen = TRUNCATION_MARKER.length;
  return text.slice(0, maxChars - markerLen) + TRUNCATION_MARKER;
}

/**
 * Apply triage token budget to candidate posts.
 * Truncates selftext of each candidate to fit all candidates within budget.
 * Metadata (title, scores) is preserved; only selftext is truncated.
 */
export function applyTriageBudget(
  candidates: TriagePostCandidate[],
  maxTokens: number = TRIAGE_TOKEN_BUDGET,
): TriagePostCandidate[] {
  if (candidates.length === 0) return [];

  // Calculate overhead per candidate (title, scores, etc. — ~50 tokens each)
  const metadataTokensPerPost = 50;
  const totalMetadata = metadataTokensPerPost * candidates.length;
  const selftextBudget = maxTokens - totalMetadata;

  if (selftextBudget <= 0) {
    // Extreme case: too many candidates. Truncate all selftext to empty.
    return candidates.map((c) => ({ ...c, selftext: "" }));
  }

  const perPostBudget = Math.floor(selftextBudget / candidates.length);

  return candidates.map((c) => ({
    ...c,
    selftext: truncateText(c.selftext, perPostBudget),
  }));
}

/**
 * Apply summarization token budget with comments-first truncation (ADR-011).
 *
 * 1. Preserve post body (title + selftext)
 * 2. Remove lowest-score comments first until under budget
 * 3. If still over, truncate post selftext from the end
 */
export function applySummarizationBudget(
  postSelftext: string,
  comments: SummarizationComment[],
  maxTokens: number = SUMMARIZATION_TOKEN_BUDGET,
): { selftext: string; comments: SummarizationComment[] } {
  const postTokens = estimateTokens(postSelftext);
  const commentTokens = comments.map((c) => ({
    comment: c,
    tokens: estimateTokens(c.body) + estimateTokens(c.author) + 10, // +10 for formatting
  }));

  const totalTokens =
    postTokens + commentTokens.reduce((sum, c) => sum + c.tokens, 0);

  if (totalTokens <= maxTokens) {
    return { selftext: postSelftext, comments };
  }

  // Step 1: Sort comments by score ascending (lowest first) for removal
  const sorted = [...commentTokens].sort(
    (a, b) => a.comment.score - b.comment.score,
  );

  let currentTokens = totalTokens;
  const removed = new Set<number>();

  // Step 2: Remove lowest-score comments until under budget
  for (let i = 0; i < sorted.length; i++) {
    if (currentTokens <= maxTokens) break;
    const entry = sorted[i];
    if (entry) {
      currentTokens -= entry.tokens;
      removed.add(i);
    }
  }

  const keptComments = sorted
    .filter((_, i) => !removed.has(i))
    .map((c) => c.comment);

  // Step 3: If still over budget, truncate post selftext
  let selftext = postSelftext;
  if (currentTokens > maxTokens) {
    const excessTokens = currentTokens - maxTokens;
    const newPostBudget = Math.max(0, postTokens - excessTokens);
    selftext = truncateText(postSelftext, newPostBudget);
  }

  return { selftext, comments: keptComments };
}
```

**Tests — `packages/core/src/__tests__/token-budget.test.ts`:**

```
describe("estimateTokens")
  - returns 0 for empty string
  - estimates ~286 tokens for 1000-char string (1000/3.5 = 286)
  - is conservative (overestimates vs typical 4:1)

describe("truncateText")
  - returns text unchanged when under budget
  - truncates and appends [truncated] marker when over budget
  - handles empty string

describe("applyTriageBudget")
  - returns candidates unchanged when within budget
  - truncates selftext evenly across candidates when over budget
  - handles empty candidate list
  - preserves metadata (title, score, etc.) even when truncating

describe("applySummarizationBudget")
  - returns unchanged when within budget
  - removes lowest-score comments first
  - truncates post body only if still over after removing all comments
  - preserves high-score comments
  - handles empty comments array
```

**Commit:** `feat(core): add token budget utility with comments-first truncation`

---

## Task 3: Deduplication Utility

**Files:**
- Create: `packages/core/src/pipeline/dedup.ts`
- Test: `packages/core/src/__tests__/dedup.test.ts`

**Context:** ADR-012. Query `digest_posts` → `posts` for the last N digests, collecting `redditId`s. Posts that were fetched but not selected by triage are NOT excluded.

**Implementation — `packages/core/src/pipeline/dedup.ts`:**

```typescript
import type { PrismaClient } from "@redgest/db";

const DEFAULT_DEDUP_DIGEST_COUNT = 3;

/**
 * Find Reddit post IDs that appeared in the last N digests.
 * These posts should be excluded from the current pipeline run.
 */
export async function findPreviousPostIds(
  db: PrismaClient,
  digestCount: number = DEFAULT_DEDUP_DIGEST_COUNT,
): Promise<Set<string>> {
  const recentDigests = await db.digest.findMany({
    take: digestCount,
    orderBy: { createdAt: "desc" },
    select: {
      posts: {
        select: {
          post: {
            select: { redditId: true },
          },
        },
      },
    },
  });

  const ids = new Set<string>();
  for (const digest of recentDigests) {
    for (const dp of digest.posts) {
      ids.add(dp.post.redditId);
    }
  }
  return ids;
}
```

**Tests:** Mock `db.digest.findMany` to return digests with nested posts. Verify:
- Returns empty set when no digests exist
- Collects redditIds from last N digests
- Deduplicates across digests (same post in 2 digests → 1 entry)
- Respects the `digestCount` parameter

**Commit:** `feat(core): add digest-based deduplication utility`

---

## Task 4: RedditContentSource

**Files:**
- Create: `packages/reddit/src/content-source.ts`
- Modify: `packages/reddit/src/index.ts` (add export)
- Test: `packages/reddit/src/__tests__/content-source.test.ts`

**Context:** ADR-015. Wraps `RedditClient` + `TokenBucket` + `fetchSubredditContent()` behind the `ContentSource` interface. The pipeline depends on `ContentSource`, not concrete Reddit types.

**Note:** The `ContentSource` interface is defined in `@redgest/core/pipeline/types.ts`. This creates a dependency direction: `@redgest/reddit` imports the interface type from `@redgest/core`. However, this would create a circular dependency (`core → reddit` and `reddit → core`).

**Solution:** Define the `ContentSource` interface inline in `content-source.ts` using the same shape (duck typing). TypeScript structural typing means it will be assignable to the core's `ContentSource` type without an import. Alternatively, re-export the interface type from a shared location. The simplest approach: the `ContentSource` interface in core uses `FetchOptions` and `FetchedContent` from `@redgest/reddit` — so `RedditContentSource` just needs to implement a class with `fetchContent(subreddit, options)` that returns `FetchedContent`. No import from core needed.

**Implementation — `packages/reddit/src/content-source.ts`:**

```typescript
import type { RedditClient } from "./client.js";
import type { TokenBucket } from "./rate-limiter.js";
import { fetchSubredditContent } from "./fetcher.js";
import type { FetchOptions, FetchedContent } from "./fetcher.js";

export class RedditContentSource {
  constructor(
    private client: RedditClient,
    private rateLimiter: TokenBucket,
  ) {}

  async fetchContent(
    subreddit: string,
    options: FetchOptions,
  ): Promise<FetchedContent> {
    return fetchSubredditContent(
      this.client,
      this.rateLimiter,
      subreddit,
      options,
    );
  }
}
```

**Tests:** Verify `RedditContentSource` delegates to `fetchSubredditContent` correctly:
- Passes client, rateLimiter, subreddit, and options through
- Returns the result from fetchSubredditContent

**Commit:** `feat(reddit): add RedditContentSource implementing ContentSource interface`

---

## Task 5: Fetch Step

**Files:**
- Create: `packages/core/src/pipeline/fetch-step.ts`
- Test: `packages/core/src/__tests__/fetch-step.test.ts`

**Context:** Calls `contentSource.fetchContent()`, then upserts posts and comments to the database. Returns post IDs for downstream steps. Filters NSFW posts if `includeNsfw` is false.

**Key Prisma operations:**
- `db.post.upsert({ where: { redditId }, create: {...}, update: { score, commentCount, fetchedAt } })`
- For comments: delete existing comments for the post, then `db.postComment.createMany()` (PostComment.redditId may not have a unique constraint, so upsert isn't safe)

**Implementation — `packages/core/src/pipeline/fetch-step.ts`:**

```typescript
import type { PrismaClient } from "@redgest/db";
import type { ContentSource, FetchStepResult } from "./types.js";

export async function fetchStep(
  subreddit: { name: string; maxPosts: number; includeNsfw: boolean },
  source: ContentSource,
  db: PrismaClient,
): Promise<FetchStepResult> {
  const content = await source.fetchContent(subreddit.name, {
    sorts: ["hot", "top", "rising"],
    limit: subreddit.maxPosts,
    commentsPerPost: 10,
    timeRange: "day",
  });

  const results: FetchStepResult["posts"] = [];

  for (const { post, comments } of content.posts) {
    // Skip NSFW if not allowed
    if (post.over_18 && !subreddit.includeNsfw) continue;

    // Upsert post (redditId is unique)
    const dbPost = await db.post.upsert({
      where: { redditId: post.id },
      create: {
        redditId: post.id,
        subreddit: post.subreddit,
        title: post.title,
        body: post.selftext,
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

    // Replace comments (delete old, create new)
    await db.postComment.deleteMany({ where: { postId: dbPost.id } });
    if (comments.length > 0) {
      await db.postComment.createMany({
        data: comments.map((c) => ({
          postId: dbPost.id,
          redditId: c.id,
          author: c.author,
          body: c.body,
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

**Tests:**
- Mock `ContentSource.fetchContent()` and all Prisma operations
- Verify posts are upserted correctly (create for new, update for existing)
- Verify NSFW posts are filtered when `includeNsfw: false`
- Verify NSFW posts are included when `includeNsfw: true`
- Verify comments are deleted and recreated
- Verify returned FetchStepResult has correct shape

**Commit:** `feat(core): add fetch step — upserts posts and comments to DB`

---

## Task 6: Triage Step

**Files:**
- Create: `packages/core/src/pipeline/triage-step.ts`
- Test: `packages/core/src/__tests__/triage-step.test.ts`

**Context:** Applies token budget to candidates, then calls `generateTriageResult()` from `@redgest/llm`. Returns selected indices with scores and rationales.

**Implementation — `packages/core/src/pipeline/triage-step.ts`:**

```typescript
import type { LanguageModel } from "ai";
import type { TriagePostCandidate } from "@redgest/llm";
import { generateTriageResult } from "@redgest/llm";
import { applyTriageBudget } from "./token-budget.js";
import type { TriageStepResult } from "./types.js";

export async function triageStep(
  candidates: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: LanguageModel,
): Promise<TriageStepResult> {
  if (candidates.length === 0) {
    return { selected: [] };
  }

  // If we have fewer candidates than target, select all
  const effectiveTarget = Math.min(targetCount, candidates.length);

  // Apply token budget to truncate long selftext
  const budgeted = applyTriageBudget(candidates);

  const result = await generateTriageResult(
    budgeted,
    insightPrompts,
    effectiveTarget,
    model,
  );

  return {
    selected: result.selectedPosts.map((sp) => ({
      index: sp.index,
      relevanceScore: sp.relevanceScore,
      rationale: sp.rationale,
    })),
  };
}
```

**Tests:**
- Mock `generateTriageResult` to return a controlled result
- Verify token budget is applied before calling LLM
- Verify empty candidates returns empty selected
- Verify effectiveTarget is capped at candidates.length
- Verify result mapping from TriageResult to TriageStepResult

**Commit:** `feat(core): add triage step with token budget`

---

## Task 7: Summarize Step

**Files:**
- Create: `packages/core/src/pipeline/summarize-step.ts`
- Test: `packages/core/src/__tests__/summarize-step.test.ts`

**Context:** Applies comments-first truncation, calls `generatePostSummary()`, then saves `PostSummary` to DB. Links summary to both post and job.

**Key Prisma operation:**
- `db.postSummary.create({ data: { postId, jobId, summary, keyTakeaways (Json), insightNotes, commentHighlights (Json), selectionRationale, llmProvider, llmModel } })`

**Implementation — `packages/core/src/pipeline/summarize-step.ts`:**

```typescript
import type { LanguageModel } from "ai";
import type { PrismaClient } from "@redgest/db";
import type { SummarizationPost, SummarizationComment } from "@redgest/llm";
import { generatePostSummary } from "@redgest/llm";
import { applySummarizationBudget } from "./token-budget.js";
import type { SummarizeStepResult } from "./types.js";

export async function summarizeStep(
  post: SummarizationPost,
  comments: SummarizationComment[],
  insightPrompts: string[],
  jobId: string,
  postId: string,
  db: PrismaClient,
  model?: LanguageModel,
): Promise<SummarizeStepResult> {
  // Apply comments-first truncation (ADR-011)
  const budgeted = applySummarizationBudget(post.selftext, comments);

  const truncatedPost: SummarizationPost = {
    ...post,
    selftext: budgeted.selftext,
  };

  const summary = await generatePostSummary(
    truncatedPost,
    budgeted.comments,
    insightPrompts,
    model,
  );

  // Determine provider/model from the model parameter or defaults
  const llmProvider = "anthropic";
  const llmModel = "claude-sonnet-4-20250514";

  // Save to database
  const record = await db.postSummary.create({
    data: {
      postId,
      jobId,
      summary: summary.summary,
      keyTakeaways: summary.keyTakeaways,
      insightNotes: summary.insightNotes,
      commentHighlights: summary.commentHighlights,
      selectionRationale: "",  // Set by orchestrator after triage
      llmProvider,
      llmModel,
    },
  });

  return { postSummaryId: record.id, summary };
}
```

**Tests:**
- Mock `generatePostSummary` and `db.postSummary.create`
- Verify comments-first truncation is applied
- Verify PostSummary is saved with correct field mapping (keyTakeaways as Json, etc.)
- Verify returned result includes the DB record ID and the summary

**Commit:** `feat(core): add summarize step with comments-first truncation`

---

## Task 8: Assemble Step

**Files:**
- Create: `packages/core/src/pipeline/assemble-step.ts`
- Test: `packages/core/src/__tests__/assemble-step.test.ts`

**Context:** ADR-014. Generates `contentMarkdown` from all subreddit results. Creates `Digest` record and `DigestPost` join records. Stores `null` for HTML and Slack blocks.

**Markdown format** (from design doc):
```markdown
# Reddit Digest — {date}

## r/{subreddit}

### {post title}
**Score:** {score} | **Sentiment:** {sentiment}

{summary}

**Key Takeaways:**
- {takeaway 1}
- ...

**Interest Notes:** {insightNotes}

**Community Highlights:**
> {highlight} — u/{author} ({score})

---
```

**Implementation — `packages/core/src/pipeline/assemble-step.ts`:**

```typescript
import type { PrismaClient } from "@redgest/db";
import type { SubredditPipelineResult, AssembleStepResult } from "./types.js";

export async function assembleStep(
  jobId: string,
  subredditResults: SubredditPipelineResult[],
  db: PrismaClient,
): Promise<AssembleStepResult> {
  const markdown = renderDigestMarkdown(subredditResults);

  // Count total posts across all subreddits
  const postCount = subredditResults.reduce(
    (sum, r) => sum + r.posts.length,
    0,
  );

  // Create digest record
  const digest = await db.digest.create({
    data: {
      jobId,
      contentMarkdown: markdown,
      contentHtml: null,
      contentSlackBlocks: undefined,  // Json field, omit to store null
    },
  });

  // Create DigestPost join records with rank ordering
  let globalRank = 0;
  for (const subResult of subredditResults) {
    for (const post of subResult.posts) {
      globalRank++;
      await db.digestPost.create({
        data: {
          digestId: digest.id,
          postId: post.postId,
          subreddit: subResult.subreddit,
          rank: globalRank,
        },
      });
    }
  }

  return {
    digestId: digest.id,
    contentMarkdown: markdown,
    postCount,
  };
}

function renderDigestMarkdown(
  subredditResults: SubredditPipelineResult[],
): string {
  const date = new Date().toISOString().split("T")[0];
  const sections: string[] = [`# Reddit Digest — ${date}\n`];

  for (const sub of subredditResults) {
    if (sub.posts.length === 0) continue;

    sections.push(`## r/${sub.subreddit}\n`);

    for (const post of sub.posts) {
      const s = post.summary;

      sections.push(`### ${post.title}`);
      sections.push(
        `**Sentiment:** ${s.sentiment} | **Relevance:** ${s.relevanceScore}/10\n`,
      );
      sections.push(s.summary);

      if (s.keyTakeaways.length > 0) {
        sections.push("\n**Key Takeaways:**");
        for (const t of s.keyTakeaways) {
          sections.push(`- ${t}`);
        }
      }

      if (s.insightNotes) {
        sections.push(`\n**Interest Notes:** ${s.insightNotes}`);
      }

      if (s.communityConsensus) {
        sections.push(`\n**Community Consensus:** ${s.communityConsensus}`);
      }

      if (s.commentHighlights.length > 0) {
        sections.push("\n**Community Highlights:**");
        for (const h of s.commentHighlights) {
          sections.push(`> ${h.insight} — u/${h.author} (${h.score})`);
        }
      }

      if (s.notableLinks.length > 0) {
        sections.push("\n**Notable Links:**");
        for (const link of s.notableLinks) {
          sections.push(`- ${link}`);
        }
      }

      sections.push("\n---\n");
    }
  }

  return sections.join("\n");
}
```

**Tests:**
- Test `renderDigestMarkdown` with mock SubredditPipelineResults
  - Produces correct markdown structure with headers, sections
  - Handles subreddits with zero posts (skipped)
  - Includes all summary fields (takeaways, highlights, links)
- Test `assembleStep` with mocked Prisma
  - Creates Digest record with markdown, null html
  - Creates DigestPost records with correct rank ordering
  - Returns correct digestId and postCount

**Commit:** `feat(core): add assemble step — markdown generation + DB writes`

---

## Task 9: Pipeline Orchestrator

**Files:**
- Create: `packages/core/src/pipeline/orchestrator.ts`
- Test: `packages/core/src/__tests__/orchestrator.test.ts`

**Context:** This is the heart of WS6. Composes all steps with two-level error recovery (ADR-013). Updates job status through lifecycle. Emits progress events (`PostsFetched`, `PostsTriaged`, `PostsSummarized`) and terminal events (`DigestCompleted` / `DigestFailed`).

**Key behaviors:**
1. Update job: QUEUED → RUNNING
2. Load subreddits + config + dedup set
3. For each subreddit (try/catch per-sub):
   a. fetchStep → emit PostsFetched
   b. Filter deduped posts
   c. triageStep → emit PostsTriaged
   d. For each selected post (try/catch per-post):
      - summarizeStep
   e. Emit PostsSummarized
4. If any posts produced: assembleStep → create digest
5. Update job: → COMPLETED | PARTIAL | FAILED
6. Emit DigestCompleted or DigestFailed

**Event emission helper:** Events need both persistence (to events table) and bus emission. Use `persistEvent()` from `../events/persist.js` for storage, then `eventBus.emitEvent()` for in-process notification.

**Implementation — `packages/core/src/pipeline/orchestrator.ts`:**

```typescript
import type { PrismaClient } from "@redgest/db";
import type { DomainEventBus } from "../events/bus.js";
import type { DomainEvent, DomainEventType, DomainEventMap } from "../events/types.js";
import { persistEvent } from "../events/persist.js";
import { getModel } from "@redgest/llm";
import type { TriagePostCandidate, SummarizationComment } from "@redgest/llm";
import { findPreviousPostIds } from "./dedup.js";
import { fetchStep } from "./fetch-step.js";
import { triageStep } from "./triage-step.js";
import { summarizeStep } from "./summarize-step.js";
import { assembleStep } from "./assemble-step.js";
import type {
  PipelineDeps,
  PipelineResult,
  SubredditPipelineResult,
} from "./types.js";

/** Emit a domain event: persist to DB + publish on event bus. */
async function emitEvent<K extends DomainEventType>(
  db: PrismaClient,
  eventBus: DomainEventBus,
  type: K,
  payload: DomainEventMap[K],
  aggregateId: string,
): Promise<void> {
  const event: DomainEvent = {
    type,
    payload,
    aggregateId,
    aggregateType: "job",
    version: 1,
    correlationId: null,
    causationId: null,
    metadata: {},
    occurredAt: new Date(),
  } as DomainEvent;

  await persistEvent(db, event);
  eventBus.emitEvent(event);
}

/**
 * Run the complete digest pipeline.
 *
 * Two-level error recovery (ADR-013):
 * - Per-subreddit: failed fetch/triage skips the subreddit
 * - Per-post: failed summarization skips the post
 *
 * Job status: COMPLETED (all ok), PARTIAL (some skipped), FAILED (zero content)
 */
export async function runDigestPipeline(
  jobId: string,
  subredditIds: string[],
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { db, eventBus, contentSource, config } = deps;

  // 1. Update job status to RUNNING
  await db.job.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  // 2. Load subreddits
  const subreddits = await db.subreddit.findMany({
    where:
      subredditIds.length > 0
        ? { id: { in: subredditIds }, isActive: true }
        : { isActive: true },
  });

  // 3. Load config for global insight prompt
  const dbConfig = await db.config.findFirst();
  const globalInsightPrompt = dbConfig?.globalInsightPrompt ?? "";

  // 4. Load dedup set (last 3 digests)
  const previousPostIds = await findPreviousPostIds(db);

  // 5. Process each subreddit
  const subredditResults: SubredditPipelineResult[] = [];
  const errors: string[] = [];

  for (const sub of subreddits) {
    try {
      // --- Fetch ---
      const fetchResult = await fetchStep(
        { name: sub.name, maxPosts: sub.maxPosts, includeNsfw: sub.includeNsfw },
        contentSource,
        db,
      );

      await emitEvent(db, eventBus, "PostsFetched", {
        jobId,
        subreddit: sub.name,
        count: fetchResult.posts.length,
      }, jobId);

      // --- Dedup ---
      const newPosts = fetchResult.posts.filter(
        (p) => !previousPostIds.has(p.redditId),
      );

      if (newPosts.length === 0) {
        subredditResults.push({ subreddit: sub.name, posts: [] });
        continue;
      }

      // --- Build insight prompts ---
      const insightPrompts = [globalInsightPrompt, sub.insightPrompt]
        .filter((p): p is string => p != null && p.length > 0);

      // --- Triage ---
      const candidates: TriagePostCandidate[] = newPosts.map((p, i) => ({
        index: i,
        subreddit: p.post.subreddit,
        title: p.post.title,
        score: p.post.score,
        numComments: p.post.num_comments,
        createdUtc: p.post.created_utc,
        selftext: p.post.selftext,
      }));

      const triageResult = await triageStep(
        candidates,
        insightPrompts,
        sub.maxPosts,
        deps.model ? getModel("triage", deps.model) : undefined,
      );

      await emitEvent(db, eventBus, "PostsTriaged", {
        jobId,
        subreddit: sub.name,
        selectedCount: triageResult.selected.length,
      }, jobId);

      // --- Summarize each selected post (per-post error recovery) ---
      const postResults: SubredditPipelineResult["posts"] = [];

      for (const sel of triageResult.selected) {
        const postData = newPosts[sel.index];
        if (!postData) continue;

        try {
          const sumComments: SummarizationComment[] = postData.comments.map((c) => ({
            author: c.author,
            score: c.score,
            body: c.body,
          }));

          const sumResult = await summarizeStep(
            {
              title: postData.post.title,
              subreddit: postData.post.subreddit,
              author: postData.post.author,
              score: postData.post.score,
              selftext: postData.post.selftext,
            },
            sumComments,
            insightPrompts,
            jobId,
            postData.postId,
            db,
            deps.model ? getModel("summarize", deps.model) : undefined,
          );

          postResults.push({
            postId: postData.postId,
            redditId: postData.redditId,
            title: postData.post.title,
            summary: sumResult.summary,
            selectionRationale: sel.rationale,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to summarize post ${postData.redditId}: ${msg}`);
        }
      }

      await emitEvent(db, eventBus, "PostsSummarized", {
        jobId,
        subreddit: sub.name,
        summaryCount: postResults.length,
      }, jobId);

      subredditResults.push({ subreddit: sub.name, posts: postResults });
    } catch (err) {
      // Per-subreddit error recovery
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to process r/${sub.name}: ${msg}`);
      subredditResults.push({ subreddit: sub.name, posts: [], error: msg });
    }
  }

  // 6. Determine final status
  const totalPosts = subredditResults.reduce(
    (sum, r) => sum + r.posts.length,
    0,
  );
  const hasErrors = errors.length > 0;

  if (totalPosts === 0) {
    await db.job.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: errors.join("; ") || "No content produced",
      },
    });

    await emitEvent(db, eventBus, "DigestFailed", {
      jobId,
      error: errors.join("; ") || "No content produced",
    }, jobId);

    return { jobId, status: "FAILED", subredditResults, errors };
  }

  // 7. Assemble digest
  const assembleResult = await assembleStep(jobId, subredditResults, db);

  // 8. Update job to final status
  const finalStatus = hasErrors ? ("PARTIAL" as const) : ("COMPLETED" as const);
  await db.job.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      error: hasErrors ? errors.join("; ") : null,
    },
  });

  await emitEvent(db, eventBus, "DigestCompleted", {
    jobId,
    digestId: assembleResult.digestId,
  }, jobId);

  return {
    jobId,
    status: finalStatus,
    digestId: assembleResult.digestId,
    subredditResults,
    errors,
  };
}
```

**Tests — `packages/core/src/__tests__/orchestrator.test.ts`:**

This is the most important test file. Mock all step functions and DB calls.

```
describe("runDigestPipeline")
  - updates job status to RUNNING at start
  - loads subreddits (all active when no IDs specified)
  - loads subreddits by ID when subredditIds provided
  - calls fetchStep for each subreddit
  - filters out deduplicated posts
  - calls triageStep with insight prompts (global + per-sub)
  - calls summarizeStep for each selected post
  - calls assembleStep with all subreddit results
  - emits PostsFetched, PostsTriaged, PostsSummarized events
  - sets status to COMPLETED when all succeeds
  - emits DigestCompleted with digestId

describe("error recovery - per subreddit")
  - skips failed subreddit and continues with others
  - sets status to PARTIAL when some subreddits fail
  - includes error messages in result

describe("error recovery - per post")
  - skips failed summarization and continues with other posts
  - sets status to PARTIAL when some posts fail

describe("error recovery - total failure")
  - sets status to FAILED when zero content produced
  - emits DigestFailed event
  - does NOT call assembleStep
```

**Commit:** `feat(core): add pipeline orchestrator with two-level error recovery`

---

## Task 10: Barrel Exports

**Files:**
- Create: `packages/core/src/pipeline/index.ts`
- Modify: `packages/core/src/index.ts` (add pipeline exports)
- Modify: `packages/reddit/src/index.ts` (add RedditContentSource export)

**Implementation — `packages/core/src/pipeline/index.ts`:**

```typescript
export type {
  ContentSource,
  PipelineDeps,
  PipelineResult,
  SubredditPipelineResult,
  FetchStepResult,
  TriageStepResult,
  SummarizeStepResult,
  AssembleStepResult,
} from "./types.js";

export { runDigestPipeline } from "./orchestrator.js";
export { fetchStep } from "./fetch-step.js";
export { triageStep } from "./triage-step.js";
export { summarizeStep } from "./summarize-step.js";
export { assembleStep } from "./assemble-step.js";
export {
  estimateTokens,
  truncateText,
  applyTriageBudget,
  applySummarizationBudget,
  TRIAGE_TOKEN_BUDGET,
  SUMMARIZATION_TOKEN_BUDGET,
} from "./token-budget.js";
export { findPreviousPostIds } from "./dedup.js";
```

**Add to `packages/core/src/index.ts`:**

```typescript
// Pipeline
export {
  runDigestPipeline,
  fetchStep,
  triageStep,
  summarizeStep,
  assembleStep,
  estimateTokens,
  truncateText,
  applyTriageBudget,
  applySummarizationBudget,
  findPreviousPostIds,
  TRIAGE_TOKEN_BUDGET,
  SUMMARIZATION_TOKEN_BUDGET,
} from "./pipeline/index.js";
export type {
  ContentSource,
  PipelineDeps,
  PipelineResult,
  SubredditPipelineResult,
  FetchStepResult,
  TriageStepResult,
  SummarizeStepResult,
  AssembleStepResult,
} from "./pipeline/index.js";
```

**Add to `packages/reddit/src/index.ts`:**

```typescript
export { RedditContentSource } from "./content-source.js";
```

**Tests:** Run `turbo build` and `turbo test` to verify everything compiles and all tests pass.

**Commit:** `feat: update barrel exports for Sprint 5 pipeline`

---

## Summary

| Task | Files | Tests | Points |
|------|-------|-------|--------|
| 1. Pipeline types | 1 create | minimal | — |
| 2. Token budget | 1 create | ~12 tests | — |
| 3. Dedup | 1 create | ~4 tests | — |
| 4. RedditContentSource | 1 create, 1 modify | ~2 tests | 0.5pt (WS4) |
| 5. Fetch step | 1 create | ~5 tests | — |
| 6. Triage step | 1 create | ~5 tests | — |
| 7. Summarize step | 1 create | ~4 tests | — |
| 8. Assemble step | 1 create | ~5 tests | — |
| 9. Orchestrator | 1 create | ~12 tests | — |
| 10. Barrel exports | 1 create, 2 modify | build check | — |
| **Total** | **10 create, 3 modify** | **~49 tests** | **5.5pt** |
