# Sprint 8 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Trigger.dev job queue, email/Slack delivery, LLM call logging, and content sanitization to complete Phase 2 core.

**Architecture:** Trigger.dev Cloud wraps existing `runDigestPipeline()` as a single task. Delivery channels (email + Slack) are env-var activated. LLM call logs persisted per-call in new `llm_calls` table. Reddit content sanitized at fetch time.

**Tech Stack:** Trigger.dev SDK v3, React Email + Resend (email), Slack Block Kit + webhook (Slack), Prisma v7 migration (llm_calls table)

**Design Doc:** `docs/plans/2026-03-10-sprint-8-design.md`

---

## Task 1: TD-002 — Document Postgres Port

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Step 1: Add comment to docker-compose.yml**

Add a comment above the postgres `ports` mapping:

```yaml
    # Port 5433 avoids conflict with local Postgres on default 5432
    ports:
      - "5433:5432"
```

**Step 2: Add note to README.md**

In the Quick Start section, after `docker compose up postgres -d`, add:

```markdown
> **Note:** Postgres is mapped to port **5433** (not 5432) to avoid conflicts with a local Postgres installation. The `DATABASE_URL` in `.env.example` already reflects this.
```

**Step 3: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "docs: document Postgres port 5433 mapping (TD-002)"
```

---

## Task 2: Reddit Content Sanitization (Gap #5)

**Files:**
- Create: `packages/reddit/src/sanitize.ts`
- Create: `packages/reddit/src/__tests__/sanitize.test.ts`
- Modify: `packages/reddit/src/index.ts`
- Modify: `packages/core/src/pipeline/fetch-step.ts`

**Step 1: Write the sanitize tests**

Create `packages/reddit/src/__tests__/sanitize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sanitizeContent } from "../sanitize.js";

