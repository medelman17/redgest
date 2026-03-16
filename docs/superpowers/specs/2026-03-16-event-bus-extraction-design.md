# Event Bus Extraction — Design Spec

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Extract the in-process `DomainEventBus` into a transport-agnostic `EventBus` interface with three pluggable implementations: in-process (EventEmitter), Postgres NOTIFY/LISTEN, and Redis pub/sub.

**Motivation:** The current `DomainEventBus` is a typed EventEmitter wrapper that only works within a single process. As services split (MCP server, web app, worker), cross-process event delivery becomes necessary. A pluggable transport layer lets each deployment choose the right backend without changing application code.

**Non-goals:**
- Event sourcing or replay — events are already persisted to the `events` table by `persistEvent()`. The bus is notification-only.
- Guaranteed delivery — all transports are fire-and-forget. The DB is the durable record.
- Changing event semantics — same 16 event types, same payloads, same persist-then-notify flow.

---

## 1. EventBus Interface

```typescript
// packages/core/src/events/bus.ts

export interface EventBus {
  /**
   * Publish a domain event to all subscribers.
   * Async to support external transports (PG NOTIFY, Redis PUBLISH).
   * Called AFTER persistEvent() — this is notification only.
   */
  publish(event: DomainEvent): Promise<void>;

  /**
   * Subscribe to events of a specific type.
   * Handler may be sync or async — errors are logged, not propagated.
   */
  subscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void;

  /**
   * Remove a previously registered handler.
   */
  unsubscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void;

  /**
   * Tear down connections and listeners.
   * Called during graceful shutdown.
   */
  close(): Promise<void>;
}
```

### Method Mapping from Current API

| Current (`DomainEventBus`) | New (`EventBus`) | Change |
|---|---|---|
| `emitEvent(event): void` | `publish(event): Promise<void>` | Async, renamed |
| `emit<K>(type, event): void` | (removed) | Unused in codebase |
| `on<K>(type, handler): void` | `subscribe<K>(type, handler): void` | Renamed |
| `off<K>(type, handler): void` | `unsubscribe<K>(type, handler): void` | Renamed |
| (none) | `close(): Promise<void>` | New — cleanup |

### Backward Compatibility

`DomainEventBus` is retired. All references change to `EventBus`. This is a clean break — no re-export shim needed since every consumer is internal to the monorepo.

---

## 2. Transport Implementations

### 2.1 InProcessEventBus

**File:** `packages/core/src/events/transports/in-process.ts`

Wraps Node.js `EventEmitter`. Identical behavior to current `DomainEventBus`. Default transport.

- `publish()` — Calls `emitter.emit(event.type, event)`. Returns resolved promise (sync under the hood).
- `subscribe()` — Calls `emitter.on(type, handler)`.
- `unsubscribe()` — Calls `emitter.off(type, handler)`.
- `close()` — Calls `emitter.removeAllListeners()`. Returns resolved promise.

No serialization needed — events stay as JS objects in-process.

### 2.2 PgNotifyEventBus

**File:** `packages/core/src/events/transports/pg-notify.ts`

Uses Postgres NOTIFY/LISTEN for cross-process event delivery. Zero new infrastructure — reuses the existing Postgres instance.

**Channel naming:** Per event type — `redgest:DigestRequested`, `redgest:CrawlCompleted`, etc. Postgres routes notifications only to connections listening on the matching channel, so filtering is server-side.

**Publishing:**
- Uses a connection from the existing `pg.Pool` (short-lived, returned to pool after NOTIFY).
- `NOTIFY "redgest:<type>", '<serialized JSON>'`
- PG NOTIFY payload limit is ~8000 bytes. Our event payloads are typically <500 bytes — well within limits.

**Subscribing:**
- Creates a **dedicated `pg.Client`** (not from the pool) for LISTEN. This connection must stay alive for the process lifetime since pooled connections would lose their LISTEN registrations when returned.
- On `notification` event, deserializes JSON and dispatches to local handlers.
- Auto-reconnects on connection loss with exponential backoff.

**Serialization:**
- `Date` → ISO 8601 string on publish, string → `Date` on receive.
- Uses shared `serializeEvent()` / `deserializeEvent()` from `serialization.ts`.

**Dependencies:** `pg` — already a transitive dependency via `@prisma/adapter-pg`. Import `pg.Client` and `pg.Pool` types directly.

**Configuration:**
- Uses `DATABASE_URL` (already available).
- Accepts optional `Pool` instance to share with Prisma's adapter.

