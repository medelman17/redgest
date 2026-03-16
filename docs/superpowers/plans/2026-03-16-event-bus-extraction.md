# Event Bus Extraction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-process `DomainEventBus` with a transport-agnostic `EventBus` interface and three pluggable implementations (InProcess, PgNotify, Redis).

**Architecture:** Extract an `EventBus` interface from the current `DomainEventBus`. Move the EventEmitter impl to `InProcessEventBus`. Add `PgNotifyEventBus` (Postgres NOTIFY/LISTEN) and `RedisEventBus` (pub/sub). A factory function selects transport based on `EVENT_BUS_TRANSPORT` env var. All consumers updated to use the interface.

**Tech Stack:** TypeScript, Node.js EventEmitter, pg (NOTIFY/LISTEN), ioredis (pub/sub), Vitest

**Spec:** `docs/superpowers/specs/2026-03-16-event-bus-extraction-design.md`

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `packages/core/src/events/transports/in-process.ts` | `InProcessEventBus` — EventEmitter wrapper |
| `packages/core/src/events/transports/pg-notify.ts` | `PgNotifyEventBus` — Postgres NOTIFY/LISTEN |
| `packages/core/src/events/transports/redis.ts` | `RedisEventBus` — Redis PUBLISH/SUBSCRIBE |
| `packages/core/src/events/serialization.ts` | `serializeEvent()` / `deserializeEvent()` |
| `packages/core/src/events/factory.ts` | `createEventBus()` factory |
| `packages/core/src/__tests__/event-bus-compliance.test.ts` | Shared interface compliance tests |
| `packages/core/src/__tests__/serialization.test.ts` | Serialization roundtrip tests |
| `packages/core/src/__tests__/pg-notify-bus.test.ts` | PG NOTIFY integration tests |
| `packages/core/src/__tests__/redis-bus.test.ts` | Redis integration tests |

### Modified files
| File | Change |
|---|---|
| `packages/core/src/events/bus.ts` | Replace class with `EventBus` interface |
| `packages/core/src/events/emit.ts` | `await eventBus.publish()` instead of `eventBus.emitEvent()` |
| `packages/core/src/context.ts` | `EventBus` type instead of `DomainEventBus` |
| `packages/core/src/pipeline/types.ts` | `EventBus` type instead of `DomainEventBus` |
| `packages/core/src/pipeline/orchestrator.ts` | `EventBus` import instead of `DomainEventBus` |
| `packages/core/src/crawl-pipeline.ts` | `EventBus` type and import |
| `packages/core/src/digest-dispatch.ts` | `EventBus` type, `subscribe()` instead of `on()` |
| `packages/core/src/crawl-dispatch.ts` | `EventBus` type, `subscribe()` instead of `on()` |
| `packages/core/src/commands/dispatch.ts` | `await ctx.eventBus.publish()` with try/catch |
| `packages/core/src/index.ts` | Export `EventBus`, `createEventBus` instead of `DomainEventBus` |
| `packages/config/src/schema.ts` | Add `EVENT_BUS_TRANSPORT` + cross-field validation |
| `packages/mcp-server/src/bootstrap.ts` | Use `createEventBus()` |
| `packages/mcp-server/src/http.ts` | Add `eventBus.close()` to shutdown |
| `apps/web/lib/dal.ts` | Use `createEventBus()`, `EventBus` type, `beforeExit` hook |
| `packages/core/src/__tests__/events.test.ts` | Rewrite for `InProcessEventBus` + new method names |
| `packages/core/src/__tests__/digest-dispatch.test.ts` | Update mock shape |
| `packages/core/src/__tests__/delivery-dispatch.test.ts` | Update to `InProcessEventBus` |
| `packages/core/src/__tests__/execute.test.ts` | Update to `InProcessEventBus` |
| `packages/core/src/__tests__/command-handlers.test.ts` | Update to `InProcessEventBus` |
| `packages/core/src/__tests__/query-handlers.test.ts` | Update to `InProcessEventBus` |
| `packages/core/src/__tests__/orchestrator.test.ts` | Update mock |
| `packages/mcp-server/src/__tests__/bootstrap.test.ts` | Update mock shape |
| `packages/mcp-server/src/__tests__/tools.test.ts` | Update mock shape |
| `packages/mcp-server/src/__tests__/http.test.ts` | Update mock shape |
| `apps/worker/src/trigger/__tests__/generate-digest.test.ts` | Update mock shape |
| `apps/worker/src/trigger/generate-digest.ts` | Update `DomainEventBus` import |
| `apps/worker/src/trigger/crawl-subreddit.ts` | Update `DomainEventBus` import |
| `tests/integration/pipeline.test.ts` | Update to `InProcessEventBus` |

---

## Chunk 1: Interface, InProcess Transport, and Serialization

### Task 1: EventBus Interface + InProcessEventBus

**Files:**
- Modify: `packages/core/src/events/bus.ts`
- Create: `packages/core/src/events/transports/in-process.ts`
- Modify: `packages/core/src/__tests__/events.test.ts`

- [ ] **Step 1: Write the EventBus interface**

Replace the contents of `packages/core/src/events/bus.ts` with:

```typescript
import type { DomainEvent, DomainEventType } from "./types.js";

/**
 * Transport-agnostic event bus interface.
 *
 * Implementations: InProcessEventBus (EventEmitter), PgNotifyEventBus
 * (Postgres NOTIFY/LISTEN), RedisEventBus (pub/sub).
 *
 * The bus is notification-only — events are persisted to the DB by
 * persistEvent() before publish(). All transports are fire-and-forget.
 */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;

  subscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void;

  unsubscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void;

  close(): Promise<void>;
}
```

- [ ] **Step 2: Create InProcessEventBus**

Create `packages/core/src/events/transports/in-process.ts`:

