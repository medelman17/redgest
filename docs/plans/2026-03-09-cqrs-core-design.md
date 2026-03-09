# CQRS Core Infrastructure — Design

> **For Claude:** This is a design doc. Use `superpowers:writing-plans` to create the implementation plan.

**Goal:** Build the typed dispatch infrastructure (commands, queries, events) that WS6 (Pipeline), WS7 (MCP Server), and WS8 (Trigger.dev) all depend on.

**Pattern:** CQRS without event sourcing. Typed dispatch functions (not class-based buses). Three map types as single sources of truth. Event-map-derived discriminated unions. Transaction-wrapped commands with auto-persisted events.

---

## ADR-001: Typed Dispatch Over Full Bus Pattern

**Status:** Accepted
**Context:** The reconciled implementation plan calls for `CommandBus` / `QueryBus` classes with handler registries. However, Redgest is a single-user personal tool with 12 MCP tools dispatching to ~12 handlers.

**Decision:** Use typed dispatch functions (`execute()` and `query()`) with type maps instead of class-based bus abstractions. Commands and queries are discriminated union types derived from `CommandMap` and `QueryMap` interfaces. A single dispatch function maps type → handler.

**Rationale:**
- Same decoupling and middleware injection point as a bus, with less boilerplate
- TypeScript's type system (discriminated unions, mapped types) provides the same safety guarantees
- Handlers are plain async functions — no class hierarchy, no DI container
- The `execute` function IS a bus, it's just a function instead of a class

**Trade-offs:**
- No runtime handler registration (type map is static at build time)
- If the app goes SaaS and needs a plugin system, migrating to class buses is a refactor (handler signatures stay the same), not a rewrite

**Alternatives considered:**
1. Full CommandBus/QueryBus classes — more ceremony for 12 handlers, no practical benefit at current scale
2. Direct function calls (no dispatch) — couples MCP tools to handlers, no middleware seam

---

## ADR-002: No Projectors in Phase 1

**Status:** Accepted
**Context:** The reconciled plan includes "event projectors" for `digest_view`, `post_view`, `run_view`, `subreddit_view`. However, these 4 views are live SQL views (`CREATE VIEW` statements) that query tables directly — they're always up to date.

**Decision:** Defer projectors. Commands write to tables, queries read from live SQL views. Events are persisted for audit and async triggering only — they do not update read models.

**Rationale:**
- Live SQL views need no update mechanism — they're query aliases
- Projectors only make sense with materialized views that must be rebuilt
- "CQRS without event sourcing" means events are not the source of truth for read models

**Revisit when:** Phase 4 full-text search may require materialized views with tsvector columns. Projectors would be introduced then with different constraints.

---

## ADR-003: Event Map + Derived Discriminated Union

**Status:** Accepted
**Context:** Events need to be type-safe at emit, subscribe, and DB serialization boundaries. Multiple TypeScript patterns exist: hand-written discriminated unions, generic event classes, event map interfaces, branded types.

**Decision:** Use an event map interface (`DomainEventMap`) as the single source of truth. Derive the discriminated union via mapped types. Wrap EventEmitter with typed `emit`/`on`/`off` using the map. Use Zod `z.discriminatedUnion` with `satisfies Record<DomainEventType, z.ZodType>` for DB deserialization.

**Rationale:**
- One touch point to add a new event (the map). Union, bus typing, and Zod schemas all derive from it.
- Typed emit/subscribe — `bus.on('DigestRequested', handler)` gets full payload inference.
- Exhaustive switch — the derived union still narrows on `event.type`.
- Community-converged pattern: `typed-emitter`, `strict-event-emitter-types`, and Oskar Dudycz's event-driven.io examples all use this approach.
- Composition over inheritance (private EventEmitter) prevents callers from using untyped `.emit(string)`.

**The two `as` casts** in the bus wrapper (`on`/`off` methods) are unavoidable due to EventEmitter's function parameter contravariance in strict mode — same pattern `typed-emitter` uses.

**Alternatives considered:**
1. Hand-written discriminated union — 3 touch points per new event (type, union, Zod schema)
2. Generic `Event<TType, TPayload>` classes — NestJS pattern, class-heavy, makes serialization harder
3. `ts-bus` factory pattern — overkill for 9 events, adds ceremony

---

## Architecture

### Data Flow

```
MCP Tool
  → execute('GenerateDigest', params, ctx)
    → $transaction begins
      → handler(params, ctx)        — writes to tables, returns {data, event}
      → persistEvent(tx, event)     — appends to events table
    → $transaction commits
    → eventBus.emit(event)          — after commit, listeners react
    → return data                   — to MCP tool for response envelope

MCP Tool
  → query('GetDigest', params, ctx)
    → handler(params, ctx)          — reads from SQL views
    → return data                   — to MCP tool for response envelope
```

