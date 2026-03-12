# cancel_run Tool Design

## Overview

Add a `cancel_run` MCP tool that aborts in-progress digest runs, preventing unnecessary LLM token consumption from accidental or misconfigured triggers. Implements cooperative cancellation via DB-polling checkpoints in the pipeline.

Resolves: [#17](https://github.com/medelman17/redgest/issues/17)

## Data Model

Add `CANCELED` to the `JobStatus` enum in `packages/db/prisma/schema.prisma`:

```prisma
enum JobStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  PARTIAL
  CANCELED
}
```

Requires a Prisma migration to alter the enum in Postgres.

## CancelRun Command

**Location:** `packages/core/src/commands/handlers/cancel-run.ts`

**Type registrations:**
- `CommandMap.CancelRun: { jobId: string }`
- `CommandResultMap.CancelRun: { jobId: string; status: "CANCELED" }`
- `CommandEventMap.CancelRun: "DigestCanceled"`

**Logic:**
1. Find job by `jobId`
2. If not found: throw `RedgestError("NOT_FOUND", "Job not found")`
3. If status is terminal (`COMPLETED`, `FAILED`, `PARTIAL`, `CANCELED`): throw `RedgestError("CONFLICT", "Cannot cancel a job with status {status}")`
4. If `RUNNING` and job has `triggerRunId`: call Trigger.dev `runs.cancel(triggerRunId)` via dynamic import (same pattern as dispatch)
5. Update job: `status = "CANCELED"`, `completedAt = new Date()`, `error = "Canceled by user"`
6. Return `{ data: { jobId, status: "CANCELED" }, event: { jobId } }`

**State transitions:**
- `QUEUED` -> `CANCELED` (immediate, no pipeline running)
- `RUNNING` -> `CANCELED` (signals pipeline to stop at next checkpoint)

## Pipeline Cooperative Cancellation

**Location:** `packages/core/src/pipeline/orchestrator.ts`

Add a `checkCancellation(jobId, db)` helper that queries the job's current status from the database. Returns `true` if status is `CANCELED`.

Insert checkpoint calls at three step boundaries in `runPipelineBody()`:

1. **Before each subreddit's fetch step** — Earliest exit, prevents all downstream work for remaining subreddits
2. **Before triage step** — After fetch, before LLM call
3. **Before each post's summarize step** — Most granular checkpoint, prevents individual LLM calls

When cancellation is detected:
- Stop processing remaining steps
- Assemble whatever partial results exist (posts fetched, summaries generated so far)
- Create a partial digest if any content was generated
- Return early — the job status is already `CANCELED` in the DB (set by the command handler)
- Do NOT overwrite the `CANCELED` status with `PARTIAL` or `COMPLETED`

The final status determination in `determineFinalStatus()` must respect `CANCELED` — if the job is already `CANCELED`, preserve that status regardless of partial results.

## Domain Event

Add `DigestCanceled` to `DomainEventMap`:

```typescript
DigestCanceled: {
  jobId: string;
};
```

Add corresponding Zod schema in `eventPayloadSchemas`. No downstream handler needed in Phase 2 — the event exists for observability and future use.

## MCP Tool

**Location:** `packages/mcp-server/src/tools.ts`

Tool definition:
- **Name:** `cancel_run`
- **Description:** Cancel an in-progress or queued digest run
- **Parameters:** `jobId` (string, required) — The job ID to cancel
- **Response:** `{ ok: true, data: { jobId, status: "CANCELED" } }`
- **Errors:**
  - `NOT_FOUND` — Job ID doesn't exist
  - `CONFLICT` — Job is already in a terminal state

Implementation follows existing pattern: parse args, call `deps.execute("CancelRun", { jobId }, eCtx)`, return `envelope(result)`.

## Error Handling

| Scenario | Error Code | Message |
|----------|-----------|---------|
| Job not found | `NOT_FOUND` | "Job not found" |
| Job already completed/failed/partial | `CONFLICT` | "Cannot cancel a job with status {status}" |
| Job already canceled | `CONFLICT` | "Cannot cancel a job with status CANCELED" |
| Trigger.dev cancel fails | Best-effort | Log warning, still mark CANCELED in DB |

Trigger.dev cancellation is best-effort — if the API call fails, we still mark the job as CANCELED locally. The pipeline checkpoints will pick up the status change on the next iteration.

## Scope Exclusions

- No cancellation reason field (YAGNI)
- No auto-cancel when new `generate_digest` is triggered (existing CONFLICT error prevents concurrent runs)
- No WebSocket/SSE push notification of cancellation status changes
- No `cancel_all` batch operation