```typescript
import { EventEmitter } from "node:events";
import type { DomainEvent, DomainEventType } from "../types.js";
import type { EventBus } from "../bus.js";

/**
 * In-process event bus using Node.js EventEmitter.
 * Default transport — zero dependencies, single-process only.
 */
export class InProcessEventBus implements EventBus {
  private emitter = new EventEmitter();
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  async publish(event: DomainEvent): Promise<void> {
    const handlerSet = this.handlers.get(event.type);
    if (!handlerSet || handlerSet.size === 0) {
      return;
    }
    for (const handler of handlerSet) {
      try {
        await Promise.resolve(handler(event));
      } catch (err) {
        console.warn(
          `[InProcessEventBus] Handler error for ${event.type}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  subscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    const wrapped = handler as (...args: unknown[]) => void;
    let handlerSet = this.handlers.get(type);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(type, handlerSet);
    }
    handlerSet.add(wrapped);
    this.emitter.on(type, wrapped);
  }

  unsubscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    const wrapped = handler as (...args: unknown[]) => void;
    this.handlers.get(type)?.delete(wrapped);
    this.emitter.off(type, wrapped);
  }

  async close(): Promise<void> {
    for (const [type, handlerSet] of this.handlers) {
      for (const handler of handlerSet) {
        this.emitter.off(type, handler);
      }
    }
    this.handlers.clear();
  }
}
```

- [ ] **Step 3: Rewrite events.test.ts for new API**

Replace `packages/core/src/__tests__/events.test.ts` with:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { DomainEvent, DomainEventType } from "../events/types.js";
import { InProcessEventBus } from "../events/transports/in-process.js";

describe("DomainEvent types", () => {
  it("derives correct type for DigestRequested", () => {
    const event: DomainEvent = {
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: ["sub-1"] },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };
    expect(event.type).toBe("DigestRequested");
    expect(event.payload.jobId).toBe("job-1");
  });

  it("narrows payload via type discriminant", () => {
    const event: DomainEvent = {
      type: "SubredditAdded",
      payload: { subredditId: "sub-1", name: "typescript" },
      aggregateId: "sub-1",
      aggregateType: "subreddit",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    if (event.type === "SubredditAdded") {
      expect(event.payload.name).toBe("typescript");
    }
  });

  it("DomainEventType includes all 16 event types", () => {
    const types: DomainEventType[] = [
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
      "DeliverySucceeded",
      "DeliveryFailed",
      "ProfileCreated",
      "ProfileDeleted",
      "CrawlCompleted",
      "CrawlFailed",
    ];
    expect(types).toHaveLength(16);
  });
});

describe("InProcessEventBus", () => {
  it("publish delivers to subscriber", async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();

    bus.subscribe("DigestRequested", handler);

    const event: DomainEvent & { type: "DigestRequested" } = {
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: ["sub-1"] },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    await bus.publish(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not fire handler for different event type", async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();

    bus.subscribe("DigestCompleted", handler);

    const event: DomainEvent & { type: "DigestRequested" } = {
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: [] },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    await bus.publish(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it("removes handler with unsubscribe()", async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();

    bus.subscribe("ConfigUpdated", handler);
    bus.unsubscribe("ConfigUpdated", handler);

    await bus.publish({
      type: "ConfigUpdated",
      payload: { changes: { llmModel: "gpt-4.1" } },
      aggregateId: "config-1",
      aggregateType: "config",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple subscribers all receive the event", async () => {
    const bus = new InProcessEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe("SubredditAdded", handler1);
    bus.subscribe("SubredditAdded", handler2);

    const event: DomainEvent = {
      type: "SubredditAdded",
      payload: { subredditId: "sub-1", name: "typescript" },
      aggregateId: "sub-1",
      aggregateType: "subreddit",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    await bus.publish(event);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("close() removes all registered handlers", async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();

    bus.subscribe("DigestCompleted", handler);
    await bus.close();

    await bus.publish({
      type: "DigestCompleted",
      payload: { jobId: "job-1", digestId: "dig-1" },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("publish with no subscribers does not throw", async () => {
    const bus = new InProcessEventBus();

    await expect(
      bus.publish({
        type: "DigestFailed",
        payload: { jobId: "job-1", error: "boom" },
        aggregateId: "job-1",
        aggregateType: "job",
        version: 1,
        correlationId: null,
        causationId: null,
        metadata: {},
        occurredAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/events.test.ts`
Expected: PASS — all 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/bus.ts packages/core/src/events/transports/in-process.ts packages/core/src/__tests__/events.test.ts
git commit -m "feat(core): extract EventBus interface + InProcessEventBus transport"
```

---

### Task 2: Event Serialization

**Files:**
- Create: `packages/core/src/events/serialization.ts`
- Create: `packages/core/src/__tests__/serialization.test.ts`

- [ ] **Step 1: Write the serialization test**

Create `packages/core/src/__tests__/serialization.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { serializeEvent, deserializeEvent } from "../events/serialization.js";
import type { DomainEvent } from "../events/types.js";