### File Structure

```
packages/core/src/
├── commands/
│   ├── types.ts          — CommandMap, CommandResultMap, CommandEventMap, derived union
│   └── dispatch.ts       — execute() function with transaction + event persistence
├── queries/
│   ├── types.ts          — QueryMap, QueryResultMap, derived union
│   └── dispatch.ts       — query() function
├── events/
│   ├── types.ts          — DomainEventMap, derived DomainEvent union, envelope fields
│   ├── bus.ts            — DomainEventBus (typed EventEmitter wrapper)
│   ├── persist.ts        — persistEvent() for DB writes
│   └── schemas.ts        — Zod schemas for DB deserialization
├── handlers/
│   ├── commands/         — one file per handler (Sprint 4)
│   └── queries/          — one file per handler (Sprint 4)
├── context.ts            — HandlerContext type
├── errors.ts             — existing error code registry
└── index.ts              — public API exports
```

---

## Type Maps

### CommandMap

```typescript
export interface CommandMap {
  GenerateDigest:   { subredditIds?: string[]; lookbackHours?: number };
  AddSubreddit:     { name: string; displayName: string; insightPrompt?: string; maxPosts?: number; nsfw?: boolean };
  RemoveSubreddit:  { subredditId: string };
  UpdateSubreddit:  { subredditId: string; insightPrompt?: string; maxPosts?: number; active?: boolean };
  UpdateConfig:     { globalInsightPrompt?: string; defaultLookbackHours?: number; llmProvider?: string; llmModel?: string };
}

export interface CommandResultMap {
  GenerateDigest:   { jobId: string; status: string };
  AddSubreddit:     { subredditId: string };
  RemoveSubreddit:  { success: true };
  UpdateSubreddit:  { subredditId: string };
  UpdateConfig:     { success: true };
}

export interface CommandEventMap {
  GenerateDigest:   'DigestRequested';
  AddSubreddit:     'SubredditAdded';
  RemoveSubreddit:  'SubredditRemoved';
  UpdateSubreddit:  never;  // no event for settings tweak
  UpdateConfig:     'ConfigUpdated';
}
```

### QueryMap

```typescript
export interface QueryMap {
  GetDigest:        { digestId: string };
  GetPost:          { postId: string };
  GetRunStatus:     { jobId: string };
  ListDigests:      { limit?: number };
  ListRuns:         { limit?: number };
  ListSubreddits:   {};
  GetConfig:        {};
  SearchPosts:      { query: string; limit?: number };
  SearchDigests:    { query: string; limit?: number };
}
```

Query result types will reference Prisma-generated types from `@redgest/db` — defined when implementing handlers in Sprint 4.

### DomainEventMap

```typescript
export interface DomainEventMap {
  DigestRequested:    { jobId: string; subredditIds: string[] };
  DigestCompleted:    { jobId: string; digestId: string };
  DigestFailed:       { jobId: string; error: string };
  PostsFetched:       { jobId: string; subreddit: string; count: number };
  PostsTriaged:       { jobId: string; subreddit: string; selectedCount: number };
  PostsSummarized:    { jobId: string; subreddit: string; summaryCount: number };
  SubredditAdded:     { subredditId: string; name: string };
  SubredditRemoved:   { subredditId: string; name: string };
  ConfigUpdated:      { changes: Record<string, unknown> };
}
```

---

## Derived Unions

All three follow the same mapped-type pattern:

```typescript
// Commands
export type CommandType = keyof CommandMap;
export type Command = {
  [K in CommandType]: { type: K; params: CommandMap[K] };
}[CommandType];

// Queries
export type QueryType = keyof QueryMap;
export type Query = {
  [K in QueryType]: { type: K; params: QueryMap[K] };
}[QueryType];

// Events — includes envelope fields
export type DomainEventType = keyof DomainEventMap;
export type DomainEvent = {
  [K in DomainEventType]: {
    type: K;
    payload: DomainEventMap[K];
    id: string;
    aggregateId: string;
    aggregateType: string;
    version: number;
    correlationId: string | null;
    causationId: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
  };
}[DomainEventType];
```

---

## Dispatch Functions

### execute() — Command Dispatch

```typescript
type CommandHandler<K extends CommandType> = (
  params: CommandMap[K],
  ctx: HandlerContext
) => Promise<{
  data: CommandResultMap[K];
  event: CommandEventMap[K] extends never
    ? null
    : DomainEventMap[CommandEventMap[K] & DomainEventType];
}>;

async function execute<K extends CommandType>(
  type: K,
  params: CommandMap[K],
  ctx: HandlerContext
): Promise<CommandResultMap[K]> {
  const handler = commandHandlers[type];

  let data: CommandResultMap[K];
  let event: DomainEvent | null = null;

  await ctx.db.$transaction(async (tx) => {
    const result = await handler(params, { ...ctx, db: tx });
    data = result.data;

    if (result.event) {
      const fullEvent = buildEventEnvelope(type, result.event);
      await persistEvent(tx, fullEvent);
      event = fullEvent;
    }
  });

  // Emit AFTER transaction commits
  if (event) {
    ctx.eventBus.emit(event.type, event);
  }

  return data!;
}
```

