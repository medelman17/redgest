# Sprint 3: CQRS Core Infrastructure — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the typed dispatch infrastructure (commands, queries, events) and resolve TD-001 + add token bucket rate limiter.

**Architecture:** CQRS without event sourcing. Three type maps (`CommandMap`, `QueryMap`, `DomainEventMap`) as single sources of truth. Discriminated unions derived via mapped types. `execute()` wraps commands in Prisma `$transaction` with auto-persisted events. `query()` dispatches reads directly. See `docs/plans/2026-03-09-cqrs-core-design.md` for full design + ADRs.

**Tech Stack:** TypeScript 5.9.3 (strict, `noUncheckedIndexedAccess`), Zod 4.3.6, Prisma v7, Vitest 4.0.18, Node.js EventEmitter.

**Rules:**
- No `!` non-null assertions, no `as unknown as`, no `@ts-ignore`, no `any`, no `enum`
- `varsIgnorePattern: "^_"` for unused destructured vars
- Pre-commit hook runs `pnpm lint && pnpm typecheck && pnpm test` (54+ tests must pass)
- All new code needs tests. TDD: red → green → refactor.

---

### Task 1: TD-001 — Fix insightNotes type mismatch

**Files:**
- Modify: `packages/llm/src/schemas.ts:41-49`
- Modify: `packages/llm/src/__tests__/schemas.test.ts:55-73`

**Step 1: Update PostSummarySchema — change insightNotes from array to string**

In `packages/llm/src/schemas.ts`, replace lines 41-49:

```typescript
// BEFORE:
  insightNotes: z
    .array(
      z
        .string()
        .describe(
          "Specific, actionable connection to user interests. MUST cite detail from post.",
        ),
    )
    .describe("1-3 insight notes connecting post to user interests"),

// AFTER:
  insightNotes: z
    .string()
    .describe(
      "Specific, actionable connections to user interests. MUST cite details from the post. Separate distinct notes with blank lines.",
    ),
```

**Step 2: Update test fixture — change insightNotes from array to string**

In `packages/llm/src/__tests__/schemas.test.ts`, the `validSummary` fixture (line 62-64):

```typescript
// BEFORE:
    insightNotes: [
      "The module-level caching directly addresses the Turborepo build bottleneck mentioned in your workflow interests",
    ],

// AFTER:
    insightNotes: "The module-level caching directly addresses the Turborepo build bottleneck mentioned in your workflow interests",
```

Also update the "accepts empty arrays" test (line 97-107). Change `insightNotes: []` to `insightNotes: ""` :

```typescript
// BEFORE:
    const withEmpty = {
      ...validSummary,
      keyTakeaways: [],
      insightNotes: [],
      commentHighlights: [],
      notableLinks: [],
    };

// AFTER:
    const withEmpty = {
      ...validSummary,
      keyTakeaways: [],
      insightNotes: "",
      commentHighlights: [],
      notableLinks: [],
    };
```

**Step 3: Run tests to verify**

Run: `pnpm --filter @redgest/llm exec vitest run --exclude 'dist/**'`
Expected: 29 tests pass (12 schema + 17 prompt)

**Step 4: Run full check**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass

**Step 5: Commit**

```bash
git add packages/llm/src/schemas.ts packages/llm/src/__tests__/schemas.test.ts
git commit -m "fix(llm): change insightNotes from array to string — resolves TD-001"
```

---

### Task 2: Core package dependencies + HandlerContext + DB type exports

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/db/src/index.ts`
- Create: `packages/core/src/context.ts`
- Create: `packages/core/src/__tests__/context.test.ts`

**Step 1: Add dependencies to @redgest/core**

In `packages/core/package.json`, add a `dependencies` block:

```json
{
  "dependencies": {
    "@redgest/config": "workspace:*",
    "@redgest/db": "workspace:*",
    "zod": "^4.3.6"
  }
}
```

**Step 2: Export TransactionClient type from @redgest/db**

In `packages/db/src/index.ts`, add the TransactionClient type export:

```typescript
export { prisma } from "./client.js";
export * from "./generated/prisma/client.js";

// Transaction client type — same model accessors as PrismaClient
// but without lifecycle methods ($connect, $disconnect, etc.)
export type TransactionClient = Omit<
  import("./generated/prisma/client.js").PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
```

Note: The `import()` type expression avoids a circular re-export. If TypeScript complains, use a local import instead:

```typescript
import { PrismaClient } from "./generated/prisma/client.js";
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
// Then keep the other exports
```

**Step 3: Run pnpm install to resolve workspace deps**

Run: `pnpm install`

**Step 4: Write test for HandlerContext**

Create `packages/core/src/__tests__/context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { HandlerContext } from "../context.js";

describe("HandlerContext", () => {
  it("accepts a mock context object", () => {
    // Verifies the type compiles with a minimal mock
    const ctx: HandlerContext = {
      db: {} as HandlerContext["db"],
      eventBus: {} as HandlerContext["eventBus"],
      config: {} as HandlerContext["config"],
    };
    expect(ctx).toBeDefined();
    expect(ctx.db).toBeDefined();
    expect(ctx.eventBus).toBeDefined();
    expect(ctx.config).toBeDefined();
  });
});
```

**Step 5: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: FAIL — `../context.js` doesn't exist yet

**Step 6: Create HandlerContext**

Create `packages/core/src/context.ts`:

```typescript
import type { PrismaClient, TransactionClient } from "@redgest/db";
import type { RedgestConfig } from "@redgest/config";
import type { DomainEventBus } from "./events/bus.js";