### 2.3 RedisEventBus

**File:** `packages/core/src/events/transports/redis.ts`

Uses Redis PUBLISH/SUBSCRIBE for cross-process event delivery. Higher throughput than PG NOTIFY, but requires Redis infrastructure.

**Channel naming:** Same pattern — `redgest:DigestRequested`, etc.

**Publishing:**
- Dedicated `ioredis` publisher connection.
- `PUBLISH redgest:<type> <serialized JSON>`

**Subscribing:**
- Dedicated `ioredis` subscriber connection (Redis requires separate connections for pub/sub mode vs normal commands).
- On `message` event, deserializes JSON and dispatches to local handlers.
- `ioredis` handles reconnection automatically.

**Serialization:** Same `serializeEvent()` / `deserializeEvent()` as PG transport.

**Dependencies:** `ioredis` added to `packages/core/package.json`. Loaded dynamically (only imported when `EVENT_BUS_TRANSPORT=redis`) to keep it optional for deployments that don't use Redis.

**Configuration:**
- Uses `REDIS_URL` (already defined in `@redgest/config` as optional).

---

## 3. Event Serialization

**File:** `packages/core/src/events/serialization.ts`

Shared by PG and Redis transports. Handles the `Date` ↔ ISO string roundtrip.

```typescript
export function serializeEvent(event: DomainEvent): string {
  return JSON.stringify(event, (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    return value;
  });
}

export function deserializeEvent(json: string): DomainEvent {
  return JSON.parse(json, (key, value) => {
    if (key === "occurredAt" && typeof value === "string") return new Date(value);
    return value;
  });
}
```

Only `occurredAt` is a `Date` field. All other fields are strings, numbers, or plain objects.

---

## 4. Factory

**File:** `packages/core/src/events/factory.ts`

```typescript
export type EventBusTransport = "memory" | "pg-notify" | "redis";

export interface EventBusOptions {
  transport?: EventBusTransport;
  /** pg.Pool instance for pg-notify transport (shares connection pool with Prisma) */
  pgPool?: import("pg").Pool;
  /** Redis URL for redis transport */
  redisUrl?: string;
  /** Database URL for pg-notify transport (used if pgPool not provided) */
  databaseUrl?: string;
}

export async function createEventBus(options?: EventBusOptions): Promise<EventBus> {
  const transport = options?.transport ?? "memory";

  switch (transport) {
    case "memory": {
      const { InProcessEventBus } = await import("./transports/in-process.js");
      return new InProcessEventBus();
    }
    case "pg-notify": {
      const { PgNotifyEventBus } = await import("./transports/pg-notify.js");
      return PgNotifyEventBus.create(options?.pgPool, options?.databaseUrl);
    }
    case "redis": {
      const { RedisEventBus } = await import("./transports/redis.js");
      return RedisEventBus.create(options?.redisUrl);
    }
  }
}
```

Dynamic imports keep PG and Redis dependencies lazy — they're only loaded when the transport is selected.

**Config integration:** `EVENT_BUS_TRANSPORT` env var added to `@redgest/config` schema (optional, default `"memory"`). Bootstrap sites read it to select transport.

---

## 5. Consumer Updates

### 5.1 Type References

All occurrences of `DomainEventBus` change to `EventBus`:

| File | Field |
|---|---|
| `packages/core/src/context.ts` | `HandlerContext.eventBus` |
| `packages/core/src/pipeline/types.ts` | `PipelineDeps.eventBus` |
| `packages/core/src/crawl-pipeline.ts` | `CrawlDeps.eventBus` |
| `packages/core/src/digest-dispatch.ts` | `DigestDispatchDeps.eventBus` |
| `packages/core/src/crawl-dispatch.ts` | `CrawlDispatchDeps.eventBus` |
| `packages/core/src/events/emit.ts` | `emitDomainEvent()` param |

### 5.2 Async Publish

Two call sites change from sync to async:

**`commands/dispatch.ts`** (line ~135):
```typescript
// Before:
ctx.eventBus.emitEvent(eventPayload);
// After:
await ctx.eventBus.publish(eventPayload);
```

**`events/emit.ts`** (line ~42):
```typescript
// Before:
eventBus.emitEvent(event);
// After:
await eventBus.publish(event);
```

Both are already in async functions — adding `await` is the only change.

### 5.3 Subscribe Rename

**`digest-dispatch.ts`:**
```typescript
// Before:
eventBus.on("DigestRequested", async (event) => { ... });
// After:
eventBus.subscribe("DigestRequested", async (event) => { ... });
```