describe("sanitizeContent", () => {
  it("strips opening HTML/XML tags", () => {
    expect(sanitizeContent("hello <system> world")).toBe("hello  world");
  });

  it("strips closing tags", () => {
    expect(sanitizeContent("hello </tool_use> world")).toBe("hello  world");
  });

  it("strips self-closing tags", () => {
    expect(sanitizeContent("hello <br/> world")).toBe("hello  world");
  });

  it("strips tags with attributes", () => {
    expect(sanitizeContent('<div class="foo">content</div>')).toBe("content");
  });

  it("preserves angle brackets in non-tag contexts", () => {
    expect(sanitizeContent("x < y and y > z")).toBe("x < y and y > z");
  });

  it("preserves markdown", () => {
    const md = "**bold** and `code` and [link](url)";
    expect(sanitizeContent(md)).toBe(md);
  });

  it("preserves URLs", () => {
    expect(sanitizeContent("https://example.com/path?a=1&b=2")).toBe(
      "https://example.com/path?a=1&b=2",
    );
  });

  it("handles empty string", () => {
    expect(sanitizeContent("")).toBe("");
  });

  it("strips multiple tags in sequence", () => {
    expect(sanitizeContent("<b><i>text</i></b>")).toBe("text");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/reddit exec vitest run src/__tests__/sanitize.test.ts`
Expected: FAIL — module not found

**Step 3: Implement sanitizeContent**

Create `packages/reddit/src/sanitize.ts`:

```typescript
/**
 * Strip XML/HTML-like tags from Reddit content to prevent prompt injection.
 * Preserves angle brackets in non-tag contexts (math, comparison operators).
 */
export function sanitizeContent(text: string): string {
  return text.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\/?>/g, "");
}
```

**Step 4: Export from barrel**

Add to `packages/reddit/src/index.ts`:

```typescript
export { sanitizeContent } from "./sanitize.js";
```

**Step 5: Run tests to verify they pass**

Run: `pnpm --filter @redgest/reddit exec vitest run src/__tests__/sanitize.test.ts`
Expected: 9 tests PASS

**Step 6: Integrate in fetch-step**

Modify `packages/core/src/pipeline/fetch-step.ts`:

Import at top:
```typescript
import { sanitizeContent } from "@redgest/reddit";
```

In the `for` loop, sanitize fields before persisting:

- `post.title` → `sanitizeContent(post.title)` in `create.title`
- `post.selftext` → `sanitizeContent(post.selftext)` in `create.body`
- `c.body` → `sanitizeContent(c.body)` in comments `createMany`

Specifically, change the `create` block in `db.post.upsert`:
```typescript
create: {
  redditId: post.id,
  subreddit: post.subreddit,
  title: sanitizeContent(post.title),
  body: sanitizeContent(post.selftext),
  // ... rest unchanged
},
```

And in `db.postComment.createMany`:
```typescript
data: comments.map((c) => ({
  postId: dbPost.id,
  redditId: c.id,
  author: c.author,
  body: sanitizeContent(c.body),
  // ... rest unchanged
})),
```

**Step 7: Run all tests**

Run: `pnpm check`
Expected: All 319+ tests pass, lint + typecheck clean

**Step 8: Commit**

```bash
git add packages/reddit/src/sanitize.ts packages/reddit/src/__tests__/sanitize.test.ts packages/reddit/src/index.ts packages/core/src/pipeline/fetch-step.ts
git commit -m "feat: add Reddit content sanitization for prompt injection defense (Gap #5)"
```

---

## Task 3: LLM Calls Table — Schema + Migration (Gap #1, Part 1)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: new Prisma migration

**Step 1: Add LlmCall model to Prisma schema**

Add before the views section in `packages/db/prisma/schema.prisma`:

```prisma
// ─── LlmCall (per-call LLM usage logging) ────────────────

model LlmCall {
  id           String   @id @default(uuid(7))
  jobId        String   @map("job_id")
  postId       String?  @map("post_id")
  task         String
  model        String
  inputTokens  Int      @map("input_tokens")
  outputTokens Int      @map("output_tokens")
  durationMs   Int      @map("duration_ms")
  cached       Boolean
  finishReason String   @map("finish_reason")
  createdAt    DateTime @default(now()) @map("created_at")

  job  Job   @relation(fields: [jobId], references: [id], onDelete: Cascade)
  post Post? @relation(fields: [postId], references: [id], onDelete: SetNull)

  @@index([jobId])
  @@index([task, createdAt])
  @@map("llm_calls")
}
```

Add `llmCalls LlmCall[]` relation field to the `Job` model (after `digest` field):
```prisma
llmCalls      LlmCall[]
```

Add `llmCalls LlmCall[]` relation field to the `Post` model (after `digestPosts` field):
```prisma
llmCalls    LlmCall[]
```

**Step 2: Generate migration**

Run: `pnpm --filter @redgest/db exec prisma migrate dev --name add_llm_calls_table`

**Step 3: Regenerate Prisma client**

Run: `pnpm db:generate`

**Step 4: Verify build**

Run: `pnpm check`
Expected: All tests pass, typecheck clean

**Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add llm_calls table for per-call LLM usage logging"
```

---

## Task 4: LLM Calls — Generate Function + Step Function Changes (Gap #1, Part 2)

**Files:**
- Modify: `packages/llm/src/generate-triage.ts`
- Modify: `packages/llm/src/generate-summary.ts`
- Modify: `packages/llm/src/index.ts`
- Modify: `packages/core/src/pipeline/triage-step.ts`
- Modify: `packages/core/src/pipeline/summarize-step.ts`
- Modify: `tests/fixtures/fake-llm.ts`

**Context:** The generate functions currently discard the `LlmCallLog` returned by `generateWithLogging`. We need to surface it so the step functions can persist it.

**Step 1: Add GenerateResult type to @redgest/llm**

Create a new type in `packages/llm/src/middleware.ts` (or a new types file) and export it:

```typescript
export interface GenerateResult<T> {
  data: T;
  log: LlmCallLog | null;
}
```

Export from `packages/llm/src/index.ts`.

**Step 2: Update generateTriageResult return type**

Change `packages/llm/src/generate-triage.ts` to return `Promise<GenerateResult<TriageResult>>`:

```typescript
import type { GenerateResult } from "./middleware.js";

export async function generateTriageResult(
  posts: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: LanguageModel,
): Promise<GenerateResult<TriageResult>> {
  const resolvedModel = model ?? getModel("triage");
  const system = buildTriageSystemPrompt(insightPrompts);
  const prompt = buildTriageUserPrompt(posts, targetCount);

  let llmLog: LlmCallLog | null = null;

  const { data, cached } = await withCache(
    "triage",
    { posts, insightPrompts, targetCount },
    async () => {
      const { output, log } = await generateWithLogging({
        task: "triage",
        model: resolvedModel,
        system,
        prompt,
        schema: TriageResultSchema,
      });
      llmLog = log;
      return output;
    },
  );

  if (cached) {
    console.log(
      JSON.stringify({ type: "llm_call", task: "triage", cached: true, durationMs: 0 }),
    );
  }

  return { data, log: llmLog };
}
```

**Step 3: Update generatePostSummary return type**

Same pattern in `packages/llm/src/generate-summary.ts` — return `Promise<GenerateResult<PostSummary>>`, capture `llmLog` from closure, return `{ data, log: llmLog }`.

**Step 4: Update triageStep to persist log**

In `packages/core/src/pipeline/triage-step.ts`:

- Add `db: PrismaClient` and `jobId: string` parameters (needed to write the log)
- Update the `TriageFn` type alias to match the new return type
- After the LLM call, write the log to `db.llmCall.create()` if non-null

```typescript
import type { PrismaClient } from "@redgest/db";
import type { LlmCallLog } from "@redgest/llm";

type TriageFn = typeof generateTriageResult;

export async function triageStep(
  candidates: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  db: PrismaClient,
  jobId: string,
  model?: LanguageModel,
  triageFn?: TriageFn,
): Promise<TriageStepResult> {
  if (candidates.length === 0) {
    return { selected: [] };
  }

  const effectiveTarget = Math.min(targetCount, candidates.length);
  const budgeted = applyTriageBudget(candidates);

  const generate = triageFn ?? generateTriageResult;
  const { data: result, log } = await generate(
    budgeted, insightPrompts, effectiveTarget, model,
  );

  if (log) {
    await db.llmCall.create({
      data: {
        jobId,
        postId: null,
        task: "triage",
        model: log.model,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
        durationMs: log.durationMs,
        cached: log.cached,
        finishReason: log.finishReason,
      },
    });
  }

  return {
    selected: result.selectedPosts.map((sp) => ({
      index: sp.index,
      relevanceScore: sp.relevanceScore,
      rationale: sp.rationale,
    })),
  };
}
```

**Step 5: Update summarizeStep to persist log**

In `packages/core/src/pipeline/summarize-step.ts`:

The function already has `db`, `jobId`, and `postId` parameters. Update the `SummaryFn` type and destructure the result:

```typescript
type SummaryFn = typeof generatePostSummary;

// In the function body:
const generate = summarizeFn ?? generatePostSummary;
const { data: summary, log } = await generate(
  truncatedPost, budgeted.comments, insightPrompts, model,
);

if (log) {
  await db.llmCall.create({
    data: {
      jobId,
      postId,
      task: "summarize",
      model: log.model,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      durationMs: log.durationMs,
      cached: log.cached,
      finishReason: log.finishReason,
    },
  });
}
```

**Step 6: Update orchestrator calls**

The orchestrator in `packages/core/src/pipeline/orchestrator.ts` calls `triageStep` — its signature changed (added `db` and `jobId` parameters). Update the call sites to pass these.

**Step 7: Update fake LLM functions**

In `tests/fixtures/fake-llm.ts`, update the fake functions to return `{ data, log: null }` instead of just the data object.

**Step 8: Update existing tests**

Update all tests in `packages/core/src/__tests__/triage-step.test.ts` and `summarize-step.test.ts` to account for the new parameter order and return type. The mock generate functions should return `{ data: ..., log: null }`.

**Step 9: Run all tests**

Run: `pnpm check`
Expected: All tests pass (may need to update test assertions for new call signatures)

**Step 10: Commit**

```bash
git add packages/llm/src/ packages/core/src/ tests/fixtures/
git commit -m "feat: persist LLM call logs to llm_calls table (Gap #1)"
```

---

## Task 5: Config Schema Changes

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/__tests__/config.test.ts`
- Modify: `.env.example`

**Step 1: Update config schema**

In `packages/config/src/schema.ts`:

1. Make `TRIGGER_SECRET_KEY` optional (was required):
```typescript
TRIGGER_SECRET_KEY: z.string().min(1).optional(),
```

2. Add new optional fields:
```typescript
DELIVERY_EMAIL: z.string().email().optional(),
DIGEST_CRON: z.string().default("0 7 * * *"),
```

**Step 2: Update .env.example**

Add under Optional section:
```bash
# Delivery email address (recipient for digest emails)
# DELIVERY_EMAIL="you@example.com"

# Digest schedule cron expression (default: 7 AM daily)
# DIGEST_CRON="0 7 * * *"
```

Move `TRIGGER_SECRET_KEY` from Required to Optional section.

**Step 3: Update config tests**

Update `packages/config/src/__tests__/config.test.ts` — remove `TRIGGER_SECRET_KEY` from the required fields test. Add tests for new optional fields.

**Step 4: Run tests**

Run: `pnpm check`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/config/ .env.example
git commit -m "feat(config): make TRIGGER_SECRET_KEY optional, add DELIVERY_EMAIL and DIGEST_CRON"
```

---

## Task 6: Email Delivery Channel (WS9)

**Files:**
- Modify: `packages/email/package.json`
- Create: `packages/email/src/types.ts`
- Create: `packages/email/src/template.tsx`
- Create: `packages/email/src/send.ts`
- Create: `packages/email/src/__tests__/template.test.tsx`
- Create: `packages/email/src/__tests__/send.test.ts`
- Modify: `packages/email/src/index.ts`
- Modify: `packages/email/tsconfig.json`

**Step 1: Install dependencies**

```bash
pnpm --filter @redgest/email add react-email @react-email/components resend
pnpm --filter @redgest/email add -D @types/react
```

**Step 2: Define shared delivery data type**

Create `packages/email/src/types.ts`:

```typescript
export interface DigestDeliveryData {
  digestId: string;
  createdAt: Date;
  subreddits: Array<{
    name: string;
    posts: Array<{
      title: string;
      permalink: string;
      score: number;
      summary: string;
      keyTakeaways: string[];
      insightNotes: string;
      commentHighlights: Array<{
        author: string;
        insight: string;
        score: number;
      }>;
    }>;
  }>;
}
```

**Step 3: Create React Email template**

Create `packages/email/src/template.tsx`. Use `@react-email/components` — `Html`, `Head`, `Body`, `Container`, `Section`, `Heading`, `Text`, `Hr`, `Link`. Render subreddit sections with post summaries, key takeaways, and highlights. Keep it clean — no heavy styling.

**Step 4: Create send function**

Create `packages/email/src/send.ts`:

```typescript
import { Resend } from "resend";
import { render } from "@react-email/components";
import { DigestEmail } from "./template.js";
import type { DigestDeliveryData } from "./types.js";

export async function sendDigestEmail(
  digest: DigestDeliveryData,
  recipientEmail: string,
  apiKey: string,
): Promise<{ id: string }> {
  const resend = new Resend(apiKey);
  const html = await render(DigestEmail({ digest }));
  const date = digest.createdAt.toISOString().split("T")[0];

  const { data, error } = await resend.emails.send({
    from: "Redgest <digest@resend.dev>",
    to: recipientEmail,
    subject: `Reddit Digest — ${date}`,
    html,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return { id: data!.id };
}
```

**Step 5: Write tests**

Test the template renders without errors (snapshot or basic render test). Test the send function with a mocked Resend client.

**Step 6: Update barrel exports**

Update `packages/email/src/index.ts`:
```typescript
export { sendDigestEmail } from "./send.js";
export { DigestEmail } from "./template.js";
export type { DigestDeliveryData } from "./types.js";
```

**Step 7: Run tests**

Run: `pnpm check`

**Step 8: Commit**

```bash
git add packages/email/
git commit -m "feat(email): add React Email digest template and Resend integration (WS9)"
```

---

## Task 7: Slack Delivery Channel (WS9)

**Files:**
- Create: `packages/slack/src/format.ts`
- Create: `packages/slack/src/send.ts`
- Create: `packages/slack/src/__tests__/format.test.ts`
- Create: `packages/slack/src/__tests__/send.test.ts`
- Modify: `packages/slack/src/index.ts`

**Step 1: Create Block Kit formatter**

Create `packages/slack/src/format.ts`:

```typescript
import type { DigestDeliveryData } from "@redgest/email";

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string }>;
  fields?: Array<{ type: string; text: string }>;
}

export function formatDigestBlocks(digest: DigestDeliveryData): SlackBlock[] {
  const date = digest.createdAt.toISOString().split("T")[0];
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Reddit Digest — ${date}`, emoji: true },
    },
  ];

  for (const sub of digest.subreddits) {
    if (sub.posts.length === 0) continue;

    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*r/${sub.name}*` },
    });

    for (const post of sub.posts) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<https://reddit.com${post.permalink}|${post.title}>* (${post.score} pts)\n${post.summary}`,
        },
      });

      if (post.keyTakeaways.length > 0) {
        const takeaways = post.keyTakeaways.map((t) => `• ${t}`).join("\n");
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*Key Takeaways:*\n${takeaways}` },
        });
      }
    }
  }

  return blocks;
}
```

**Step 2: Create webhook sender**

Create `packages/slack/src/send.ts`:

```typescript
import type { DigestDeliveryData } from "@redgest/email";
import { formatDigestBlocks } from "./format.js";

export async function sendDigestSlack(
  digest: DigestDeliveryData,
  webhookUrl: string,
): Promise<void> {
  const blocks = formatDigestBlocks(digest);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook error: ${response.status} ${response.statusText}`);
  }
}
```

**Step 3: Write tests**

Test `formatDigestBlocks` returns correct block structure. Test `sendDigestSlack` with a mocked `fetch`.

**Step 4: Update barrel exports**

```typescript
export { formatDigestBlocks } from "./format.js";
export { sendDigestSlack } from "./send.js";
```

**Step 5: Add @redgest/email as dependency**

`@redgest/slack` needs the `DigestDeliveryData` type from `@redgest/email`:
```bash
pnpm --filter @redgest/slack add @redgest/email@workspace:*
```

**Step 6: Run tests**

Run: `pnpm check`

**Step 7: Commit**

```bash
git add packages/slack/
git commit -m "feat(slack): add Block Kit formatter and webhook delivery (WS9)"
```

---

## Task 8: Trigger.dev Worker Setup (WS8)

**Files:**
- Modify: `apps/worker/package.json`
- Create: `trigger.config.ts` (repo root)
- Create: `apps/worker/src/trigger.ts` (re-export tasks for Trigger.dev)

**Step 1: Install Trigger.dev dependencies**

```bash
pnpm --filter @redgest/worker add @trigger.dev/sdk
pnpm add -D @trigger.dev/build -w
```

Add workspace package dependencies:
```bash
pnpm --filter @redgest/worker add @redgest/core@workspace:* @redgest/db@workspace:* @redgest/config@workspace:* @redgest/reddit@workspace:* @redgest/email@workspace:* @redgest/slack@workspace:*
```

**Step 2: Create trigger.config.ts**

Create `trigger.config.ts` at repo root:

```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "redgest",
  runtime: "node",
  logLevel: "log",
  dirs: ["apps/worker/src/tasks"],
});
```

Note: Prisma extension may be needed if deploying to Trigger.dev Cloud. Add if bundling issues arise:
```typescript
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";
// ... build: { extensions: [prismaExtension({ version: "7.4.2", schema: "packages/db/prisma/schema.prisma" })] }
```

**Step 3: Update worker package.json**

Replace placeholder scripts with real ones. Add proper `main` entry and TypeScript config.

**Step 4: Commit**

```bash
git add trigger.config.ts apps/worker/
git commit -m "feat(worker): add Trigger.dev SDK and config (WS8)"
```

---

## Task 9: generate-digest Task (WS8)

**Files:**
- Create: `apps/worker/src/tasks/generate-digest.ts`

**Step 1: Implement the task**

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import {
  DomainEventBus,
  runDigestPipeline,
  type PipelineDeps,
} from "@redgest/core";
import {
  RedditClient,
  TokenBucket,
  RedditContentSource,
} from "@redgest/reddit";

export const generateDigest = task({
  id: "generate-digest",
  retry: { maxAttempts: 2 },
  run: async (payload: { jobId: string; subredditIds: string[] }) => {
    const config = loadConfig();
    const db = prisma;
    const eventBus = new DomainEventBus();

    const redditClient = new RedditClient({
      clientId: config.REDDIT_CLIENT_ID,
      clientSecret: config.REDDIT_CLIENT_SECRET,
      userAgent: "redgest/1.0.0",
    });
    const rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
    const contentSource = new RedditContentSource(redditClient, rateLimiter);

    const deps: PipelineDeps = { db, eventBus, contentSource, config };

    const result = await runDigestPipeline(
      payload.jobId,
      payload.subredditIds,
      deps,
    );

    // Trigger delivery if digest was produced
    if (result.digestId) {
      // Import inline to avoid circular dependency at module level
      const { deliverDigest } = await import("./deliver-digest.js");
      await deliverDigest.trigger({ digestId: result.digestId });
    }

    return result;
  },
});
```

