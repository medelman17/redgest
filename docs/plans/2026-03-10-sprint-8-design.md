# Sprint 8 Design: Phase 2 Kickoff

**Sprint Goal:** Trigger.dev job queue, delivery channels, observability, and content sanitization
**Capacity:** 12pt | **Duration:** 2026-03-10 — 2026-03-17

---

## Decision Log

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Trigger.dev deployment | Cloud (hosted) | Free tier covers ~30 runs/month. Self-hosted deferred. |
| D2 | Delivery trigger | Trigger.dev task | Retry for free. Decoupled from generation. |
| D3 | Delivery config | Env vars only | YAGNI — personal tool, one user. No schema changes. |
| D4 | Content sanitization | Strip XML/HTML tags | Highest-value, lowest-risk. Prevents fake system/tool tags. |
| D5 | LLM call logging | Per-call table (fields only) | Cost tracking + debugging without storage overhead of full prompts. |

---

## WS8: Trigger.dev Integration (6pt)

### Architecture

Trigger.dev Cloud with a single orchestrator task wrapping `runDigestPipeline()`. The existing step functions remain untouched.

**Why one task instead of 4 sub-tasks:** The pipeline has complex per-subreddit and per-post error recovery with shared state (dedup set, error accumulation, status rollup). Splitting across task boundaries would require serializing intermediate state and reimplementing coordination logic. A single task gets retry + observability while reusing all existing code.

### Tasks

**`generate-digest`** — Top-level task in `apps/worker/src/tasks/generate-digest.ts`
- Receives `{ jobId, subredditIds }` payload
- Constructs `PipelineDeps` (same as bootstrap.ts does today)
- Calls `runDigestPipeline(jobId, subredditIds, deps)`
- On completion, triggers `deliver-digest` task with the `digestId`
- Trigger.dev handles retry on failure

**`deliver-digest`** — Delivery task in `apps/worker/src/tasks/deliver-digest.ts`
- Receives `{ digestId }` payload
- Loads digest + posts from DB
- Checks env vars to determine active channels:
  - `RESEND_API_KEY` + `DELIVERY_EMAIL` set → send email
  - `SLACK_WEBHOOK_URL` set → post to Slack
  - Neither set → skip silently (log it)
- Email and Slack fire in parallel

**`scheduled-digest`** — Cron task in `apps/worker/src/tasks/scheduled-digest.ts`
- Cron schedule: `0 7 * * *` (configurable via env var `DIGEST_CRON`)
- Creates a job record (status: QUEUED)
- Triggers `generate-digest` with all active subreddits

### Bootstrap Change

Replace the in-process listener in `packages/mcp-server/src/bootstrap.ts`:

```typescript
// Phase 1 (current):
eventBus.on("DigestRequested", async (event) => {
  await runDigestPipeline(jobId, subredditIds, pipelineDeps);
});

// Phase 2 (Sprint 8):
eventBus.on("DigestRequested", async (event) => {
  await tasks.trigger("generate-digest", {
    jobId: event.payload.jobId,
    subredditIds: event.payload.subredditIds,
  });
});
```

**Fallback:** If `TRIGGER_SECRET_KEY` is not set, keep the in-process handler (dev mode compatibility).

### Config

- `trigger.config.ts` at repo root with Prisma modern mode extension
- `TRIGGER_SECRET_KEY` already in config schema (required but unused in Phase 1 — make it optional)
- Add `DIGEST_CRON` optional env var (default: `0 7 * * *`)

### Docker Compose

No changes needed for Cloud. Worker runs on Trigger.dev infrastructure.

---

## WS9: Delivery Channels (3pt)

### Email (`@redgest/email`)

**Dependencies:** `react-email`, `@react-email/components`, `resend`

**Components:**
- `DigestEmail` — React Email template. Renders subreddit sections with post summaries, key takeaways, and insight notes. Clean layout, no heavy styling.
- `sendDigestEmail(digest, email)` — Takes assembled digest data + recipient email, calls Resend API.