export type DbClient = PrismaClient | TransactionClient;

export type HandlerContext = {
  db: DbClient;
  eventBus: DomainEventBus;
  config: RedgestConfig;
};
```

Note: This will not compile yet because `./events/bus.js` doesn't exist. We need a forward reference. Create a minimal placeholder:

Create `packages/core/src/events/bus.ts`:

```typescript
import { EventEmitter } from "node:events";

export class DomainEventBus {
  private emitter = new EventEmitter();
}
```

**Step 7: Run test to verify it passes**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: 6 tests pass (5 errors + 1 context)

**Step 8: Run typecheck**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: Pass (or fix any import resolution issues)

**Step 9: Commit**

```bash
git add packages/core/package.json packages/core/src/context.ts \
  packages/core/src/__tests__/context.test.ts \
  packages/core/src/events/bus.ts \
  packages/db/src/index.ts \
  pnpm-lock.yaml
git commit -m "feat(core): add HandlerContext type and DB transaction type export"
```

---

### Task 3: Event types + DomainEventBus

**Files:**
- Create: `packages/core/src/events/types.ts`
- Modify: `packages/core/src/events/bus.ts` (replace placeholder)
- Create: `packages/core/src/__tests__/events.test.ts`

**Step 1: Write failing tests for event types and bus**

Create `packages/core/src/__tests__/events.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { DomainEvent, DomainEventType, DomainEventMap } from "../events/types.js";
import { DomainEventBus } from "../events/bus.js";

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
      // TypeScript narrows payload to { subredditId: string; name: string }
      expect(event.payload.name).toBe("typescript");
    }
  });

  it("DomainEventType includes all 9 event types", () => {
    const types: DomainEventType[] = [
      "DigestRequested",
      "DigestCompleted",
      "DigestFailed",
      "PostsFetched",
      "PostsTriaged",
      "PostsSummarized",
      "SubredditAdded",
      "SubredditRemoved",
      "ConfigUpdated",
    ];
    expect(types).toHaveLength(9);
  });
});