### query() — Query Dispatch

```typescript
type QueryHandler<K extends QueryType> = (
  params: QueryMap[K],
  ctx: HandlerContext
) => Promise<QueryResultMap[K]>;

async function query<K extends QueryType>(
  type: K,
  params: QueryMap[K],
  ctx: HandlerContext
): Promise<QueryResultMap[K]> {
  const handler = queryHandlers[type];
  return handler(params, ctx);
}
```

---

## DomainEventBus

```typescript
export class DomainEventBus {
  private emitter = new EventEmitter();

  emit<K extends DomainEventType>(
    type: K,
    event: DomainEvent & { type: K }
  ): void {
    this.emitter.emit(type, event);
  }

  on<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>
  ): void {
    this.emitter.on(type, handler as (...args: unknown[]) => void);
  }

  off<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>
  ): void {
    this.emitter.off(type, handler as (...args: unknown[]) => void);
  }
}
```

Composition over inheritance — private emitter prevents untyped access.

---

## Event Persistence

```typescript
async function persistEvent(
  tx: TransactionClient,
  event: DomainEvent
): Promise<void> {
  await tx.event.create({
    data: {
      id: event.id,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      type: event.type,
      version: event.version,
      payload: event.payload as Prisma.InputJsonValue,
      metadata: event.metadata as Prisma.InputJsonValue,
      correlationId: event.correlationId,
      causationId: event.causationId,
    },
  });
}
```

Called inside `$transaction` by `execute()` — atomic with command writes.

---

## Zod Schemas for DB Deserialization

```typescript
const eventPayloadSchemas = {
  DigestRequested: z.object({ jobId: z.string(), subredditIds: z.array(z.string()) }),
  DigestCompleted: z.object({ jobId: z.string(), digestId: z.string() }),
  DigestFailed: z.object({ jobId: z.string(), error: z.string() }),
  // ... one per event
} as const satisfies Record<DomainEventType, z.ZodType>;
```

The `satisfies` ensures the schema map stays in sync with `DomainEventMap` at compile time — adding an event to the map without a Zod schema is a compile error.

---

## HandlerContext

```typescript
export type HandlerContext = {
  db: PrismaClient | TransactionClient;
  eventBus: DomainEventBus;
  config: RedgestConfig;
};
```

Handlers receive this from the dispatch function. `PrismaClient | TransactionClient` means handlers work identically in both transactional (commands) and non-transactional (queries) contexts. Tests pass a mock context.

---

## TD-001 Resolution: insightNotes Type Mismatch

**Problem:** `insightNotes` is `z.array(z.string())` in Zod but `String @db.Text` in Prisma.

**Decision:** Change Zod to `z.string()`. Prisma stays as-is.

**Rationale:**
- The array structure is an LLM output detail, not a domain concept
- Downstream consumers (digest markdown, email, Slack) render it as prose
- Single string is full-text searchable in Phase 4
- No lossy join/split boundary

**Changes:**
- `packages/llm/src/schemas.ts` — `insightNotes: z.string().describe("Specific, actionable connections to user interests. Cite details from the post. Separate distinct notes with blank lines.")`
- `packages/llm/src/__tests__/schemas.test.ts` — update test values from arrays to strings

---

## Token Bucket Rate Limiter (WS4)

Standalone module in `packages/reddit/src/rate-limiter.ts`:

- Token bucket: 60 tokens capacity, refill 1 token/sec
- `acquire(): Promise<void>` — resolves when a token is available, blocks (via queue) if exhausted
- `sync(remaining: number, resetSeconds: number)` — called after each Reddit response to sync with `X-Ratelimit-Remaining` and `X-Ratelimit-Reset` headers
- `RedditClient` calls `acquire()` before each request

---

## Sprint 3 Scope

Infrastructure only — delivered as types, dispatch functions, event bus, and handler signatures:

| Deliverable | Points | Notes |
|---|---|---|
| Type maps (CommandMap, QueryMap, DomainEventMap) + derived unions | 1.0 | Domain models task |
| execute() with transaction + auto-persist | 1.0 | Command bus task |
| query() dispatch | 1.0 | Query bus task |
| DomainEventBus + persistEvent + Zod schemas | 1.0 | Event bus task |
| Token bucket rate limiter | 0.5 | WS4, standalone |
| TD-001: insightNotes Zod → string | 0.5 | Debt item |

Handler implementations (the actual SQL, business logic) are Sprint 4.