### Slack (`@redgest/slack`)

**Dependencies:** None (Block Kit is JSON, webhook is fetch)

**Components:**
- `formatDigestBlocks(digest)` — Converts digest data to Slack Block Kit JSON. Header, dividers between subreddits, section blocks per post.
- `sendDigestSlack(digest, webhookUrl)` — POST Block Kit payload to webhook URL via `fetch()`.

### Config Change

Add to Zod schema in `@redgest/config`:
- `DELIVERY_EMAIL` — optional string (recipient email address)

`RESEND_API_KEY` and `SLACK_WEBHOOK_URL` already exist in schema.

### Data Flow

`deliver-digest` task → query digest + posts from DB → call `sendDigestEmail()` and/or `sendDigestSlack()` based on env vars.

---

## Gap #1: LLM Calls Table (1.5pt)

### Schema

New `llm_calls` table:

```prisma
model LlmCall {
  id           String   @id @default(uuid(7))
  jobId        String
  postId       String?
  task         String   // "triage" | "summarize"
  model        String
  inputTokens  Int
  outputTokens Int
  durationMs   Int
  cached       Boolean
  finishReason String
  createdAt    DateTime @default(now())

  job  Job   @relation(fields: [jobId], references: [id])
  post Post? @relation(fields: [postId], references: [id])

  @@map("llm_calls")
}
```

### Integration

The `generateWithLogging()` middleware returns `{ output, log }`. The step functions in `@redgest/core` (`triageStep`, `summarizeStep`) already have `db` and `jobId` in scope. After the LLM call, write the log record to `llm_calls`.

**Why step functions write, not middleware:** `@redgest/llm` doesn't have access to `db` or `jobId`. Passing those through would couple the LLM package to the database. Step functions in `@redgest/core` maintain the existing dependency graph.

### Return Value Change

`triageStep` and `summarizeStep` currently discard the `log` from `generateWithLogging`. They need to:
1. Capture the `log` return value
2. Write it to `db.llmCall.create()` with the appropriate `jobId` and `postId`

---

## Gap #5: Reddit Content Sanitization (1pt)

### Utility

`packages/reddit/src/sanitize.ts`:

```typescript
export function sanitizeContent(text: string): string {
  return text.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\/?>/g, "");
}
```

**What gets stripped:** Opening tags (`<system>`), closing tags (`</tool_use>`), self-closing tags (`<br/>`), tags with attributes (`<div class="...">`).

**What's preserved:** Everything else — markdown, code blocks, URLs, angle brackets in math expressions.

### Integration Point

Apply in `fetchStep` (`packages/core/src/pipeline/fetch-step.ts`) when persisting posts and comments to the database. Sanitize `selftext` and comment `body` before `db.post.upsert()` / `db.postComment.create()`.

All downstream consumers (triage, summarization, digest assembly) get clean content automatically.

### Package Location

Lives in `@redgest/reddit` since it's specific to Reddit content entering the system. Exported for direct testing.

---

## TD-002: Postgres Port Documentation (0.5pt)

- Add comment in `docker-compose.yml` explaining 5433 mapping (avoids conflict with local Postgres)
- Add note in README Quick Start section

---

## Dependency Order

```
Gap #5 (sanitize)     ──┐
Gap #1 (llm_calls)    ──┼── Independent, do first (quick wins)
TD-002 (port docs)    ──┘
WS8: trigger.config   ──► WS8: tasks ──► WS8: bootstrap change ──► WS8: cron
WS9: email template   ──► WS9: Resend  ──┐
WS9: Block Kit        ──► WS9: webhook ──┼── WS8: deliver-digest task
                                          └── (depends on at least one channel)
```

WS9 (delivery channels) can run in parallel with WS8 (Trigger.dev). They converge at the `deliver-digest` task.