**Step 2: Commit**

```bash
git add apps/worker/src/tasks/generate-digest.ts
git commit -m "feat(worker): add generate-digest Trigger.dev task (WS8)"
```

---

## Task 10: deliver-digest Task (WS8)

**Files:**
- Create: `apps/worker/src/tasks/deliver-digest.ts`

**Step 1: Implement the task**

The task loads the digest from DB, queries associated posts/summaries, builds `DigestDeliveryData`, and dispatches to configured channels.

```typescript
import { task } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import { sendDigestEmail, type DigestDeliveryData } from "@redgest/email";
import { sendDigestSlack } from "@redgest/slack";

export const deliverDigest = task({
  id: "deliver-digest",
  retry: { maxAttempts: 3 },
  run: async (payload: { digestId: string }) => {
    const config = loadConfig();
    const db = prisma;

    // Load digest with related data
    const digest = await db.digest.findUniqueOrThrow({
      where: { id: payload.digestId },
      include: {
        digestPosts: {
          orderBy: { rank: "asc" },
          include: {
            post: {
              include: {
                summaries: { take: 1, orderBy: { createdAt: "desc" } },
              },
            },
          },
        },
      },
    });

    // Build delivery data grouped by subreddit
    const subredditMap = new Map<string, DigestDeliveryData["subreddits"][number]>();

    for (const dp of digest.digestPosts) {
      const summary = dp.post.summaries[0];
      if (!summary) continue;

      let sub = subredditMap.get(dp.subreddit);
      if (!sub) {
        sub = { name: dp.subreddit, posts: [] };
        subredditMap.set(dp.subreddit, sub);
      }

      sub.posts.push({
        title: dp.post.title,
        permalink: dp.post.permalink,
        score: dp.post.score,
        summary: summary.summary,
        keyTakeaways: summary.keyTakeaways as string[],
        insightNotes: summary.insightNotes,
        commentHighlights: summary.commentHighlights as Array<{
          author: string;
          insight: string;
          score: number;
        }>,
      });
    }

    const deliveryData: DigestDeliveryData = {
      digestId: digest.id,
      createdAt: digest.createdAt,
      subreddits: Array.from(subredditMap.values()),
    };

    // Dispatch to configured channels in parallel
    const promises: Promise<unknown>[] = [];

    if (config.RESEND_API_KEY && config.DELIVERY_EMAIL) {
      promises.push(
        sendDigestEmail(deliveryData, config.DELIVERY_EMAIL, config.RESEND_API_KEY),
      );
    }

    if (config.SLACK_WEBHOOK_URL) {
      promises.push(sendDigestSlack(deliveryData, config.SLACK_WEBHOOK_URL));
    }

    if (promises.length === 0) {
      console.log("[deliver-digest] No delivery channels configured, skipping");
      return { delivered: [] };
    }

    const results = await Promise.allSettled(promises);
    const delivered: string[] = [];
    for (const [i, r] of results.entries()) {
      if (r.status === "fulfilled") {
        delivered.push(i === 0 && config.RESEND_API_KEY ? "email" : "slack");
      } else {
        console.error(`[deliver-digest] Channel failed: ${r.reason}`);
      }
    }

    return { delivered };
  },
});
```