Same pattern for all `eventBus.on()` calls in `digest-dispatch.ts` and `crawl-dispatch.ts`.

### 5.4 Bootstrap Sites

**`mcp-server/bootstrap.ts`:**
```typescript
// Before:
const eventBus = new DomainEventBus();
// After:
const eventBus = await createEventBus({
  transport: (config.EVENT_BUS_TRANSPORT ?? "memory") as EventBusTransport,
  databaseUrl: config.DATABASE_URL,
  redisUrl: config.REDIS_URL,
});
```

**`apps/web/lib/dal.ts`:** Same change in `getInfra()`.

### 5.5 Graceful Shutdown

Bootstrap sites should call `eventBus.close()` on process exit. MCP server's HTTP entry already has a shutdown hook — add `eventBus.close()` there. Web DAL doesn't need it (Next.js manages process lifecycle).

### 5.6 Exports

`packages/core/src/index.ts` changes:
- Remove: `export { DomainEventBus } from "./events/bus.js"`
- Add: `export { type EventBus } from "./events/bus.js"`
- Add: `export { createEventBus, type EventBusTransport, type EventBusOptions } from "./events/factory.js"`

---

## 6. Config Changes

Add to `@redgest/config` Zod schema:

```typescript
EVENT_BUS_TRANSPORT: z.enum(["memory", "pg-notify", "redis"]).optional().default("memory"),
```

`DATABASE_URL` and `REDIS_URL` are already in the schema.

---

## 7. File Structure Summary

```
packages/core/src/events/
├── types.ts                         # Unchanged
├── bus.ts                           # EventBus interface (was DomainEventBus class)
├── transports/
│   ├── in-process.ts                # InProcessEventBus (EventEmitter wrapper)
│   ├── pg-notify.ts                 # PgNotifyEventBus (NOTIFY/LISTEN)
│   └── redis.ts                     # RedisEventBus (PUBLISH/SUBSCRIBE)
├── serialization.ts                 # serializeEvent / deserializeEvent
├── factory.ts                       # createEventBus()
├── persist.ts                       # Unchanged
├── emit.ts                          # Updated: await publish()
└── schemas.ts                       # Unchanged
```

---

## 8. Testing Strategy

### 8.1 Interface Compliance Tests

Shared test suite that validates any `EventBus` implementation:

- Publish event → subscriber receives it
- Multiple subscribers on same type → all receive
- Unsubscribe → no longer receives
- Subscribe to type A, publish type B → A handler not called
- Publish with no subscribers → no error
- Close → cleans up (no further events delivered)

Run against all three implementations.

### 8.2 Transport-Specific Tests

**InProcessEventBus:**
- Unit tests, no infra required.

**PgNotifyEventBus:**
- Integration tests using Docker Compose Postgres (port 5433).
- Verify cross-connection delivery: publish from one PgNotifyEventBus instance, subscribe on another.
- Verify Date serialization roundtrip.
- Skip if `DATABASE_URL` not available.

**RedisEventBus:**
- Integration tests using Docker Compose Redis.
- Same cross-instance delivery test.
- Skip if `REDIS_URL` not available.

### 8.3 Existing Tests

All existing tests use the in-process transport by default — no changes needed. Tests that mock `DomainEventBus` update to mock `EventBus` interface instead (same shape, different name).

---

## 9. Migration Path

1. **No breaking external API changes** — MCP tools, web UI, worker tasks all work the same.
2. **Default is `memory`** — existing deployments get identical behavior without config changes.
3. **Opt-in** — set `EVENT_BUS_TRANSPORT=pg-notify` or `redis` when ready.
4. **Cross-process scenario** — when MCP server and web app run as separate processes, both set `EVENT_BUS_TRANSPORT=pg-notify` and share the same Postgres. Events published by one are received by the other.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| PG NOTIFY 8KB payload limit | Event payloads are <500 bytes. Add a size check in `serializeEvent()` that warns if approaching limit. |
| LISTEN connection drops | Auto-reconnect with exponential backoff. Log reconnection events. |
| Redis not available at runtime | Dynamic import + clear error message. Falls back to memory if import fails? No — fail fast. Config says redis, redis must be available. |
| Async publish changes error semantics | publish() errors are caught and logged by callers. Same fire-and-forget semantics as current sync emit. |
| `ioredis` adds a dependency | Optional — only loaded when transport is `redis`. Peer dependency or optional dependency in package.json. |