describe("DomainEventBus", () => {
  it("emits and receives typed events", () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();

    bus.on("DigestRequested", handler);

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

    bus.emit("DigestRequested", event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not fire handler for different event type", () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();

    bus.on("DigestCompleted", handler);

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

    bus.emit("DigestRequested", event);

    expect(handler).not.toHaveBeenCalled();
  });

  it("removes handler with off()", () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();

    bus.on("ConfigUpdated", handler);
    bus.off("ConfigUpdated", handler);

    bus.emit("ConfigUpdated", {
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

  it("emitEvent() dispatches without generic constraint", () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();

    bus.on("SubredditAdded", handler);

    // emitEvent accepts DomainEvent union — useful when type isn't known statically
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

    bus.emitEvent(event);

    expect(handler).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: FAIL — `../events/types.js` doesn't export the types yet

**Step 3: Create event types**

Create `packages/core/src/events/types.ts`:

```typescript
/**
 * DomainEventMap — single source of truth for all domain events.
 * Adding a new event here automatically updates the DomainEvent union,
 * the DomainEventBus type signatures, and the Zod schema requirements.
 */
export interface DomainEventMap {
  DigestRequested: { jobId: string; subredditIds: string[] };
  DigestCompleted: { jobId: string; digestId: string };
  DigestFailed: { jobId: string; error: string };
  PostsFetched: { jobId: string; subreddit: string; count: number };
  PostsTriaged: { jobId: string; subreddit: string; selectedCount: number };
  PostsSummarized: { jobId: string; subreddit: string; summaryCount: number };
  SubredditAdded: { subredditId: string; name: string };
  SubredditRemoved: { subredditId: string; name: string };
  ConfigUpdated: { changes: Record<string, unknown> };
}

export type DomainEventType = keyof DomainEventMap;

/**
 * Discriminated union of all domain events — derived from DomainEventMap.
 * Includes the event envelope fields (aggregateId, correlation, etc.).
 * Narrows payload via `event.type` discriminant.
 */
export type DomainEvent = {
  [K in DomainEventType]: {
    type: K;
    payload: DomainEventMap[K];
    aggregateId: string;
    aggregateType: string;
    version: number;
    correlationId: string | null;
    causationId: string | null;
    metadata: Record<string, unknown>;
    occurredAt: Date;
  };
}[DomainEventType];
```

**Step 4: Implement DomainEventBus**

Replace `packages/core/src/events/bus.ts` with:

```typescript
import { EventEmitter } from "node:events";
import type { DomainEvent, DomainEventType, DomainEventMap } from "./types.js";

/**
 * Typed event bus wrapping Node.js EventEmitter.
 * Composition over inheritance — private emitter prevents untyped access.
 *
 * Typed methods (emit/on/off) require the specific event type as a generic.
 * emitEvent() accepts the DomainEvent union for cases where the type
 * isn't known statically (e.g., the execute() dispatch function).
 */
export class DomainEventBus {
  private emitter = new EventEmitter();

  emit<K extends DomainEventType>(
    type: K,
    event: DomainEvent & { type: K },
  ): void {
    this.emitter.emit(type, event);
  }

  on<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    this.emitter.on(type, handler as (...args: unknown[]) => void);
  }

  off<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    this.emitter.off(type, handler as (...args: unknown[]) => void);
  }

  /**
   * Emit an event from the DomainEvent union without requiring a generic.
   * Used by execute() where the event type is determined at runtime.
   */
  emitEvent(event: DomainEvent): void {
    this.emitter.emit(event.type, event);
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: 10 tests pass (5 errors + 1 context + 4 events)

**Step 6: Run full check**

Run: `pnpm check`
Expected: All pass

**Step 7: Commit**

```bash
git add packages/core/src/events/types.ts packages/core/src/events/bus.ts \
  packages/core/src/__tests__/events.test.ts
git commit -m "feat(core): add DomainEventMap, derived union, and typed EventBus"
```

---

### Task 4: Event Zod schemas + persistEvent

**Files:**
- Create: `packages/core/src/events/schemas.ts`
- Create: `packages/core/src/events/persist.ts`
- Create: `packages/core/src/__tests__/event-schemas.test.ts`
- Create: `packages/core/src/__tests__/persist-event.test.ts`

**Step 1: Write failing tests for Zod schemas**

Create `packages/core/src/__tests__/event-schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseEventPayload, eventPayloadSchemas } from "../events/schemas.js";
import type { DomainEventType } from "../events/types.js";

describe("eventPayloadSchemas", () => {
  it("has a schema for every DomainEventType", () => {
    const expectedTypes: DomainEventType[] = [
      "DigestRequested",
      "DigestCompleted",
      "DigestFailed",
      "PostsFetched",
      "PostsTriaged",
      "PostsSummarized",
      "SubredditAdded",
      "SubredditRemoved",
      "ConfigUpdated",
    ];
    for (const type of expectedTypes) {
      expect(eventPayloadSchemas[type]).toBeDefined();
    }
  });

  it("validates DigestRequested payload", () => {
    const result = parseEventPayload("DigestRequested", {
      jobId: "job-1",
      subredditIds: ["sub-1", "sub-2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid DigestRequested payload", () => {
    const result = parseEventPayload("DigestRequested", {
      jobId: 123, // should be string
    });
    expect(result.success).toBe(false);
  });

  it("validates SubredditAdded payload", () => {
    const result = parseEventPayload("SubredditAdded", {
      subredditId: "sub-1",
      name: "typescript",
    });
    expect(result.success).toBe(true);
  });

  it("validates ConfigUpdated payload", () => {
    const result = parseEventPayload("ConfigUpdated", {
      changes: { llmModel: "gpt-4.1" },
    });
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: FAIL — `../events/schemas.js` doesn't exist

**Step 3: Create event Zod schemas**

Create `packages/core/src/events/schemas.ts`:

```typescript
import { z } from "zod";
import type { DomainEventType } from "./types.js";

/**
 * Zod schemas for each event payload — used for DB deserialization.
 * The `satisfies` ensures this map stays in sync with DomainEventMap.
 * Adding an event to the map without a schema here is a compile error.
 */
export const eventPayloadSchemas = {
  DigestRequested: z.object({
    jobId: z.string(),
    subredditIds: z.array(z.string()),
  }),
  DigestCompleted: z.object({
    jobId: z.string(),
    digestId: z.string(),
  }),
  DigestFailed: z.object({
    jobId: z.string(),
    error: z.string(),
  }),
  PostsFetched: z.object({
    jobId: z.string(),
    subreddit: z.string(),
    count: z.number(),
  }),
  PostsTriaged: z.object({
    jobId: z.string(),
    subreddit: z.string(),
    selectedCount: z.number(),
  }),
  PostsSummarized: z.object({
    jobId: z.string(),
    subreddit: z.string(),
    summaryCount: z.number(),
  }),
  SubredditAdded: z.object({
    subredditId: z.string(),
    name: z.string(),
  }),
  SubredditRemoved: z.object({
    subredditId: z.string(),
    name: z.string(),
  }),
  ConfigUpdated: z.object({
    changes: z.record(z.string(), z.unknown()),
  }),
} as const satisfies Record<DomainEventType, z.ZodType>;

/**
 * Parse an event payload from untrusted source (e.g., DB jsonb column).
 */
export function parseEventPayload<K extends DomainEventType>(
  type: K,
  payload: unknown,
): z.SafeParseReturnType<unknown, z.infer<(typeof eventPayloadSchemas)[K]>> {
  return eventPayloadSchemas[type].safeParse(payload);
}
```

**Step 4: Run schema tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: 15 tests pass (5 errors + 1 context + 4 events + 5 schemas)

**Step 5: Write failing tests for persistEvent**

Create `packages/core/src/__tests__/persist-event.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { persistEvent } from "../events/persist.js";
import type { DomainEvent } from "../events/types.js";

function makeEvent(overrides?: Partial<DomainEvent>): DomainEvent {
  return {
    type: "DigestRequested",
    payload: { jobId: "job-1", subredditIds: ["sub-1"] },
    aggregateId: "job-1",
    aggregateType: "job",
    version: 1,
    correlationId: "corr-1",
    causationId: null,
    metadata: { source: "test" },
    occurredAt: new Date("2026-03-09T12:00:00Z"),
    ...overrides,
  } as DomainEvent;
}

describe("persistEvent", () => {
  it("calls tx.event.create with correct data", async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    const mockTx = { event: { create: mockCreate } };

    const event = makeEvent();
    await persistEvent(mockTx as Parameters<typeof persistEvent>[0], event);

    expect(mockCreate).toHaveBeenCalledOnce();
    const { data } = mockCreate.mock.calls[0]?.[0] ?? {};
    expect(data.type).toBe("DigestRequested");
    expect(data.aggregateId).toBe("job-1");
    expect(data.aggregateType).toBe("job");
    expect(data.version).toBe(1);
    expect(data.correlationId).toBe("corr-1");
    expect(data.causationId).toBeNull();
    expect(data.payload).toEqual({ jobId: "job-1", subredditIds: ["sub-1"] });
    expect(data.metadata).toEqual({ source: "test" });
  });

  it("passes null correlationId and causationId", async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    const mockTx = { event: { create: mockCreate } };

    const event = makeEvent({ correlationId: null, causationId: null });
    await persistEvent(mockTx as Parameters<typeof persistEvent>[0], event);

    const { data } = mockCreate.mock.calls[0]?.[0] ?? {};
    expect(data.correlationId).toBeNull();
    expect(data.causationId).toBeNull();
  });
});
```

**Step 6: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: FAIL — `../events/persist.js` doesn't exist

**Step 7: Create persistEvent**

Create `packages/core/src/events/persist.ts`:

```typescript
import type { DomainEvent } from "./types.js";

/**
 * Minimal interface for the transaction client's event model.
 * Avoids importing PrismaClient directly — keeps persist testable with mocks.
 */
interface EventCreateClient {
  event: {
    create: (args: { data: {
      type: string;
      payload: unknown;
      aggregateId: string;
      aggregateType: string;
      version: number;
      correlationId: string | null;
      causationId: string | null;
      metadata: unknown;
    } }) => Promise<unknown>;
  };
}

/**
 * Persist a domain event to the events table.
 * Called inside a $transaction by execute() — atomic with command writes.
 * The `id` (BigInt autoincrement) is assigned by the database.
 */
export async function persistEvent(
  tx: EventCreateClient,
  event: DomainEvent,
): Promise<void> {
  await tx.event.create({
    data: {
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      version: event.version,
      correlationId: event.correlationId,
      causationId: event.causationId,
      metadata: event.metadata,
    },
  });
}
```

Note: We define a minimal `EventCreateClient` interface instead of importing Prisma types directly. This keeps `persistEvent` testable with simple mocks and avoids coupling to the full PrismaClient type in this module.

**Step 8: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: 17 tests pass

**Step 9: Run full check**

Run: `pnpm check`
Expected: All pass

**Step 10: Commit**

```bash
git add packages/core/src/events/schemas.ts packages/core/src/events/persist.ts \
  packages/core/src/__tests__/event-schemas.test.ts \
  packages/core/src/__tests__/persist-event.test.ts
git commit -m "feat(core): add event Zod schemas and persistEvent function"
```

---

### Task 5: Command types + execute() dispatch

**Files:**
- Create: `packages/core/src/commands/types.ts`
- Create: `packages/core/src/commands/dispatch.ts`
- Create: `packages/core/src/__tests__/commands.test.ts`
- Create: `packages/core/src/__tests__/execute.test.ts`

**Step 1: Write failing tests for command types**

Create `packages/core/src/__tests__/commands.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Command, CommandType, CommandMap, CommandResultMap } from "../commands/types.js";

describe("Command types", () => {
  it("CommandType includes all 5 command types", () => {
    const types: CommandType[] = [
      "GenerateDigest",
      "AddSubreddit",
      "RemoveSubreddit",
      "UpdateSubreddit",
      "UpdateConfig",
    ];
    expect(types).toHaveLength(5);
  });

  it("derives correct Command union", () => {
    const cmd: Command = {
      type: "GenerateDigest",
      params: { subredditIds: ["sub-1"], lookbackHours: 24 },
    };
    expect(cmd.type).toBe("GenerateDigest");
  });

  it("narrows params via type discriminant", () => {
    const cmd: Command = {
      type: "AddSubreddit",
      params: { name: "r/typescript", displayName: "TypeScript" },
    };
    if (cmd.type === "AddSubreddit") {
      expect(cmd.params.name).toBe("r/typescript");
      expect(cmd.params.displayName).toBe("TypeScript");
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: FAIL — `../commands/types.js` doesn't exist

**Step 3: Create command types**

Create `packages/core/src/commands/types.ts`:

```typescript
import type { DomainEventMap, DomainEventType } from "../events/types.js";

/**
 * CommandMap — all commands the system accepts.
 * Each key is a command name, value is the params type.
 */
export interface CommandMap {
  GenerateDigest: {
    subredditIds?: string[];
    lookbackHours?: number;
  };
  AddSubreddit: {
    name: string;
    displayName: string;
    insightPrompt?: string;
    maxPosts?: number;
    nsfw?: boolean;
  };
  RemoveSubreddit: {
    subredditId: string;
  };
  UpdateSubreddit: {
    subredditId: string;
    insightPrompt?: string;
    maxPosts?: number;
    active?: boolean;
  };
  UpdateConfig: {
    globalInsightPrompt?: string;
    defaultLookbackHours?: number;
    llmProvider?: string;
    llmModel?: string;
  };
}

/**
 * CommandResultMap — what each command returns on success.
 */
export interface CommandResultMap {
  GenerateDigest: { jobId: string; status: string };
  AddSubreddit: { subredditId: string };
  RemoveSubreddit: { success: true };
  UpdateSubreddit: { subredditId: string };
  UpdateConfig: { success: true };
}

/**
 * CommandEventMap — which event each command emits.
 * `never` means the command doesn't emit an event.
 */
export interface CommandEventMap {
  GenerateDigest: "DigestRequested";
  AddSubreddit: "SubredditAdded";
  RemoveSubreddit: "SubredditRemoved";
  UpdateSubreddit: never;
  UpdateConfig: "ConfigUpdated";
}

// Derived types
export type CommandType = keyof CommandMap;

export type Command = {
  [K in CommandType]: { type: K; params: CommandMap[K] };
}[CommandType];

/**
 * CommandHandler — plain async function, receives params + context.
 * Returns data + event (null if CommandEventMap[K] is never).
 */
export type CommandHandler<K extends CommandType> = (
  params: CommandMap[K],
  ctx: import("../context.js").HandlerContext,
) => Promise<{
  data: CommandResultMap[K];
  event: CommandEventMap[K] extends never
    ? null
    : CommandEventMap[K] extends DomainEventType
      ? DomainEventMap[CommandEventMap[K]]
      : never;
}>;
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: 20 tests pass

**Step 5: Write failing tests for execute() dispatch**

Create `packages/core/src/__tests__/execute.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createExecute } from "../commands/dispatch.js";
import { DomainEventBus } from "../events/bus.js";
import type { CommandHandler } from "../commands/types.js";
import type { HandlerContext } from "../context.js";

describe("execute()", () => {
  let eventBus: DomainEventBus;
  let mockEventCreate: ReturnType<typeof vi.fn>;
  let mockTx: { event: { create: ReturnType<typeof vi.fn> } };
  let mockDb: { $transaction: ReturnType<typeof vi.fn> };
  let ctx: HandlerContext;

  beforeEach(() => {
    eventBus = new DomainEventBus();
    mockEventCreate = vi.fn().mockResolvedValue(undefined);
    mockTx = { event: { create: mockEventCreate } };
    mockDb = {
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    };
    ctx = {
      db: mockDb as unknown as HandlerContext["db"],
      eventBus,
      config: {} as HandlerContext["config"],
    };
  });

  it("calls handler with params and transactional context", async () => {
    const handler = vi.fn().mockResolvedValue({
      data: { jobId: "job-1", status: "queued" },
      event: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    const execute = createExecute({ GenerateDigest: handler as CommandHandler<"GenerateDigest"> });

    await execute("GenerateDigest", { subredditIds: ["sub-1"] }, ctx);

    expect(handler).toHaveBeenCalledOnce();
    // Handler receives mockTx as db (inside transaction), not mockDb
    const handlerCtx = handler.mock.calls[0]?.[1] as HandlerContext;
    expect(handlerCtx.db).toBe(mockTx);
  });

  it("returns handler result data", async () => {
    const handler = vi.fn().mockResolvedValue({
      data: { jobId: "job-1", status: "queued" },
      event: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    const execute = createExecute({ GenerateDigest: handler as CommandHandler<"GenerateDigest"> });
    const result = await execute("GenerateDigest", {}, ctx);

    expect(result).toEqual({ jobId: "job-1", status: "queued" });
  });

  it("persists event inside transaction", async () => {
    const handler = vi.fn().mockResolvedValue({
      data: { jobId: "job-1", status: "queued" },
      event: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    const execute = createExecute({ GenerateDigest: handler as CommandHandler<"GenerateDigest"> });
    await execute("GenerateDigest", {}, ctx);

    expect(mockEventCreate).toHaveBeenCalledOnce();
    const createArg = mockEventCreate.mock.calls[0]?.[0];
    expect(createArg?.data?.type).toBe("DigestRequested");
    expect(createArg?.data?.payload).toEqual({ jobId: "job-1", subredditIds: ["sub-1"] });
  });

  it("emits event on bus AFTER transaction", async () => {
    const emitted: string[] = [];
    eventBus.on("DigestRequested", () => {
      emitted.push("DigestRequested");
    });

    const handler = vi.fn().mockResolvedValue({
      data: { jobId: "job-1", status: "queued" },
      event: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    const execute = createExecute({ GenerateDigest: handler as CommandHandler<"GenerateDigest"> });
    await execute("GenerateDigest", {}, ctx);

    expect(emitted).toEqual(["DigestRequested"]);
  });

  it("does not persist or emit event when handler returns null event", async () => {
    const handler = vi.fn().mockResolvedValue({
      data: { subredditId: "sub-1" },
      event: null,
    });

    const emitted: string[] = [];
    eventBus.on("SubredditAdded", () => emitted.push("fired"));

    const execute = createExecute({ UpdateSubreddit: handler as CommandHandler<"UpdateSubreddit"> });
    await execute("UpdateSubreddit", { subredditId: "sub-1" }, ctx);

    expect(mockEventCreate).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });

  it("propagates handler errors", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("DB constraint violation"));

    const execute = createExecute({ GenerateDigest: handler as CommandHandler<"GenerateDigest"> });

    await expect(execute("GenerateDigest", {}, ctx)).rejects.toThrow("DB constraint violation");
  });
});
```

**Step 6: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: FAIL — `../commands/dispatch.js` doesn't exist

**Step 7: Create execute() dispatch**

Create `packages/core/src/commands/dispatch.ts`:

```typescript
import type { CommandType, CommandMap, CommandResultMap, CommandEventMap, CommandHandler } from "./types.js";
import type { HandlerContext } from "../context.js";
import type { DomainEvent, DomainEventType } from "../events/types.js";
import { persistEvent } from "../events/persist.js";

/**
 * Event type lookup — maps command type to its emitted event type.
 * Returns undefined for commands that don't emit events (CommandEventMap[K] = never).
 */
const COMMAND_EVENT_TYPES: Record<CommandType, DomainEventType | undefined> = {
  GenerateDigest: "DigestRequested",
  AddSubreddit: "SubredditAdded",
  RemoveSubreddit: "SubredditRemoved",
  UpdateSubreddit: undefined,
  UpdateConfig: "ConfigUpdated",
};

/**
 * Aggregate type lookup — maps command type to its aggregate type for event envelope.
 */
const COMMAND_AGGREGATE_TYPES: Record<CommandType, string> = {
  GenerateDigest: "job",
  AddSubreddit: "subreddit",
  RemoveSubreddit: "subreddit",
  UpdateSubreddit: "subreddit",
  UpdateConfig: "config",
};

type HandlerRegistry = {
  [K in CommandType]?: CommandHandler<K>;
};

/**
 * Create the execute() dispatch function with a handler registry.
 * Handlers are registered at startup, not at runtime.
 *
 * Returns a typed dispatch function:
 *   execute('GenerateDigest', { subredditIds: [...] }, ctx) → { jobId, status }
 */
export function createExecute(handlers: HandlerRegistry) {
  return async function execute<K extends CommandType>(
    type: K,
    params: CommandMap[K],
    ctx: HandlerContext,
  ): Promise<CommandResultMap[K]> {
    const handler = handlers[type] as CommandHandler<K> | undefined;
    if (!handler) {
      throw new Error(`No handler registered for command: ${type}`);
    }

    const eventType = COMMAND_EVENT_TYPES[type];
    const aggregateType = COMMAND_AGGREGATE_TYPES[type];

    const { data, event: eventPayload } = await ctx.db.$transaction(async (tx) => {
      const result = await handler(params, { ...ctx, db: tx });

      if (result.event && eventType) {
        const fullEvent: DomainEvent = {
          type: eventType,
          payload: result.event,
          aggregateId: extractAggregateId(type, result.data),
          aggregateType,
          version: 1,
          correlationId: null,
          causationId: null,
          metadata: {},
          occurredAt: new Date(),
        } as DomainEvent;

        await persistEvent(tx, fullEvent);
        return { data: result.data, event: fullEvent };
      }

      return { data: result.data, event: null };
    });

    // Emit AFTER transaction commits
    if (eventPayload) {
      ctx.eventBus.emitEvent(eventPayload);
    }

    return data;
  };
}

/**
 * Extract the aggregate ID from the command result.
 * Used to populate the event envelope's aggregateId field.
 */
function extractAggregateId(type: CommandType, data: unknown): string {
  const result = data as Record<string, unknown>;
  if (type === "GenerateDigest" && typeof result.jobId === "string") {
    return result.jobId;
  }
  if (typeof result.subredditId === "string") {
    return result.subredditId;
  }
  // Config commands — use fixed aggregate ID
  return "config-singleton";
}
```

**Step 8: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: 26 tests pass

**Step 9: Run full check**

Run: `pnpm check`
Expected: All pass

**Step 10: Commit**

```bash
git add packages/core/src/commands/types.ts packages/core/src/commands/dispatch.ts \
  packages/core/src/__tests__/commands.test.ts packages/core/src/__tests__/execute.test.ts
git commit -m "feat(core): add CommandMap, derived types, and execute() dispatch with auto-persist"
```

---

### Task 6: Query types + query() dispatch

**Files:**
- Create: `packages/core/src/queries/types.ts`
- Create: `packages/core/src/queries/dispatch.ts`
- Create: `packages/core/src/__tests__/queries.test.ts`

**Step 1: Write failing tests**

Create `packages/core/src/__tests__/queries.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { Query, QueryType } from "../queries/types.js";
import { createQuery } from "../queries/dispatch.js";
import type { HandlerContext } from "../context.js";

describe("Query types", () => {
  it("QueryType includes all 9 query types", () => {
    const types: QueryType[] = [
      "GetDigest",
      "GetPost",
      "GetRunStatus",
      "ListDigests",
      "ListRuns",
      "ListSubreddits",
      "GetConfig",
      "SearchPosts",
      "SearchDigests",
    ];
    expect(types).toHaveLength(9);
  });

  it("derives correct Query union", () => {
    const q: Query = {
      type: "GetDigest",
      params: { digestId: "digest-1" },
    };
    expect(q.type).toBe("GetDigest");
  });

  it("allows empty params for ListSubreddits", () => {
    const q: Query = {
      type: "ListSubreddits",
      params: {},
    };
    expect(q.params).toEqual({});
  });
});

describe("query()", () => {
  it("dispatches to the correct handler", async () => {
    const handler = vi.fn().mockResolvedValue({ id: "digest-1", content: "..." });

    const query = createQuery({ GetDigest: handler });
    const ctx = {
      db: {} as HandlerContext["db"],
      eventBus: {} as HandlerContext["eventBus"],
      config: {} as HandlerContext["config"],
    };

    const result = await query("GetDigest", { digestId: "digest-1" }, ctx);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ digestId: "digest-1" }, ctx);
    expect(result).toEqual({ id: "digest-1", content: "..." });
  });

  it("throws for unregistered query handler", async () => {
    const query = createQuery({});
    const ctx = {
      db: {} as HandlerContext["db"],
      eventBus: {} as HandlerContext["eventBus"],
      config: {} as HandlerContext["config"],
    };

    await expect(query("GetDigest", { digestId: "x" }, ctx)).rejects.toThrow(
      "No handler registered for query: GetDigest",
    );
  });

  it("propagates handler errors", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Not found"));

    const query = createQuery({ GetDigest: handler });
    const ctx = {
      db: {} as HandlerContext["db"],
      eventBus: {} as HandlerContext["eventBus"],
      config: {} as HandlerContext["config"],
    };

    await expect(query("GetDigest", { digestId: "x" }, ctx)).rejects.toThrow("Not found");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: FAIL — modules don't exist

**Step 3: Create query types**

Create `packages/core/src/queries/types.ts`:

```typescript
import type { HandlerContext } from "../context.js";

/**
 * QueryMap — all queries the system accepts.
 * Each key is a query name, value is the params type.
 */
export interface QueryMap {
  GetDigest: { digestId: string };
  GetPost: { postId: string };
  GetRunStatus: { jobId: string };
  ListDigests: { limit?: number };
  ListRuns: { limit?: number };
  ListSubreddits: {};
  GetConfig: {};
  SearchPosts: { query: string; limit?: number };
  SearchDigests: { query: string; limit?: number };
}

/**
 * QueryResultMap — placeholder return types for each query.
 * Sprint 4 will refine these with Prisma-generated types.
 */
export interface QueryResultMap {
  GetDigest: unknown;
  GetPost: unknown;
  GetRunStatus: unknown;
  ListDigests: unknown;
  ListRuns: unknown;
  ListSubreddits: unknown;
  GetConfig: unknown;
  SearchPosts: unknown;
  SearchDigests: unknown;
}

// Derived types
export type QueryType = keyof QueryMap;

export type Query = {
  [K in QueryType]: { type: K; params: QueryMap[K] };
}[QueryType];

export type QueryHandler<K extends QueryType> = (
  params: QueryMap[K],
  ctx: HandlerContext,
) => Promise<QueryResultMap[K]>;
```

**Step 4: Create query() dispatch**

Create `packages/core/src/queries/dispatch.ts`:

```typescript
import type { QueryType, QueryMap, QueryResultMap, QueryHandler } from "./types.js";
import type { HandlerContext } from "../context.js";

type QueryHandlerRegistry = {
  [K in QueryType]?: QueryHandler<K>;
};

/**
 * Create the query() dispatch function with a handler registry.
 * No transaction, no events — just dispatch → handler → result.
 */
export function createQuery(handlers: QueryHandlerRegistry) {
  return async function query<K extends QueryType>(
    type: K,
    params: QueryMap[K],
    ctx: HandlerContext,
  ): Promise<QueryResultMap[K]> {
    const handler = handlers[type] as QueryHandler<K> | undefined;
    if (!handler) {
      throw new Error(`No handler registered for query: ${type}`);
    }
    return handler(params, ctx);
  };
}
```

**Step 5: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run --exclude 'dist/**'`
Expected: 32 tests pass

**Step 6: Run full check**

Run: `pnpm check`
Expected: All pass

**Step 7: Commit**

```bash
git add packages/core/src/queries/types.ts packages/core/src/queries/dispatch.ts \
  packages/core/src/__tests__/queries.test.ts
git commit -m "feat(core): add QueryMap, derived types, and query() dispatch"
```

---

### Task 7: Token bucket rate limiter

**Files:**
- Create: `packages/reddit/src/rate-limiter.ts`
- Create: `packages/reddit/src/__tests__/rate-limiter.test.ts`

**Step 1: Write failing tests**

Create `packages/reddit/src/__tests__/rate-limiter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucket } from "../rate-limiter.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to capacity", async () => {
    const bucket = new TokenBucket({ capacity: 3, refillRate: 1 });

    // Should resolve immediately for first 3 requests
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(true).toBe(true); // No timeout = success
  });

  it("blocks when tokens exhausted and resolves after refill", async () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 1 });

    await bucket.acquire(); // Uses the 1 available token

    let resolved = false;
    const pending = bucket.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    // Advance 1 second — refill 1 token
    await vi.advanceTimersByTimeAsync(1000);

    await pending;
    expect(resolved).toBe(true);
  });

  it("queues multiple waiters in FIFO order", async () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 1 });

    await bucket.acquire(); // Drain

    const order: number[] = [];
    const p1 = bucket.acquire().then(() => order.push(1));
    const p2 = bucket.acquire().then(() => order.push(2));

    // Advance 1s — first waiter gets token
    await vi.advanceTimersByTimeAsync(1000);
    // Advance another 1s — second waiter gets token
    await vi.advanceTimersByTimeAsync(1000);

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("sync() adjusts tokens from Reddit headers", async () => {
    const bucket = new TokenBucket({ capacity: 60, refillRate: 1 });

    // Reddit says only 5 remaining with 30s until reset
    bucket.sync(5, 30);

    // Should be able to acquire 5 times
    for (let i = 0; i < 5; i++) {
      await bucket.acquire();
    }

    // 6th should block
    let resolved = false;
    bucket.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
  });

  it("starts with full capacity", async () => {
    const bucket = new TokenBucket({ capacity: 60, refillRate: 1 });

    // Should be able to acquire 60 times without blocking
    for (let i = 0; i < 60; i++) {
      await bucket.acquire();
    }
    expect(true).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @redgest/reddit exec vitest run --exclude 'dist/**'`
Expected: FAIL — `../rate-limiter.js` doesn't exist

**Step 3: Implement TokenBucket**

Create `packages/reddit/src/rate-limiter.ts`:

```typescript
export interface TokenBucketOptions {
  /** Max tokens in the bucket */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
}

/**
 * Token bucket rate limiter for Reddit API (60 req/min).
 *
 * acquire() returns a promise that resolves when a token is available.
 * sync() adjusts token count from Reddit's X-Ratelimit headers.
 */
export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private lastRefill: number;
  private readonly waiters: Array<() => void> = [];
  private refillTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillRate = options.refillRate;
    this.tokens = options.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Acquire a token. Resolves immediately if available,
   * otherwise queues and resolves when a token is refilled.
   */
  acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }

    // No tokens — queue the waiter and start refill timer
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.startRefillTimer();
    });
  }

  /**
   * Sync token count with Reddit's rate limit headers.
   * Called after each API response.
   */
  sync(remaining: number, resetSeconds: number): void {
    this.tokens = Math.min(remaining, this.capacity);
    this.lastRefill = Date.now();

    // If Reddit says reset in N seconds, adjust refill timing
    if (resetSeconds > 0 && remaining === 0) {
      this.tokens = 0;
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;

    if (newTokens >= 1) {
      this.tokens = Math.min(this.capacity, this.tokens + Math.floor(newTokens));
      this.lastRefill = now;
    }
  }

  private startRefillTimer(): void {
    if (this.refillTimer) return;

    const intervalMs = Math.ceil(1000 / this.refillRate);
    this.refillTimer = setInterval(() => {
      this.refill();
      this.drainWaiters();

      if (this.waiters.length === 0 && this.refillTimer) {
        clearInterval(this.refillTimer);
        this.refillTimer = null;
      }
    }, intervalMs);
  }

  private drainWaiters(): void {
    while (this.waiters.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const waiter = this.waiters.shift();
      if (waiter) waiter();
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @redgest/reddit exec vitest run --exclude 'dist/**'`
Expected: 11 tests pass (6 client + 5 rate-limiter)

**Step 5: Run full check**

Run: `pnpm check`
Expected: All pass

**Step 6: Commit**

```bash
git add packages/reddit/src/rate-limiter.ts packages/reddit/src/__tests__/rate-limiter.test.ts
git commit -m "feat(reddit): add token bucket rate limiter — 60 req/min with header sync"
```

---

### Task 8: Wire up exports + final verification

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/reddit/src/index.ts`

**Step 1: Update @redgest/core exports**

Replace `packages/core/src/index.ts` with:

```typescript
// Errors
export { RedgestError, ErrorCode, type ErrorCodeType } from "./errors.js";

// Events
export type { DomainEventMap, DomainEventType, DomainEvent } from "./events/types.js";
export { DomainEventBus } from "./events/bus.js";
export { persistEvent } from "./events/persist.js";
export { eventPayloadSchemas, parseEventPayload } from "./events/schemas.js";

// Commands
export type {
  CommandMap,
  CommandResultMap,
  CommandEventMap,
  CommandType,
  Command,
  CommandHandler,
} from "./commands/types.js";
export { createExecute } from "./commands/dispatch.js";

// Queries
export type {
  QueryMap,
  QueryResultMap,
  QueryType,
  Query,
  QueryHandler,
} from "./queries/types.js";
export { createQuery } from "./queries/dispatch.js";

// Context
export type { HandlerContext, DbClient } from "./context.js";
```

**Step 2: Update @redgest/reddit exports**

Check current `packages/reddit/src/index.ts` and add TokenBucket export:

```typescript
export { RedditClient, type RedditClientOptions } from "./client.js";
export { TokenBucket, type TokenBucketOptions } from "./rate-limiter.js";
export type {
  RedditAuthToken,
  RedditListing,
  RedditPostData,
  RedditCommentData,
  FetchPostsOptions,
} from "./types.js";
```

**Step 3: Run full check**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass across all packages.

**Step 4: Verify test count**

Run: `pnpm test`
Expected: ~80+ tests total (54 existing + ~26 new in core + 5 new in reddit)

**Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/reddit/src/index.ts
git commit -m "feat: wire up CQRS core and token bucket exports — Sprint 3 complete"
```

---

## Summary

| Task | Deliverable | Tests Added | Points |
|------|------------|------------|--------|
| 1 | TD-001: insightNotes string fix | 0 (updated existing) | 0.5 |
| 2 | HandlerContext + DB type exports | 1 | — |
| 3 | DomainEventMap + DomainEventBus | 8 | 1.0 |
| 4 | Event Zod schemas + persistEvent | 7 | — |
| 5 | CommandMap + execute() dispatch | 9 | 2.0 |
| 6 | QueryMap + query() dispatch | 6 | 1.0 |
| 7 | Token bucket rate limiter | 5 | 0.5 |
| 8 | Exports + verification | 0 | — |
| **Total** | | **~36 new tests** | **5.0** |
