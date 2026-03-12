# cancel_run Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `cancel_run` MCP tool that aborts in-progress digest runs via cooperative pipeline cancellation, preventing wasted LLM tokens.

**Architecture:** New `CancelRun` CQRS command sets job status to `CANCELED`. Pipeline orchestrator checks cancellation at step boundaries via DB polling. MCP tool wraps the command. Trigger.dev runs are also canceled via SDK when applicable.

**Tech Stack:** Prisma migration (enum), TypeScript command handler, Vitest tests

**Spec:** `docs/superpowers/specs/2026-03-11-cancel-run-design.md`

---

## Task 1: Add CANCELED to JobStatus enum (Prisma migration)

**Files:**
- Modify: `packages/db/prisma/schema.prisma:17-25`

- [ ] **Step 1: Add CANCELED to the JobStatus enum**

In `packages/db/prisma/schema.prisma`, add `CANCELED` after `PARTIAL`:

```prisma
enum JobStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  PARTIAL
  CANCELED

  @@map("job_status")
}
```

- [ ] **Step 2: Create the migration**

Run: `pnpm --filter @redgest/db exec prisma migrate dev --name add_canceled_status`

This generates a migration that adds `CANCELED` to the `job_status` enum. **Check the generated migration SQL** — ensure it only adds the enum value and does NOT drop any raw-SQL indexes (BRIN, partial, DESC indexes from migration 4). If indexes are dropped, restore them in the same migration file before applying.

- [ ] **Step 3: Regenerate Prisma client**

Run: `turbo db:generate`

- [ ] **Step 4: Verify build**