**Step 2: Commit**

```bash
git add apps/worker/src/tasks/deliver-digest.ts
git commit -m "feat(worker): add deliver-digest Trigger.dev task (WS8)"
```

---

## Task 11: scheduled-digest Cron Task (WS8)

**Files:**
- Create: `apps/worker/src/tasks/scheduled-digest.ts`

**Step 1: Implement the cron task**

```typescript
import { schedules } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import { generateDigest } from "./generate-digest.js";

export const scheduledDigest = schedules.task({
  id: "scheduled-digest",
  cron: process.env.DIGEST_CRON ?? "0 7 * * *",
  run: async () => {
    const config = loadConfig();
    const db = prisma;

    // Find all active subreddits
    const subreddits = await db.subreddit.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    if (subreddits.length === 0) {
      console.log("[scheduled-digest] No active subreddits, skipping");
      return;
    }

    // Create a job record
    const job = await db.job.create({
      data: {
        status: "QUEUED",
        subreddits: subreddits.map((s) => s.id),
        lookback: "24h",
      },
    });

    // Trigger the generate task
    await generateDigest.trigger({
      jobId: job.id,
      subredditIds: subreddits.map((s) => s.id),
    });

    return { jobId: job.id, subredditCount: subreddits.length };
  },
});
```

**Step 2: Commit**

