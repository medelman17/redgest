# @redgest/core

CQRS infrastructure + pipeline orchestration. The heart of the system.

## Architecture

Three type maps are the single source of truth — all derived types flow from these:

- `CommandMap` — command name → params type
- `QueryMap` — query name → params type
- `DomainEventMap` — event name → payload type

Adding a new command/query/event starts in the type map. The union types, handler signatures, and Zod schemas all derive automatically.

## Directory Structure

```
src/
├── commands/
│   ├── types.ts           # CommandMap, CommandResultMap, CommandEventMap
│   ├── dispatch.ts        # createExecute() factory
│   └── handlers/          # One file per command (ADR-005)
├── queries/
│   ├── types.ts           # QueryMap, QueryResultMap
│   ├── dispatch.ts        # createQuery() factory
│   └── handlers/          # One file per query (ADR-005)
├── events/
│   ├── types.ts           # DomainEventMap, DomainEvent union
│   ├── bus.ts             # DomainEventBus (typed EventEmitter wrapper)
│   ├── persist.ts         # persistEvent() + EventCreateClient interface
│   └── schemas.ts         # Zod schemas for event payloads
├── pipeline/
│   ├── types.ts           # PipelineDeps, ContentSource, step result types
│   ├── orchestrator.ts    # runDigestPipeline() — step composition
│   ├── fetch-step.ts      # Content fetching + dedup + persist
│   ├── triage-step.ts     # LLM selection pass
│   ├── summarize-step.ts  # LLM summarization pass
│   ├── assemble-step.ts   # Digest rendering
│   ├── token-budget.ts    # Character-based token estimation
│   └── dedup.ts           # findPreviousPostIds()
├── context.ts             # HandlerContext, DbClient types
└── errors.ts              # RedgestError, ErrorCode const object
```

## Dispatch Mechanics

**`createExecute(handlers)` → `execute(type, params, ctx)`**
1. Runs handler inside `ctx.db.$transaction()`
2. If handler returns event → `persistEvent(tx, event)` within transaction
3. After commit → `eventBus.emitEvent(event)` (deferred emission)
4. Returns `{ data }` to caller

**`createQuery(handlers)` → `query(type, params, ctx)`**
- Pure dispatch — no transaction, no events
- Queries prefer views where they exist (ADR-006), tables for search/config

**HandlerContext:** `{ db, eventBus, config }` — injected into every handler.

## Pipeline Step Composition

`runDigestPipeline(jobId, subredditIds, deps)` chains:

1. **fetchStep** — For each subreddit: fetch content via ContentSource, dedup against last 3 digests, persist posts/comments to DB
2. **triageStep** — LLM ranks posts per subreddit, returns selected indices
3. **summarizeStep** — LLM generates structured summary per selected post
4. **assembleStep** — Creates Digest + DigestPost records, updates Job status

**Error recovery (ADR-013):** Per-subreddit and per-post. Failed fetch/triage → skip subreddit. Failed summary → skip post. Status: COMPLETED | PARTIAL | FAILED.

## PipelineDeps (Dependency Injection)

```typescript
interface PipelineDeps {
  db: PrismaClient;
  eventBus: DomainEventBus;
  contentSource: ContentSource;
  config: RedgestConfig;
  generateTriage?: (...) => Promise<GenerateResult<TriageResult>>;
  generateSummary?: (...) => Promise<GenerateResult<PostSummary>>;
}
```

Optional LLM overrides enable test doubles without mocking — pass fake functions directly.

## Handler Patterns

**Command handler returns data + optional event:**
```typescript
export const handleAddSubreddit: CommandHandler<"AddSubreddit"> = async (params, ctx) => {
  const sub = await ctx.db.subreddit.create({ data: { ... } });
  return {
    data: { subredditId: sub.id },
    event: { subredditId: sub.id, name: sub.name },  // payload only — envelope built by dispatch
  };
};
```

**Query handler returns Prisma result directly:**
```typescript
export const handleGetDigest: QueryHandler<"GetDigest"> = async (params, ctx) => {
  return ctx.db.digestView.findUnique({ where: { digestId: params.digestId } });
};
```

## Testing

- `stub<T>()` helper avoids `objectLiteralTypeAssertions: "never"` lint rule
- Context stubs: `{ db: stub<HandlerContext["db"]>(), eventBus: ..., config: ... }`
- Pipeline tests use FakeContentSource + fake LLM via PipelineDeps overrides

## Gotchas

- **Double cast in dispatch.ts (TD-004):** `tx as unknown as HandlerContext["db"]` — safe, Prisma's `$transaction` always provides full TransactionClient at runtime
- **Event envelope is built by dispatch, not handler** — handlers return payload only, `buildEvent()` adds type/aggregateType/aggregateId/correlationId
- **DomainEventMap is authoritative** — adding an event there auto-updates the DomainEvent union, bus signatures, and requires a Zod schema entry
- **Step results are chained** — FetchStepResult feeds TriageStepResult (indices into fetched posts) feeds SummarizeStepResult (per-post) feeds AssembleStepResult
- **Event table ID is BigInt autoincrement** (not UUID v7) — immutable append-only log uses autoincrement for ordering