Run: `turbo build --filter=@redgest/db`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add CANCELED status to JobStatus enum (#17)"
```

---

## Task 2: Add DigestCanceled domain event

**Files:**
- Modify: `packages/core/src/events/types.ts:6-16`
- Modify: `packages/core/src/events/schemas.ts:9-48`
- Test: `packages/core/src/__tests__/event-schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/__tests__/event-schemas.test.ts`:

1. In the `expectedTypes` array (line 7-17), add `"DigestCanceled"`:

```typescript
const expectedTypes: DomainEventType[] = [
  "DigestRequested",
  "DigestCompleted",
  "DigestFailed",
  "DigestCanceled",
  "PostsFetched",
  "PostsTriaged",
  "PostsSummarized",
  "SubredditAdded",
  "SubredditRemoved",
  "ConfigUpdated",
];
```

2. Add new test cases in the describe block:

```typescript
it("validates DigestCanceled payload", () => {
  const result = parseEventPayload("DigestCanceled", { jobId: "job-123" });
  expect(result.success).toBe(true);
});

it("rejects DigestCanceled with missing jobId", () => {
  const result = parseEventPayload("DigestCanceled", {});
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/event-schemas.test.ts`

Expected: Compile error — `DigestCanceled` doesn't exist in `DomainEventType`.

- [ ] **Step 3: Add DigestCanceled to DomainEventMap**

In `packages/core/src/events/types.ts`, add after `DigestFailed`:

```typescript
DigestCanceled: { jobId: string };
```

- [ ] **Step 4: Add Zod schema for DigestCanceled**

In `packages/core/src/events/schemas.ts`, add after `DigestFailed` entry:

```typescript
DigestCanceled: z.object({
  jobId: z.string(),
}),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/event-schemas.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/events/types.ts packages/core/src/events/schemas.ts packages/core/src/__tests__/event-schemas.test.ts
git commit -m "feat(core): add DigestCanceled domain event (#17)"
```

---

## Task 3: Add CancelRun command types and dispatch entries

**Files:**
- Modify: `packages/core/src/commands/types.ts:7-59`
- Modify: `packages/core/src/commands/dispatch.ts:49-66,161-173`

- [ ] **Step 1: Add CancelRun to CommandMap**

In `packages/core/src/commands/types.ts`, add to `CommandMap`:

```typescript
CancelRun: {
  jobId: string;
};
```

- [ ] **Step 2: Add CancelRun to CommandResultMap**

```typescript
CancelRun: { jobId: string; status: "CANCELED" };
```

- [ ] **Step 3: Add CancelRun to CommandEventMap**

```typescript
CancelRun: "DigestCanceled";
```

- [ ] **Step 4: Add CancelRun to dispatch.ts lookup maps**

In `packages/core/src/commands/dispatch.ts`, update `COMMAND_EVENT_TYPES` (line 49-55):

```typescript
const COMMAND_EVENT_TYPES: Record<CommandType, DomainEventType | undefined> = {
  GenerateDigest: "DigestRequested",
  AddSubreddit: "SubredditAdded",
  RemoveSubreddit: "SubredditRemoved",
  UpdateSubreddit: undefined,
  UpdateConfig: "ConfigUpdated",
  CancelRun: "DigestCanceled",
};
```

Update `COMMAND_AGGREGATE_TYPES` (line 60-66):

```typescript
const COMMAND_AGGREGATE_TYPES: Record<CommandType, string> = {
  GenerateDigest: "job",
  AddSubreddit: "subreddit",
  RemoveSubreddit: "subreddit",
  UpdateSubreddit: "subreddit",
  UpdateConfig: "config",
  CancelRun: "job",
};
```

Update `extractAggregateId` (line 161-173) — the existing `GenerateDigest` branch already handles `result.jobId`, and `CancelRun` also returns `{ jobId }`, so it's already covered. No change needed here.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`

Expected: PASS (types are consistent but no handler yet — registry is partial `?` typed)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/commands/types.ts packages/core/src/commands/dispatch.ts
git commit -m "feat(core): add CancelRun command types and dispatch entries (#17)"
```

---

## Task 4: Implement CancelRun command handler

**Files:**
- Create: `packages/core/src/commands/handlers/cancel-run.ts`
- Modify: `packages/core/src/commands/handlers/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/command-handlers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/__tests__/command-handlers.test.ts`:

```typescript
import { handleCancelRun } from "../commands/handlers/cancel-run.js";
```

Then add a new describe block:

```typescript
describe("handleCancelRun", () => {
  it("cancels a QUEUED job", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue({
      id: "job-1",
      status: "QUEUED",
      triggerRunId: null,
    });
    const mockUpdate = vi.fn().mockResolvedValue({ id: "job-1" });
    const ctx = makeCtx({ job: { findUnique: mockFindUnique, update: mockUpdate } });

    const result = await handleCancelRun({ jobId: "job-1" }, ctx);

    expect(result.data).toEqual({ jobId: "job-1", status: "CANCELED" });
    expect(result.event).toEqual({ jobId: "job-1" });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "CANCELED",
        completedAt: expect.any(Date),
        error: "Canceled by user",
      },
    });
  });

  it("cancels a RUNNING job", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue({
      id: "job-2",
      status: "RUNNING",
      triggerRunId: null,
    });
    const mockUpdate = vi.fn().mockResolvedValue({ id: "job-2" });
    const ctx = makeCtx({ job: { findUnique: mockFindUnique, update: mockUpdate } });

    const result = await handleCancelRun({ jobId: "job-2" }, ctx);

    expect(result.data).toEqual({ jobId: "job-2", status: "CANCELED" });
    expect(result.event).toEqual({ jobId: "job-2" });
  });

  it("throws NOT_FOUND when job does not exist", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ job: { findUnique: mockFindUnique } });

    await expect(
      handleCancelRun({ jobId: "nonexistent" }, ctx),
    ).rejects.toThrow(RedgestError);

    await expect(
      handleCancelRun({ jobId: "nonexistent" }, ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws CONFLICT when job is already COMPLETED", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue({
      id: "job-3",
      status: "COMPLETED",
      triggerRunId: null,
    });
    const ctx = makeCtx({ job: { findUnique: mockFindUnique } });

    await expect(
      handleCancelRun({ jobId: "job-3" }, ctx),
    ).rejects.toThrow(RedgestError);

    await expect(
      handleCancelRun({ jobId: "job-3" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throws CONFLICT when job is already CANCELED", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue({
      id: "job-4",
      status: "CANCELED",
      triggerRunId: null,
    });
    const ctx = makeCtx({ job: { findUnique: mockFindUnique } });

    await expect(
      handleCancelRun({ jobId: "job-4" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throws CONFLICT when job is FAILED", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue({
      id: "job-5",
      status: "FAILED",
      triggerRunId: null,
    });
    const ctx = makeCtx({ job: { findUnique: mockFindUnique } });

    await expect(
      handleCancelRun({ jobId: "job-5" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throws CONFLICT when job is PARTIAL", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue({
      id: "job-6",
      status: "PARTIAL",
      triggerRunId: null,
    });
    const ctx = makeCtx({ job: { findUnique: mockFindUnique } });

    await expect(
      handleCancelRun({ jobId: "job-6" }, ctx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
```

Also update the registry test:

```typescript
// In "commandHandlers registry" describe block, update:
it("registers all 6 handlers", () => {
  expect(commandHandlers.GenerateDigest).toBe(handleGenerateDigest);
  expect(commandHandlers.AddSubreddit).toBe(handleAddSubreddit);
  expect(commandHandlers.RemoveSubreddit).toBe(handleRemoveSubreddit);
  expect(commandHandlers.UpdateSubreddit).toBe(handleUpdateSubreddit);
  expect(commandHandlers.UpdateConfig).toBe(handleUpdateConfig);
  expect(commandHandlers.CancelRun).toBe(handleCancelRun);
});
```

Add to imports at top of file:
```typescript
import { handleCancelRun } from "../commands/handlers/cancel-run.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/command-handlers.test.ts`

Expected: FAIL — `cancel-run.js` module not found.

- [ ] **Step 3: Implement the handler**

Create `packages/core/src/commands/handlers/cancel-run.ts`:

```typescript
import { RedgestError } from "../../errors.js";
import type { CommandHandler } from "../types.js";

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "PARTIAL", "CANCELED"];

export const handleCancelRun: CommandHandler<"CancelRun"> = async (
  params,
  ctx,
) => {
  const job = await ctx.db.job.findUnique({
    where: { id: params.jobId },
    select: { id: true, status: true, triggerRunId: true },
  });

  if (!job) {
    throw new RedgestError("NOT_FOUND", "Job not found");
  }

  if (TERMINAL_STATUSES.includes(job.status)) {
    throw new RedgestError(
      "CONFLICT",
      `Cannot cancel a job with status ${job.status}`,
      { jobId: job.id, currentStatus: job.status },
    );
  }

  // Best-effort: cancel Trigger.dev run if applicable
  if (job.status === "RUNNING" && job.triggerRunId) {
    try {
      const { runs } = await import("@trigger.dev/sdk/v3");
      await runs.cancel(job.triggerRunId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[CancelRun] Failed to cancel Trigger.dev run ${job.triggerRunId}: ${message}`,
      );
    }
  }

  await ctx.db.job.update({
    where: { id: params.jobId },
    data: {
      status: "CANCELED",
      completedAt: new Date(),
      error: "Canceled by user",
    },
  });

  return {
    data: { jobId: params.jobId, status: "CANCELED" as const },
    event: { jobId: params.jobId },
  };
};
```

- [ ] **Step 4: Register the handler**

In `packages/core/src/commands/handlers/index.ts`, add:

```typescript
import { handleCancelRun } from "./cancel-run.js";
```

Add to the `commandHandlers` object:

```typescript
CancelRun: handleCancelRun,
```

Add to the exports:

```typescript
export { handleCancelRun } from "./cancel-run.js";
```

- [ ] **Step 5: Export from core index**

In `packages/core/src/index.ts`, add `handleCancelRun` to the command handlers export:

```typescript
export {
  handleGenerateDigest,
  handleAddSubreddit,
  handleRemoveSubreddit,
  handleUpdateSubreddit,
  handleUpdateConfig,
  handleCancelRun,
} from "./commands/handlers/index.js";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/command-handlers.test.ts`

Expected: PASS — all 7 new tests pass, registry test updated.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/commands/handlers/cancel-run.ts packages/core/src/commands/handlers/index.ts packages/core/src/index.ts packages/core/src/__tests__/command-handlers.test.ts
git commit -m "feat(core): implement CancelRun command handler (#17)"
```

---

## Task 5: Add pipeline cancellation checkpoints

**Files:**
- Modify: `packages/core/src/pipeline/orchestrator.ts`
- Modify: `packages/core/src/pipeline/types.ts:180-186`
- Test: `packages/core/src/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Update mockDb type and add failing tests**

First, update the `mockDb` type declaration in the test file to include `findUnique`:

```typescript
let mockDb: {
  job: {
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  subreddit: { findMany: ReturnType<typeof vi.fn> };
  config: { findFirst: ReturnType<typeof vi.fn> };
};
```

Update `beforeEach` to initialize `findUnique`:

```typescript
mockDb = {
  job: {
    update: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue({ status: "RUNNING" }),
  },
  subreddit: { ... }, // keep existing
  config: { ... },    // keep existing
};
```

The default `findUnique` returns `{ status: "RUNNING" }` so existing tests (which never trigger cancellation) are unaffected.

Then add a new describe block:

```typescript
describe("cancellation checkpoints", () => {
  it("stops before fetch when job is CANCELED", async () => {
    // Pre-loop checkpoint returns CANCELED immediately
    mockDb.job.findUnique.mockResolvedValue({ status: "CANCELED" });

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("CANCELED");
    expect(mockFetchStep).not.toHaveBeenCalled();
  });

  it("stops before triage when job is CANCELED mid-run", async () => {
    mockDb.job.findUnique
      .mockResolvedValueOnce({ status: "RUNNING" })  // pre-loop check
      .mockResolvedValueOnce({ status: "RUNNING" })  // before fetch
      .mockResolvedValueOnce({ status: "CANCELED" }); // before triage

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("CANCELED");
    expect(mockFetchStep).toHaveBeenCalled();
    expect(mockTriageStep).not.toHaveBeenCalled();
  });

  it("stops before summarize when job is CANCELED mid-run", async () => {
    mockDb.job.findUnique
      .mockResolvedValueOnce({ status: "RUNNING" })  // pre-loop check
      .mockResolvedValueOnce({ status: "RUNNING" })  // before fetch
      .mockResolvedValueOnce({ status: "RUNNING" })  // before triage
      .mockResolvedValueOnce({ status: "CANCELED" }); // before summarize

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("CANCELED");
    expect(mockFetchStep).toHaveBeenCalled();
    expect(mockTriageStep).toHaveBeenCalled();
    expect(mockSummarizeStep).not.toHaveBeenCalled();
  });

  it("preserves partial results when canceled after some summarization", async () => {
    const sub1 = makeSubreddit({ id: "sub-1", name: "typescript" });
    const sub2 = makeSubreddit({ id: "sub-2", name: "rust" });
    mockDb.subreddit.findMany.mockResolvedValue([sub1, sub2]);

    mockFetchStep.mockResolvedValue(makeFetchResult("typescript"));

    mockDb.job.findUnique
      .mockResolvedValueOnce({ status: "RUNNING" })  // pre-loop check
      .mockResolvedValueOnce({ status: "RUNNING" })  // before fetch sub1
      .mockResolvedValueOnce({ status: "RUNNING" })  // before triage sub1
      .mockResolvedValueOnce({ status: "RUNNING" })  // before summarize sub1 post
      .mockResolvedValueOnce({ status: "CANCELED" }); // before fetch sub2

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("CANCELED");
    // Sub1 was fully processed before cancellation
    expect(result.subredditResults.length).toBeGreaterThanOrEqual(1);
    const sub1Result = result.subredditResults[0];
    expect(sub1Result).toBeDefined();
    expect(sub1Result?.posts).toHaveLength(1);
  });

  it("does not overwrite CANCELED status with COMPLETED", async () => {
    // All checkpoints return RUNNING, but final check returns CANCELED
    mockDb.job.findUnique
      .mockResolvedValueOnce({ status: "RUNNING" })  // pre-loop check
      .mockResolvedValueOnce({ status: "RUNNING" })  // before fetch
      .mockResolvedValueOnce({ status: "RUNNING" })  // before triage
      .mockResolvedValueOnce({ status: "RUNNING" })  // before summarize
      .mockResolvedValue({ status: "CANCELED" });     // final check (after loop)

    const result = await runDigestPipeline("job-1", [], deps);

    expect(result.status).toBe("CANCELED");
    // Job should NOT be updated to COMPLETED
    const updateCalls = mockDb.job.update.mock.calls;
    const finalStatuses = updateCalls
      .map((c: unknown[]) => (c[0] as { data: Record<string, unknown> }).data["status"])
      .filter((s): s is string => typeof s === "string" && s !== "RUNNING");
    expect(finalStatuses).not.toContain("COMPLETED");
    expect(finalStatuses).not.toContain("PARTIAL");
  });
});
```

**Key design note:** The mock chain accounts for checkpoints in this order:
1. Pre-loop check (after loading subreddits/config/dedup)
2. Before fetch (top of subreddit loop)
3. Before triage (after fetch + dedup)
4. Before each summarize (inside summarize loop)
5. Final check (after subreddit loop, before status determination)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/orchestrator.test.ts`

Expected: FAIL — no cancellation logic yet.

- [ ] **Step 3: Add CANCELED to PipelineResult status**

In `packages/core/src/pipeline/types.ts`, update `PipelineResult`:

```typescript
export interface PipelineResult {
  jobId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELED";
  digestId?: string;
  subredditResults: SubredditPipelineResult[];
  errors: string[];
}
```

- [ ] **Step 4: Add checkCancellation helper and checkpoint calls to orchestrator**

In `packages/core/src/pipeline/orchestrator.ts`:

Add helper function after the `emitEvent` helper:

```typescript
async function checkCancellation(
  jobId: string,
  db: PrismaClient,
): Promise<boolean> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === "CANCELED";
}
```

Modify `runPipelineBody()` to add checkpoints. The changes are:

**Before the subreddit loop (after loading dedup set):**
```typescript
// Check cancellation before starting subreddit processing
if (await checkCancellation(jobId, db)) {
  return { jobId, status: "CANCELED", subredditResults: [], errors: [] };
}
```

**Inside the subreddit for-loop, at the top of the try block (before fetchStep):**
```typescript
// Checkpoint: before fetch
if (await checkCancellation(jobId, db)) {
  break;
}
```

**After fetchStep + dedup, before triageStep:**
```typescript
// Checkpoint: before triage
if (await checkCancellation(jobId, db)) {
  break;
}
```

**Inside the summarize for-loop, before each summarizeStep call:**
```typescript
// Checkpoint: before each summarization
if (await checkCancellation(jobId, db)) {
  break;
}
```

**After the subreddit loop, modify the final status determination.** Before the `totalPosts === 0` check, add:

```typescript
// Check if job was canceled — preserve CANCELED status
if (await checkCancellation(jobId, db)) {
  const totalPosts = subredditResults.reduce((sum, r) => sum + r.posts.length, 0);
  // Assemble partial results if any content was generated
  if (totalPosts > 0) {
    await assembleStep(jobId, subredditResults, db);
  }
  return { jobId, status: "CANCELED", subredditResults, errors };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/orchestrator.test.ts`

Expected: PASS — all existing + new tests pass.

- [ ] **Step 6: Run full core test suite**

Run: `pnpm --filter @redgest/core exec vitest run`

Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pipeline/orchestrator.ts packages/core/src/pipeline/types.ts packages/core/src/__tests__/orchestrator.test.ts
git commit -m "feat(core): add cooperative cancellation checkpoints to pipeline (#17)"
```

---

## Task 6: Add cancel_run MCP tool

**Files:**
- Modify: `packages/mcp-server/src/tools.ts`
- Test: `packages/mcp-server/src/__tests__/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/mcp-server/src/__tests__/tools.test.ts`, in the appropriate describe block:

```typescript
describe("cancel_run", () => {
  it("calls CancelRun command and returns envelope", async () => {
    const { result, execute } = createMockDeps();
    execute.mockResolvedValue({ jobId: "job-1", status: "CANCELED" });
    const handlers = createToolHandlers(result);

    const response = await invoke(handlers, "cancel_run", { jobId: "job-1" });
    const parsed = parseEnvelope(response);

    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ jobId: "job-1", status: "CANCELED" });
    expect(execute).toHaveBeenCalledWith(
      "CancelRun",
      { jobId: "job-1" },
      expect.any(Object),
    );
  });

  it("returns NOT_FOUND error for unknown job", async () => {
    const { result, execute } = createMockDeps();
    execute.mockRejectedValue(
      new RedgestError("NOT_FOUND", "Job not found"),
    );
    const handlers = createToolHandlers(result);

    const response = await invoke(handlers, "cancel_run", { jobId: "bad-id" });
    const parsed = parseEnvelope(response);

    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("NOT_FOUND");
  });

  it("returns CONFLICT error for terminal job", async () => {
    const { result, execute } = createMockDeps();
    execute.mockRejectedValue(
      new RedgestError("CONFLICT", "Cannot cancel a job with status COMPLETED"),
    );
    const handlers = createToolHandlers(result);

    const response = await invoke(handlers, "cancel_run", { jobId: "done-job" });
    const parsed = parseEnvelope(response);

    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("CONFLICT");
  });
});
```

Also add a test that `createToolServer` registers the `cancel_run` tool (follow existing pattern).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts`