```bash
git add apps/worker/src/tasks/scheduled-digest.ts
git commit -m "feat(worker): add scheduled-digest cron task (WS8)"
```

---

## Task 12: Bootstrap — Conditional Trigger.dev Dispatch (WS8)

**Files:**
- Modify: `packages/mcp-server/src/bootstrap.ts`

**Step 1: Update bootstrap**

Replace the in-process `DigestRequested` handler with conditional dispatch:

```typescript
// Phase 2: Trigger.dev dispatch if configured; fallback to in-process
if (config.TRIGGER_SECRET_KEY) {
  const { generateDigest } = await import("@redgest/worker/tasks");
  eventBus.on("DigestRequested", async (event) => {
    const { jobId, subredditIds } = event.payload;
    try {
      await generateDigest.trigger({ jobId, subredditIds });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DigestRequested] Trigger.dev dispatch failed: ${message}`);
      // Fallback to in-process
      await runDigestPipeline(jobId, subredditIds, pipelineDeps);
    }
  });
} else {
  // Phase 1 fallback: in-process execution
  eventBus.on("DigestRequested", async (event) => {
    const { jobId, subredditIds } = event.payload;
    try {
      await runDigestPipeline(jobId, subredditIds, pipelineDeps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DigestRequested] Pipeline failed for job ${jobId}: ${message}`);
    }
  });
}
```

**Note:** The dynamic import of `@redgest/worker/tasks` avoids loading Trigger.dev SDK when not configured. The worker package needs to export its tasks from its barrel.

**Step 2: Update worker barrel export**

Create `apps/worker/src/index.ts`:
```typescript
export { generateDigest } from "./tasks/generate-digest.js";
export { deliverDigest } from "./tasks/deliver-digest.js";
export { scheduledDigest } from "./tasks/scheduled-digest.js";
```

**Step 3: Run all tests**

Run: `pnpm check`

The existing E2E tests use `REDGEST_TEST_MODE=1` which doesn't set `TRIGGER_SECRET_KEY`, so they'll use the in-process fallback path. This preserves backward compatibility.

**Step 4: Commit**

```bash
git add packages/mcp-server/src/bootstrap.ts apps/worker/src/index.ts
git commit -m "feat: conditional Trigger.dev dispatch in bootstrap with in-process fallback (WS8)"
```

---

## Post-Implementation Checklist

- [ ] All 319+ existing tests still pass (`pnpm check`)
- [ ] E2E tests pass with in-process fallback (`pnpm test:e2e`)
- [ ] New tests: sanitize (9), llm_calls persistence, email template, slack formatter
- [ ] Prisma migration applied cleanly
- [ ] Config schema validates with optional TRIGGER_SECRET_KEY
- [ ] `.env.example` updated with new vars
- [ ] Docker Compose port documented