describe("serializeEvent / deserializeEvent", () => {
  it("roundtrips a DomainEvent with Date preservation", () => {
    const now = new Date("2026-03-16T12:00:00.000Z");
    const event: DomainEvent = {
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: ["sub-1"] },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: now,
    };

    const json = serializeEvent(event);
    const parsed = deserializeEvent(json);

    expect(parsed).toEqual(event);
    expect(parsed.occurredAt).toBeInstanceOf(Date);
    expect(parsed.occurredAt.toISOString()).toBe("2026-03-16T12:00:00.000Z");
  });

  it("serializes to valid JSON string", () => {
    const event: DomainEvent = {
      type: "SubredditAdded",
      payload: { subredditId: "sub-1", name: "typescript" },
      aggregateId: "sub-1",
      aggregateType: "subreddit",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    const json = serializeEvent(event);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('"type":"SubredditAdded"');
  });

  it("does not coerce non-ISO strings named occurredAt", () => {
    const json = JSON.stringify({
      type: "ConfigUpdated",
      payload: { changes: { occurredAt: "not-a-date" } },
      aggregateId: "config-1",
      aggregateType: "config",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: "2026-03-16T12:00:00.000Z",
    });

    const parsed = deserializeEvent(json);
    // Top-level occurredAt IS a Date
    expect(parsed.occurredAt).toBeInstanceOf(Date);
    // Nested "occurredAt" in payload stays a string (non-ISO format)
    const changes = parsed.payload as Record<string, unknown>;
    expect(changes.occurredAt).toBe("not-a-date");
  });

  it("handles events with all payload types", () => {
    const event: DomainEvent = {
      type: "CrawlCompleted",
      payload: {
        subredditId: "sub-1",
        subreddit: "typescript",
        postCount: 42,
        newPostCount: 10,
        updatedPostCount: 32,
      },
      aggregateId: "sub-1",
      aggregateType: "subreddit",
      version: 1,
      organizationId: "org-1",
      correlationId: "corr-1",
      causationId: "cause-1",
      metadata: { source: "crawl" },
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const roundtripped = deserializeEvent(serializeEvent(event));
    expect(roundtripped).toEqual(event);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/serialization.test.ts`
Expected: FAIL — cannot find module `../events/serialization.js`

- [ ] **Step 3: Implement serialization**

Create `packages/core/src/events/serialization.ts`:

```typescript
import type { DomainEvent } from "./types.js";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Serialize a DomainEvent to JSON string.
 * Converts Date objects to ISO 8601 strings.
 * Used by PgNotify and Redis transports.
 */
export function serializeEvent(event: DomainEvent): string {
  return JSON.stringify(event, (_key, value) => {
    if (value instanceof Date) return value.toISOString();
    return value;
  });
}

/**
 * Deserialize a JSON string back to a DomainEvent.
 * Restores the `occurredAt` field from ISO string to Date.
 * Only coerces values that match ISO 8601 format to avoid false positives.
 */
export function deserializeEvent(json: string): DomainEvent {
  return JSON.parse(json, (key, value) => {
    if (
      key === "occurredAt" &&
      typeof value === "string" &&
      ISO_DATE_REGEX.test(value)
    ) {
      return new Date(value);
    }
    return value;
  }) as DomainEvent;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/serialization.test.ts`
Expected: PASS — all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/serialization.ts packages/core/src/__tests__/serialization.test.ts
git commit -m "feat(core): add event serialization for external transports"
```

---

### Task 3: Factory + Config

**Files:**
- Create: `packages/core/src/events/factory.ts`
- Modify: `packages/config/src/schema.ts`

- [ ] **Step 1: Add EVENT_BUS_TRANSPORT to config schema**

In `packages/config/src/schema.ts`, add inside the `z.object({` block, after the `REDGEST_ORG_ID` line:

```typescript
  // Event bus transport
  EVENT_BUS_TRANSPORT: z.enum(["memory", "pg-notify", "redis"]).default("memory"),
```

And add a cross-field validation inside the existing `.superRefine()` callback, after the `BETTER_AUTH_SECRET` check:

```typescript
  if (data.EVENT_BUS_TRANSPORT === "redis" && !data.REDIS_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "REDIS_URL is required when EVENT_BUS_TRANSPORT is 'redis'",
      path: ["REDIS_URL"],
    });
  }
```

- [ ] **Step 2: Create the factory**

Create `packages/core/src/events/factory.ts`:

```typescript
import type { EventBus } from "./bus.js";

export type EventBusTransport = "memory" | "pg-notify" | "redis";

export interface EventBusOptions {
  transport?: EventBusTransport;
  /** pg.Pool instance for pg-notify transport (shares connection pool with Prisma). */
  pgPool?: import("pg").Pool;
  /** Redis URL for redis transport. */
  redisUrl?: string;
  /** Database URL for pg-notify transport (used if pgPool not provided). */
  databaseUrl?: string;
}

/**
 * Create an EventBus instance for the specified transport.
 * Dynamic imports keep PG and Redis dependencies lazy.
 */
export async function createEventBus(
  options?: EventBusOptions,
): Promise<EventBus> {
  const transport = options?.transport ?? "memory";

  switch (transport) {
    case "memory": {
      const { InProcessEventBus } = await import(
        "./transports/in-process.js"
      );
      return new InProcessEventBus();
    }
    case "pg-notify": {
      const { PgNotifyEventBus } = await import(
        "./transports/pg-notify.js"
      );
      return PgNotifyEventBus.create(options?.pgPool, options?.databaseUrl);
    }
    case "redis": {
      const { RedisEventBus } = await import("./transports/redis.js");
      return RedisEventBus.create(options?.redisUrl);
    }
    default: {
      const _exhaustive: never = transport;
      throw new Error(`Unknown event bus transport: ${String(_exhaustive)}`);
    }
  }
}
```

- [ ] **Step 3: Add config cross-field validation test**

In `packages/config/src/__tests__/config.test.ts` (or wherever config tests live), add a test:

```typescript
it("fails when EVENT_BUS_TRANSPORT=redis without REDIS_URL", () => {
  const result = configSchema.safeParse({
    DATABASE_URL: "postgresql://localhost:5433/redgest",
    EVENT_BUS_TRANSPORT: "redis",
    // no REDIS_URL
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 4: Run config tests**

Run: `pnpm --filter @redgest/config exec vitest run`
Expected: PASS (existing tests + new validation test pass)

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/__tests__/ packages/core/src/events/factory.ts
git commit -m "feat(core,config): add createEventBus factory + EVENT_BUS_TRANSPORT config"
```

---

## Chunk 2: Consumer Updates (Core Package)

### Task 4: Update Core Type References

**Files:**
- Modify: `packages/core/src/context.ts`
- Modify: `packages/core/src/pipeline/types.ts`
- Modify: `packages/core/src/pipeline/orchestrator.ts`
- Modify: `packages/core/src/crawl-pipeline.ts`
- Modify: `packages/core/src/digest-dispatch.ts`
- Modify: `packages/core/src/crawl-dispatch.ts`
- Modify: `packages/core/src/events/emit.ts`
- Modify: `packages/core/src/commands/dispatch.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update context.ts**

In `packages/core/src/context.ts`, change:
```typescript
import type { DomainEventBus } from "./events/bus.js";
```
to:
```typescript
import type { EventBus } from "./events/bus.js";
```

And change the `eventBus` field type:
```typescript
  eventBus: DomainEventBus;
```
to:
```typescript
  eventBus: EventBus;
```

- [ ] **Step 2: Update pipeline/types.ts**

In `packages/core/src/pipeline/types.ts`, change:
```typescript
import type { DomainEventBus } from "../events/bus.js";
```
to:
```typescript
import type { EventBus } from "../events/bus.js";
```

And change line 91:
```typescript
  eventBus: DomainEventBus;
```
to:
```typescript
  eventBus: EventBus;
```

- [ ] **Step 3: Update pipeline/orchestrator.ts**

In `packages/core/src/pipeline/orchestrator.ts`, change:
```typescript
import type { DomainEventBus } from "../events/bus.js";
```
to:
```typescript
import type { EventBus } from "../events/bus.js";
```

And update the `runPipelineBody` function signature (line ~139):
```typescript
  eventBus: DomainEventBus,
```
to:
```typescript
  eventBus: EventBus,
```

- [ ] **Step 4: Update crawl-pipeline.ts**

In `packages/core/src/crawl-pipeline.ts`, change:
```typescript
import type { DomainEventBus } from "./events/bus.js";
```
to:
```typescript
import type { EventBus } from "./events/bus.js";
```

And change the `CrawlDeps` interface:
```typescript
  eventBus: DomainEventBus;
```
to:
```typescript
  eventBus: EventBus;
```

- [ ] **Step 5: Update digest-dispatch.ts**

In `packages/core/src/digest-dispatch.ts`, change:
```typescript
import type { DomainEventBus } from "./events/bus.js";
```
to:
```typescript
import type { EventBus } from "./events/bus.js";
```

Change the `DigestDispatchDeps` interface:
```typescript
  eventBus: DomainEventBus;
```
to:
```typescript
  eventBus: EventBus;
```

Change all `eventBus.on(` to `eventBus.subscribe(`:
- Line ~58: `eventBus.on("DigestRequested",` → `eventBus.subscribe("DigestRequested",`
- Line ~80: `eventBus.on("DigestCompleted",` → `eventBus.subscribe("DigestCompleted",`

- [ ] **Step 6: Update crawl-dispatch.ts**

In `packages/core/src/crawl-dispatch.ts`, change:
```typescript
import type { DomainEventBus } from "./events/bus.js";
```
to:
```typescript
import type { EventBus } from "./events/bus.js";
```

Change the `CrawlDispatchDeps` interface:
```typescript
  eventBus: DomainEventBus;
```
to:
```typescript
  eventBus: EventBus;
```

Change line ~30:
```typescript
  eventBus.on("SubredditAdded",
```
to:
```typescript
  eventBus.subscribe("SubredditAdded",
```

- [ ] **Step 7: Update events/emit.ts**

In `packages/core/src/events/emit.ts`, change:
```typescript
import type { DomainEventBus } from "./bus.js";
```
to:
```typescript
import type { EventBus } from "./bus.js";
```

Change the `eventBus` parameter type:
```typescript
  eventBus: DomainEventBus,
```
to:
```typescript
  eventBus: EventBus,
```

Change the emit call (line ~42):
```typescript
  eventBus.emitEvent(event);
```
to:
```typescript
  await eventBus.publish(event);
```

- [ ] **Step 8: Update commands/dispatch.ts**

In `packages/core/src/commands/dispatch.ts`, the `ExecuteContext` type already references `HandlerContext["eventBus"]` which will pick up the new `EventBus` type automatically.

Change the emit-after-commit block (lines ~134-137):
```typescript
    // Emit AFTER transaction commits
    if (eventPayload) {
      ctx.eventBus.emitEvent(eventPayload);
    }
```
to:
```typescript
    // Emit AFTER transaction commits — best-effort notification
    if (eventPayload) {
      try {
        await ctx.eventBus.publish(eventPayload);
      } catch (err) {
        console.warn(
          `[execute] Event publish failed for ${eventPayload.type}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
```

- [ ] **Step 9: Update index.ts exports**

In `packages/core/src/index.ts`, change:
```typescript
export { DomainEventBus } from "./events/bus.js";
```
to:
```typescript
export type { EventBus } from "./events/bus.js";
export { InProcessEventBus } from "./events/transports/in-process.js";
export {
  createEventBus,
  type EventBusTransport,
  type EventBusOptions,
} from "./events/factory.js";
```

- [ ] **Step 10: Run typecheck**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: Type errors from test files (that's OK — we fix those next). Core source files should have no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/pipeline/types.ts packages/core/src/pipeline/orchestrator.ts packages/core/src/crawl-pipeline.ts packages/core/src/digest-dispatch.ts packages/core/src/crawl-dispatch.ts packages/core/src/events/emit.ts packages/core/src/commands/dispatch.ts packages/core/src/index.ts
git commit -m "refactor(core): update all consumers from DomainEventBus to EventBus interface"
```

---

### Task 5: Update Core Test Files

**Files:**
- Modify: `packages/core/src/__tests__/digest-dispatch.test.ts`
- Modify: `packages/core/src/__tests__/delivery-dispatch.test.ts`
- Modify: `packages/core/src/__tests__/execute.test.ts`
- Modify: `packages/core/src/__tests__/command-handlers.test.ts`
- Modify: `packages/core/src/__tests__/query-handlers.test.ts`
- Modify: `packages/core/src/__tests__/orchestrator.test.ts`
- Modify: `tests/integration/pipeline.test.ts`

- [ ] **Step 1: Update digest-dispatch.test.ts**

In `packages/core/src/__tests__/digest-dispatch.test.ts`:

Change import:
```typescript
import type { DomainEventBus } from "../events/bus.js";
```
to:
```typescript
import type { EventBus } from "../events/bus.js";
```

Change mock creation in `createMockDeps()` — replace the `mockEventBus` block:
```typescript
  const mockEventBus = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    }),
    off: vi.fn(),
    emit: vi.fn(),
    emitEvent: vi.fn(),
  } as unknown as DomainEventBus;
```
with:
```typescript
  const mockEventBus = {
    subscribe: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    }),
    unsubscribe: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as EventBus;
```

Update assertion in the "registers a DigestRequested handler" test:
```typescript
    expect(mockEventBus.on).toHaveBeenCalledWith(
```
to:
```typescript
    expect(mockEventBus.subscribe).toHaveBeenCalledWith(
```

- [ ] **Step 2: Update tests that use `new DomainEventBus()`**

For each of these files, change:
- `import { DomainEventBus } from "../events/bus.js"` → `import { InProcessEventBus } from "../events/transports/in-process.js"`
- `new DomainEventBus()` → `new InProcessEventBus()`

Files to update:
- `packages/core/src/__tests__/execute.test.ts`
- `packages/core/src/__tests__/command-handlers.test.ts`
- `packages/core/src/__tests__/query-handlers.test.ts`
- `packages/core/src/__tests__/delivery-dispatch.test.ts`
- `tests/integration/pipeline.test.ts`

For `delivery-dispatch.test.ts`, also:
- Change `vi.spyOn(eventBus, "on")` → `vi.spyOn(eventBus, "subscribe")`
- Change `vi.spyOn(eventBus, "emit")` → `vi.spyOn(eventBus, "publish")` if present
- Change all `eventBus.emit("DigestCompleted", ...)` calls → `await eventBus.publish(...)` with full event envelope (these are direct emit calls used to simulate events in tests)

- [ ] **Step 3: Update orchestrator.test.ts**

In `packages/core/src/__tests__/orchestrator.test.ts`, check if it mocks `DomainEventBus` at module level. If so, update the mock to match the new `EventBus` shape:
```typescript
{ subscribe: vi.fn(), unsubscribe: vi.fn(), publish: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }
```
And update the import if needed.

- [ ] **Step 4: Run all core tests**

Run: `pnpm --filter @redgest/core exec vitest run`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/__tests__/ tests/integration/pipeline.test.ts
git commit -m "test(core): update all test mocks from DomainEventBus to EventBus"
```

---

## Chunk 3: Consumer Updates (MCP Server, Worker, Web)

### Task 6: Update MCP Server

**Files:**
- Modify: `packages/mcp-server/src/bootstrap.ts`
- Modify: `packages/mcp-server/src/http.ts`
- Modify: `packages/mcp-server/src/__tests__/bootstrap.test.ts`
- Modify: `packages/mcp-server/src/__tests__/tools.test.ts`
- Modify: `packages/mcp-server/src/__tests__/http.test.ts`

- [ ] **Step 1: Update bootstrap.ts**

In `packages/mcp-server/src/bootstrap.ts`:

Change imports — remove `DomainEventBus`, add `createEventBus` and `type EventBusTransport`:
```typescript
import {
  DomainEventBus,
  createExecute,
  ...
```
to:
```typescript
import {
  createEventBus,
  type EventBusTransport,
  createExecute,
  ...
```

Change instantiation (line ~42):
```typescript
  const eventBus = new DomainEventBus();
```
to:
```typescript
  const eventBus = await createEventBus({
    transport: config.EVENT_BUS_TRANSPORT as EventBusTransport,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
  });
```

- [ ] **Step 2: Update http.ts shutdown**

In `packages/mcp-server/src/http.ts`, add `eventBus.close()` to the shutdown handler. The `deps` object needs to carry the eventBus. Check if `BootstrapResult` already exposes `ctx.eventBus` — it does (via `ctx: HandlerContext`).

Update the shutdown function (lines ~44-52):
```typescript
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await deps.db.$disconnect();
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(0);
  };
```
to:
```typescript
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await deps.ctx.eventBus.close();
      await deps.db.$disconnect();
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(0);
  };
```

- [ ] **Step 3: Update MCP server test mocks**

In `packages/mcp-server/src/__tests__/bootstrap.test.ts`:
- Replace the `MockDomainEventBus` class mock with a `mockCreateEventBus` function mock. The hoisted `vi.mock("@redgest/core", ...)` factory should change from exporting `DomainEventBus: vi.fn(() => mockBus)` to exporting `createEventBus: vi.fn().mockResolvedValue(mockBus)` where:
  ```typescript
  const mockBus = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  ```
- Update assertions: `expect(MockDomainEventBus).toHaveBeenCalledOnce()` → check that `createEventBus` was called with expected transport options
- Note: `createEventBus()` is async, so its mock must use `.mockResolvedValue()`, not `.mockReturnValue()`

In `packages/mcp-server/src/__tests__/tools.test.ts`:
- Change `{ on: vi.fn(), off: vi.fn(), emit: vi.fn(), emitEvent: vi.fn() }` to `{ subscribe: vi.fn(), unsubscribe: vi.fn(), publish: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }`.

In `packages/mcp-server/src/__tests__/http.test.ts`:
- Same mock shape update.

- [ ] **Step 4: Run MCP server tests**

Run: `pnpm --filter @redgest/mcp-server exec vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/bootstrap.ts packages/mcp-server/src/http.ts packages/mcp-server/src/__tests__/
git commit -m "refactor(mcp-server): use createEventBus + EventBus interface"
```

---

### Task 7: Update Worker

**Files:**
- Modify: `apps/worker/src/trigger/generate-digest.ts`
- Modify: `apps/worker/src/trigger/crawl-subreddit.ts`
- Modify: `apps/worker/src/trigger/__tests__/generate-digest.test.ts`

- [ ] **Step 1: Update worker task files**

In `apps/worker/src/trigger/generate-digest.ts` and `apps/worker/src/trigger/crawl-subreddit.ts`:
- Change `import { DomainEventBus, ... }` to `import { InProcessEventBus, ... }`
- Change `new DomainEventBus()` to `new InProcessEventBus()`

Note: Worker tasks create their own in-process event bus per task run (not shared). The factory is overkill here — `InProcessEventBus` is the correct choice since worker tasks are ephemeral.

- [ ] **Step 2: Update worker test mocks**

In `apps/worker/src/trigger/__tests__/generate-digest.test.ts`:
- Update the hoisted mock from `{ on: vi.fn(), emit: vi.fn(), emitEvent: vi.fn() }` to `{ subscribe: vi.fn(), unsubscribe: vi.fn(), publish: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }`
- The test mocks `@redgest/core` as a package (not an internal path). In the `vi.mock("@redgest/core", ...)` factory, change the exported name from `DomainEventBus` to `InProcessEventBus` as a constructor mock that returns the mock bus object. Do NOT change the mock path — it stays as `"@redgest/core"`.

- [ ] **Step 3: Run worker tests**

Run: `pnpm --filter @redgest/worker exec vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/trigger/ apps/worker/src/trigger/__tests__/
git commit -m "refactor(worker): use InProcessEventBus instead of DomainEventBus"
```

---

### Task 8: Update Web DAL

**Files:**
- Modify: `apps/web/lib/dal.ts`

- [ ] **Step 1: Update dal.ts**

In `apps/web/lib/dal.ts`:

Change imports:
```typescript
import {
  DomainEventBus,
  createExecute,
  createQuery,
  createSearchService,
  commandHandlers,
  queryHandlers,
  wireDigestDispatch,
  type HandlerContext,
  type ExecuteContext,
  type CommandMap,
  type CommandResultMap,
  type QueryResultMap,
  type SearchService,
} from "@redgest/core";
```
to:
```typescript
import {
  createEventBus,
  type EventBus,
  type EventBusTransport,
  createExecute,
  createQuery,
  createSearchService,
  commandHandlers,
  queryHandlers,
  wireDigestDispatch,
  type HandlerContext,
  type ExecuteContext,
  type CommandMap,
  type CommandResultMap,
  type QueryResultMap,
  type SearchService,
} from "@redgest/core";
```

Change the `CachedInfra` interface:
```typescript
  eventBus: DomainEventBus;
```
to:
```typescript
  eventBus: EventBus;
```

Change `getInfra()` — replace `new DomainEventBus()` (line ~47):
```typescript
  const eventBus = new DomainEventBus();
```
to:
```typescript
  const eventBus = await createEventBus({
    transport: config.EVENT_BUS_TRANSPORT as EventBusTransport,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
  });

  // Cleanup external transport connections on process exit
  process.on("beforeExit", () => void eventBus.close());
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @redgest/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/dal.ts
git commit -m "refactor(web): use createEventBus + EventBus interface in DAL"
```

---

### Task 9: Full Test Suite Verification

- [ ] **Step 1: Run all tests across the monorepo**

Run: `turbo test`
Expected: PASS — all ~685 tests pass

- [ ] **Step 2: Run typecheck across the monorepo**

Run: `pnpm typecheck`
Expected: PASS — no type errors

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit any remaining fixes**

If any tests or lint issues are found, fix them and commit.

---

## Chunk 4: PgNotify Transport

### Task 10: PgNotifyEventBus Implementation

**Files:**
- Create: `packages/core/src/events/transports/pg-notify.ts`
- Create: `packages/core/src/__tests__/pg-notify-bus.test.ts`

- [ ] **Step 1: Write the PgNotify integration test**

Create `packages/core/src/__tests__/pg-notify-bus.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import type { DomainEvent } from "../events/types.js";
import { PgNotifyEventBus } from "../events/transports/pg-notify.js";

const DATABASE_URL = process.env.DATABASE_URL;

// Skip integration tests when DB not available
const describeIf = DATABASE_URL ? describe : describe.skip;

describeIf("PgNotifyEventBus", () => {
  let pool: pg.Pool;
  let bus1: PgNotifyEventBus;
  let bus2: PgNotifyEventBus;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterEach(async () => {
    if (bus1) await bus1.close();
    if (bus2) await bus2.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  function makeEvent(
    type: "SubredditAdded",
    name: string,
  ): DomainEvent & { type: "SubredditAdded" } {
    return {
      type: "SubredditAdded",
      payload: { subredditId: `sub-${name}`, name },
      aggregateId: `sub-${name}`,
      aggregateType: "subreddit",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };
  }

  it("delivers events between two bus instances", async () => {
    bus1 = await PgNotifyEventBus.create(pool);
    bus2 = await PgNotifyEventBus.create(pool);

    const received: DomainEvent[] = [];
    bus2.subscribe("SubredditAdded", (event) => {
      received.push(event);
    });

    // Allow LISTEN to establish
    await new Promise((r) => setTimeout(r, 100));

    const event = makeEvent("SubredditAdded", "test-pg");
    await bus1.publish(event);

    // Wait for notification delivery
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("SubredditAdded");
    expect(received[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it("does not deliver events for unsubscribed types", async () => {
    bus1 = await PgNotifyEventBus.create(pool);
    bus2 = await PgNotifyEventBus.create(pool);

    const received: DomainEvent[] = [];
    bus2.subscribe("DigestCompleted", (event) => {
      received.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    await bus1.publish(makeEvent("SubredditAdded", "no-match"));

    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(0);
  });

  it("close() stops receiving events", async () => {
    bus1 = await PgNotifyEventBus.create(pool);
    bus2 = await PgNotifyEventBus.create(pool);

    const received: DomainEvent[] = [];
    bus2.subscribe("SubredditAdded", (event) => {
      received.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));
    await bus2.close();

    await bus1.publish(makeEvent("SubredditAdded", "after-close"));
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/pg-notify-bus.test.ts`
Expected: FAIL — cannot find module `../events/transports/pg-notify.js`

- [ ] **Step 3: Implement PgNotifyEventBus**

Create `packages/core/src/events/transports/pg-notify.ts`:

```typescript
import pg from "pg";
import type { DomainEvent, DomainEventType } from "../types.js";
import type { EventBus } from "../bus.js";
import { serializeEvent, deserializeEvent } from "../serialization.js";

const CHANNEL_PREFIX = "redgest:";

type Handler = (event: DomainEvent) => void | Promise<void>;

/**
 * Event bus using Postgres NOTIFY/LISTEN.
 * Zero new infrastructure — reuses the existing Postgres instance.
 *
 * Publishing uses the shared Pool. Subscribing uses a dedicated
 * pg.Client (not from the pool) to maintain persistent LISTEN registrations.
 */
export class PgNotifyEventBus implements EventBus {
  private pool: pg.Pool;
  private listener: pg.Client | null;
  private connectionString: string;
  private handlers = new Map<string, Set<Handler>>();
  private closed = false;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;

  private constructor(pool: pg.Pool, listener: pg.Client, connectionString: string) {
    this.pool = pool;
    this.listener = listener;
    this.connectionString = connectionString;
    this.setupListenerEvents(listener);
  }

  private setupListenerEvents(listener: pg.Client): void {
    listener.on("notification", (msg) => {
      if (!msg.channel.startsWith(CHANNEL_PREFIX) || !msg.payload) return;
      const type = msg.channel.slice(CHANNEL_PREFIX.length);
      const handlerSet = this.handlers.get(type);
      if (!handlerSet || handlerSet.size === 0) return;

      try {
        const event = deserializeEvent(msg.payload);
        for (const handler of handlerSet) {
          Promise.resolve(handler(event)).catch((err) => {
            console.error(
              `[PgNotifyEventBus] Handler error for ${type}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      } catch (err) {
        console.error(
          `[PgNotifyEventBus] Failed to deserialize event on ${msg.channel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    listener.on("error", (err) => {
      console.warn(
        `[PgNotifyEventBus] Listener error: ${err.message}`,
      );
      void this.reconnect();
    });

    listener.on("end", () => {
      if (!this.closed) {
        console.warn("[PgNotifyEventBus] Listener connection ended, reconnecting...");
        void this.reconnect();
      }
    });
  }

  private async reconnect(): Promise<void> {
    if (this.closed) return;
    this.listener = null;

    while (!this.closed) {
      try {
        console.info(
          `[PgNotifyEventBus] Reconnecting in ${this.reconnectDelay}ms...`,
        );
        await new Promise((r) => setTimeout(r, this.reconnectDelay));
        if (this.closed) return;

        const newListener = new pg.Client({
          connectionString: this.connectionString,
        });
        await newListener.connect();

        // Re-issue LISTEN for all active channels
        for (const type of this.handlers.keys()) {
          const channel = `${CHANNEL_PREFIX}${type}`;
          await newListener.query(`LISTEN "${channel}"`);
        }

        this.listener = newListener;
        this.setupListenerEvents(newListener);
        this.reconnectDelay = 1000; // Reset on success
        console.info("[PgNotifyEventBus] Reconnected successfully");
        return;
      } catch (err) {
        console.warn(
          `[PgNotifyEventBus] Reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
      }
    }
  }

  /**
   * Create a PgNotifyEventBus. Fallback chain for connection:
   * 1. Provided pg.Pool
   * 2. New Pool from provided databaseUrl
   * 3. New Pool from DATABASE_URL env var
   */
  static async create(
    pool?: pg.Pool,
    databaseUrl?: string,
  ): Promise<PgNotifyEventBus> {
    const connString = databaseUrl ?? process.env.DATABASE_URL;
    if (!connString) {
      throw new Error(
        "PgNotifyEventBus: No database connection available. Provide databaseUrl or set DATABASE_URL.",
      );
    }

    const resolvedPool = pool ?? new pg.Pool({ connectionString: connString });

    const listener = new pg.Client({ connectionString: connString });
    await listener.connect();

    return new PgNotifyEventBus(resolvedPool, listener, connString);
  }

  async publish(event: DomainEvent): Promise<void> {
    if (this.closed) return;
    const channel = `${CHANNEL_PREFIX}${event.type}`;
    const payload = serializeEvent(event);
    const client = await this.pool.connect();
    try {
      await client.query(`NOTIFY "${channel}", '${payload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  subscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    let handlerSet = this.handlers.get(type);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(type, handlerSet);
      // LISTEN is fire-and-forget — errors logged
      const channel = `${CHANNEL_PREFIX}${type}`;
      if (this.listener) {
        this.listener.query(`LISTEN "${channel}"`).catch((err) => {
          console.error(
            `[PgNotifyEventBus] LISTEN failed for ${channel}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    }
    handlerSet.add(handler as Handler);
  }

  unsubscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    const handlerSet = this.handlers.get(type);
    if (handlerSet) {
      handlerSet.delete(handler as Handler);
      if (handlerSet.size === 0) {
        this.handlers.delete(type);
        const channel = `${CHANNEL_PREFIX}${type}`;
        if (this.listener) {
          this.listener.query(`UNLISTEN "${channel}"`).catch(() => {});
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    try {
      if (this.listener) {
        await this.listener.query("UNLISTEN *");
        await this.listener.end();
      }
    } catch {
      // Best-effort cleanup
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/pg-notify-bus.test.ts`
Expected: PASS (if DATABASE_URL is set) or SKIP (if not)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/transports/pg-notify.ts packages/core/src/__tests__/pg-notify-bus.test.ts
git commit -m "feat(core): add PgNotifyEventBus transport (Postgres NOTIFY/LISTEN)"
```

---

## Chunk 5: Redis Transport

### Task 11: RedisEventBus Implementation

**Files:**
- Create: `packages/core/src/events/transports/redis.ts`
- Create: `packages/core/src/__tests__/redis-bus.test.ts`

- [ ] **Step 1: Install ioredis**

```bash
pnpm --filter @redgest/core add --save-optional ioredis
```

`ioredis` ships its own TypeScript definitions — no `@types/ioredis` needed.

- [ ] **Step 2: Write the Redis integration test**

Create `packages/core/src/__tests__/redis-bus.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import type { DomainEvent } from "../events/types.js";
import { RedisEventBus } from "../events/transports/redis.js";

const REDIS_URL = process.env.REDIS_URL;

const describeIf = REDIS_URL ? describe : describe.skip;

describeIf("RedisEventBus", () => {
  let bus1: RedisEventBus;
  let bus2: RedisEventBus;

  afterEach(async () => {
    if (bus1) await bus1.close();
    if (bus2) await bus2.close();
  });

  function makeEvent(
    type: "SubredditAdded",
    name: string,
  ): DomainEvent & { type: "SubredditAdded" } {
    return {
      type: "SubredditAdded",
      payload: { subredditId: `sub-${name}`, name },
      aggregateId: `sub-${name}`,
      aggregateType: "subreddit",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };
  }

  it("delivers events between two bus instances", async () => {
    bus1 = await RedisEventBus.create(REDIS_URL);
    bus2 = await RedisEventBus.create(REDIS_URL);

    const received: DomainEvent[] = [];
    bus2.subscribe("SubredditAdded", (event) => {
      received.push(event);
    });

    // Allow SUBSCRIBE to establish
    await new Promise((r) => setTimeout(r, 100));

    await bus1.publish(makeEvent("SubredditAdded", "test-redis"));

    // Wait for message delivery
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("SubredditAdded");
    expect(received[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it("close() stops receiving events", async () => {
    bus1 = await RedisEventBus.create(REDIS_URL);
    bus2 = await RedisEventBus.create(REDIS_URL);

    const received: DomainEvent[] = [];
    bus2.subscribe("SubredditAdded", (event) => {
      received.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));
    await bus2.close();

    await bus1.publish(makeEvent("SubredditAdded", "after-close"));
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Implement RedisEventBus**

Create `packages/core/src/events/transports/redis.ts`:

```typescript
import type { DomainEvent, DomainEventType } from "../types.js";
import type { EventBus } from "../bus.js";
import { serializeEvent, deserializeEvent } from "../serialization.js";

const CHANNEL_PREFIX = "redgest:";

type Handler = (event: DomainEvent) => void | Promise<void>;

/**
 * Event bus using Redis PUBLISH/SUBSCRIBE.
 * Requires two connections: one for publishing, one for subscribing
 * (Redis enters pub/sub mode on SUBSCRIBE, blocking normal commands).
 */
export class RedisEventBus implements EventBus {
  private pub: import("ioredis").default;
  private sub: import("ioredis").default;
  private handlers = new Map<string, Set<Handler>>();
  private closed = false;

  private constructor(
    pub: import("ioredis").default,
    sub: import("ioredis").default,
  ) {
    this.pub = pub;
    this.sub = sub;

    this.sub.on("message", (channel: string, message: string) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      const type = channel.slice(CHANNEL_PREFIX.length);
      const handlerSet = this.handlers.get(type);
      if (!handlerSet || handlerSet.size === 0) return;

      try {
        const event = deserializeEvent(message);
        for (const handler of handlerSet) {
          Promise.resolve(handler(event)).catch((err) => {
            console.error(
              `[RedisEventBus] Handler error for ${type}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      } catch (err) {
        console.error(
          `[RedisEventBus] Failed to deserialize event on ${channel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /**
   * Create a RedisEventBus. Uses provided URL or REDIS_URL env var.
   */
  static async create(redisUrl?: string): Promise<RedisEventBus> {
    const url = redisUrl ?? process.env.REDIS_URL;
    if (!url) {
      throw new Error(
        "RedisEventBus: No Redis URL available. Provide redisUrl or set REDIS_URL.",
      );
    }

    let Redis: typeof import("ioredis").default;
    try {
      const mod = await import("ioredis");
      Redis = mod.default;
    } catch {
      throw new Error(
        "RedisEventBus: ioredis is not installed. Install it with: pnpm add ioredis",
      );
    }

    const pub = new Redis(url);
    const sub = new Redis(url);

    return new RedisEventBus(pub, sub);
  }

  async publish(event: DomainEvent): Promise<void> {
    if (this.closed) return;
    const channel = `${CHANNEL_PREFIX}${event.type}`;
    const payload = serializeEvent(event);
    await this.pub.publish(channel, payload);
  }

  subscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    let handlerSet = this.handlers.get(type);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(type, handlerSet);
      const channel = `${CHANNEL_PREFIX}${type}`;
      this.sub.subscribe(channel).catch((err) => {
        console.error(
          `[RedisEventBus] SUBSCRIBE failed for ${channel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    handlerSet.add(handler as Handler);
  }

  unsubscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    const handlerSet = this.handlers.get(type);
    if (handlerSet) {
      handlerSet.delete(handler as Handler);
      if (handlerSet.size === 0) {
        this.handlers.delete(type);
        const channel = `${CHANNEL_PREFIX}${type}`;
        this.sub.unsubscribe(channel).catch(() => {});
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    try {
      await this.sub.unsubscribe();
      this.sub.disconnect();
      this.pub.disconnect();
    } catch {
      // Best-effort cleanup
    }
  }
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/redis-bus.test.ts`
Expected: PASS (if REDIS_URL is set) or SKIP (if not)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events/transports/redis.ts packages/core/src/__tests__/redis-bus.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): add RedisEventBus transport (Redis pub/sub)"
```

---

## Chunk 6: Final Verification + Cleanup

### Task 12: Full Verification

- [ ] **Step 1: Run the entire test suite**

Run: `turbo test`
Expected: PASS — all tests across the monorepo pass

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 4: Verify the old DomainEventBus class is fully removed**

Run: `grep -r "DomainEventBus" packages/ apps/ tests/ --include="*.ts" -l | grep -v node_modules | grep -v dist | grep -v ".test.ts" | grep -v "\.md"`

Expected: No source files (only test files or docs may reference it for historical context). If any source files still reference `DomainEventBus`, fix them.

- [ ] **Step 5: Verify no `emitEvent` or `.on(` calls remain on EventBus**

Run: `grep -rn "eventBus\.emitEvent\|eventBus\.on(" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v "\.test\."`

Expected: No matches in source files (test files may still have old patterns from mocks).

- [ ] **Step 6: Final commit if needed**

If any cleanup was needed, commit with:
```bash
git commit -m "chore: final cleanup for event bus extraction"
```

---

## Summary

| Task | Description | Estimated Size |
|---|---|---|
| 1 | EventBus interface + InProcessEventBus | Small |
| 2 | Event serialization | Small |
| 3 | Factory + config | Small |
| 4 | Core type reference updates | Medium |
| 5 | Core test updates | Medium |
| 6 | MCP server updates | Medium |
| 7 | Worker updates | Small |
| 8 | Web DAL updates | Small |
| 9 | Full test suite verification | Small |
| 10 | PgNotifyEventBus | Medium |
| 11 | RedisEventBus | Medium |
| 12 | Final verification | Small |

**Dependency order:** Tasks 1-3 are independent of each other but must complete before Task 4. Task 4 must complete before Task 5. Tasks 6-8 depend on Tasks 4-5. Task 9 depends on all previous. Tasks 10-11 can run in parallel after Tasks 1-3 (they depend on the interface, serialization, and factory). Task 12 is last.