Expected: FAIL — `cancel_run` handler not found.

- [ ] **Step 3: Add cancel_run handler**

In `packages/mcp-server/src/tools.ts`, add to the `handlers` object in `createToolHandlers()`:

```typescript
cancel_run: async (args) => {
  return safe(async () => {
    const jobId = args.jobId as string;
    const result = await deps.execute(
      "CancelRun",
      { jobId },
      eCtx,
    );
    return envelope(result);
  });
},
```

- [ ] **Step 4: Register the tool in createToolServer**

In `createToolServer()`, add after the `get_run_status` tool registration:

```typescript
server.tool(
  "cancel_run",
  "Cancel an in-progress or queued digest run. Stops the pipeline at the next step boundary and preserves any partial results.",
  { jobId: z.string().describe("The job ID to cancel") },
  async (args) => call("cancel_run", args),
);
```

- [ ] **Step 5: Update USAGE_GUIDE**

In the `USAGE_GUIDE` constant, add `cancel_run` to the Digest Generation section:

```
- **cancel_run** — Cancel an in-progress or queued digest run
```

Update the Per-Tool Error Codes table:

```
| cancel_run | NOT_FOUND, CONFLICT, INTERNAL_ERROR |
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-server/src/tools.ts packages/mcp-server/src/__tests__/tools.test.ts
git commit -m "feat(mcp): add cancel_run tool (#17)"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run full test suite**

Run: `turbo test`

Expected: All packages pass.

- [ ] **Step 2: Run typecheck**

Run: `turbo typecheck`

Expected: No type errors.

- [ ] **Step 3: Run lint**

Run: `turbo lint`

Expected: No lint errors.

- [ ] **Step 4: Run full check**

Run: `pnpm check`

Expected: All pass.

- [ ] **Step 5: Close GitHub issue**

```bash
gh issue close 17 --comment "Implemented cancel_run tool with cooperative pipeline cancellation. See commits referencing #17."
```
