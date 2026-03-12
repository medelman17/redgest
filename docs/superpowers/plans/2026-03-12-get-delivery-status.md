# `get_delivery_status` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add delivery tracking — persist per-channel delivery outcomes and expose them via a `get_delivery_status` MCP tool.

**Architecture:** New `deliveries` table with one row per channel per digest. Worker writes PENDING before send, upserts to SENT/FAILED after. Domain events persisted for audit trail. Query handler reads from a two-step approach (digests table + delivery_view). MCP tool wraps the query.

**Tech Stack:** Prisma v7 (migration + model), Zod (event schemas), Vitest (tests), Hono MCP server (tool registration)

**Spec:** `docs/superpowers/specs/2026-03-12-get-delivery-status-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/db/prisma/schema.prisma` | Add `DeliveryChannelType`, `DeliveryStatus` enums, `Delivery` model, relations |
| Create | Migration SQL (Prisma-generated) | Table + view creation |
| Modify | `packages/core/src/events/types.ts` | Add `DeliverySucceeded`, `DeliveryFailed` to `DomainEventMap` |
| Modify | `packages/core/src/events/schemas.ts` | Add Zod schemas for new events |
| Create | `packages/core/src/delivery/record.ts` | `recordDeliveryPending()`, `recordDeliveryResult()` |
| Modify | `packages/core/src/queries/types.ts` | Add `GetDeliveryStatus` to `QueryMap` + `QueryResultMap` |
| Create | `packages/core/src/queries/handlers/get-delivery-status.ts` | Query handler implementation |
| Modify | `packages/core/src/queries/handlers/index.ts` | Register new handler |
| Modify | `packages/core/src/index.ts` | Export delivery record functions + handler |
| Modify | `apps/worker/src/trigger/deliver-digest.ts` | Integrate delivery recording + event persistence |
| Modify | `packages/mcp-server/src/tools.ts` | Add `get_delivery_status` tool |
| Create | `packages/core/src/__tests__/delivery-record.test.ts` | Tests for record functions |
| Modify | `packages/core/src/__tests__/event-schemas.test.ts` | Tests for new event schemas |
| Modify | `packages/core/src/__tests__/query-handlers.test.ts` | Tests for GetDeliveryStatus handler |
| Modify | `packages/mcp-server/src/__tests__/tools.test.ts` | Tests for get_delivery_status tool |

---

## Chunk 1: Schema + Events + Delivery Record Functions

### Task 1: Add Prisma schema changes

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add enums and Delivery model to schema**

Add after the existing `DeliveryChannel` enum:

```prisma
enum DeliveryChannelType {
  EMAIL
  SLACK

  @@map("delivery_channel_type")
}

enum DeliveryStatus {
  PENDING
  SENT
  FAILED

  @@map("delivery_status")
}
```

Add the `Delivery` model:

```prisma
model Delivery {
  id         String              @id @default(uuid(7))
  digestId   String              @map("digest_id")
  jobId      String              @map("job_id")
  channel    DeliveryChannelType
  status     DeliveryStatus      @default(PENDING)
  error      String?
  externalId String?             @map("external_id")
  sentAt     DateTime?           @map("sent_at")
  createdAt  DateTime            @default(now()) @map("created_at")
  updatedAt  DateTime            @updatedAt @map("updated_at")

  digest Digest @relation(fields: [digestId], references: [id])
  job    Job    @relation(fields: [jobId], references: [id])

  @@unique([digestId, channel])
  @@map("deliveries")
}
```

Add `deliveries Delivery[]` relation field to both the `Digest` and `Job` models.

- [ ] **Step 2: Generate migration**

Run:
```bash
pnpm --filter @redgest/db exec prisma migrate dev --name add_deliveries_table
```

Expected: Migration created successfully, Prisma client regenerated.

- [ ] **Step 3: Add delivery_view to migration**

Append to the generated migration SQL file:

```sql
CREATE OR REPLACE VIEW delivery_view AS
SELECT
  d.id AS delivery_id,
  d.digest_id,
  d.job_id,
  d.channel::text AS channel,
  d.status::text AS status,
  d.error,
  d.external_id,
  d.sent_at,
  d.created_at,
  d.updated_at,
  dig.created_at AS digest_created_at,
  j.status::text AS job_status
FROM deliveries d
JOIN digests dig ON d.digest_id = dig.id
JOIN jobs j ON d.job_id = j.id
ORDER BY dig.created_at DESC, d.channel ASC;
```

Add the corresponding `view` definition in `schema.prisma`:

```prisma
view DeliveryView {
  deliveryId      String   @unique @map("delivery_id")
  digestId        String   @map("digest_id")
  jobId           String   @map("job_id")
  channel         String
  status          String
  error           String?
  externalId      String?  @map("external_id")
  sentAt          DateTime? @map("sent_at")
  createdAt       DateTime @map("created_at")
  updatedAt       DateTime @map("updated_at")
  digestCreatedAt DateTime @map("digest_created_at")
  jobStatus       String   @map("job_status")

  @@map("delivery_view")
}
```

- [ ] **Step 4: Regenerate Prisma client and verify**

Run:
```bash
turbo db:generate && turbo typecheck
```

Expected: All packages typecheck successfully.

- [ ] **Step 5: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add deliveries table, enums, and delivery_view (#26)"
```

---

### Task 2: Add domain events

**Files:**
- Modify: `packages/core/src/events/types.ts`
- Modify: `packages/core/src/events/schemas.ts`
- Modify: `packages/core/src/__tests__/event-schemas.test.ts`

- [ ] **Step 1: Write failing test for new event schemas**

In `packages/core/src/__tests__/event-schemas.test.ts`, first update the `expectedTypes` array in the "has a schema for every DomainEventType" test to include `"DeliverySucceeded"` and `"DeliveryFailed"`. Then add explicit validation tests:

```typescript
describe("DeliverySucceeded", () => {
  it("validates a correct payload", () => {
    const result = parseEventPayload("DeliverySucceeded", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
      externalId: "resend-msg-123",
    });
    expect(result.success).toBe(true);
  });

  it("validates without optional externalId", () => {
    const result = parseEventPayload("DeliverySucceeded", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "SLACK",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid channel", () => {
    const result = parseEventPayload("DeliverySucceeded", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "SMS",
    });
    expect(result.success).toBe(false);
  });
});

describe("DeliveryFailed", () => {
  it("validates a correct payload", () => {
    const result = parseEventPayload("DeliveryFailed", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
      error: "Resend API returned 403",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing error", () => {
    const result = parseEventPayload("DeliveryFailed", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @redgest/core exec vitest run src/__tests__/event-schemas.test.ts
```

Expected: FAIL — `DeliverySucceeded` and `DeliveryFailed` not in `DomainEventMap`.

- [ ] **Step 3: Add events to DomainEventMap**

In `packages/core/src/events/types.ts`, add to the `DomainEventMap` interface:

```typescript
DeliverySucceeded: {
  jobId: string;
  digestId: string;
  channel: "EMAIL" | "SLACK";
  externalId?: string;
};
DeliveryFailed: {
  jobId: string;
  digestId: string;
  channel: "EMAIL" | "SLACK";
  error: string;
};
```

- [ ] **Step 4: Add Zod schemas**

In `packages/core/src/events/schemas.ts`, add to `eventPayloadSchemas`:

```typescript
DeliverySucceeded: z.object({
  jobId: z.string(),
  digestId: z.string(),
  channel: z.enum(["EMAIL", "SLACK"]),
  externalId: z.string().optional(),
}),
DeliveryFailed: z.object({
  jobId: z.string(),
  digestId: z.string(),
  channel: z.enum(["EMAIL", "SLACK"]),
  error: z.string(),
}),
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm --filter @redgest/core exec vitest run src/__tests__/event-schemas.test.ts
```

Expected: All tests PASS including new DeliverySucceeded/DeliveryFailed tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/events/ packages/core/src/__tests__/event-schemas.test.ts
git commit -m "feat(core): add DeliverySucceeded and DeliveryFailed domain events (#26)"
```

---

### Task 3: Implement delivery record functions

**Files:**
- Create: `packages/core/src/delivery/record.ts`
- Create: `packages/core/src/__tests__/delivery-record.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for recordDeliveryPending**

Create `packages/core/src/__tests__/delivery-record.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { recordDeliveryPending, recordDeliveryResult } from "../delivery/record.js";

function stub<T>(): T {
  return {} as T;
}

describe("recordDeliveryPending", () => {
  it("upserts a PENDING delivery row for each channel", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({});
    const db = stub<{ delivery: { upsert: typeof mockUpsert } }>() ;
    db.delivery = { upsert: mockUpsert };

    await recordDeliveryPending(db, "digest-1", "job-1", ["EMAIL", "SLACK"]);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { digestId_channel: { digestId: "digest-1", channel: "EMAIL" } },
      create: { digestId: "digest-1", jobId: "job-1", channel: "EMAIL", status: "PENDING" },
      update: { status: "PENDING", error: null, externalId: null, sentAt: null },
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { digestId_channel: { digestId: "digest-1", channel: "SLACK" } },
      create: { digestId: "digest-1", jobId: "job-1", channel: "SLACK", status: "PENDING" },
      update: { status: "PENDING", error: null, externalId: null, sentAt: null },
    });
  });

  it("handles empty channels array", async () => {
    const mockUpsert = vi.fn();
    const db = stub<{ delivery: { upsert: typeof mockUpsert } }>();
    db.delivery = { upsert: mockUpsert };

    await recordDeliveryPending(db, "digest-1", "job-1", []);

    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @redgest/core exec vitest run src/__tests__/delivery-record.test.ts
```

Expected: FAIL — module `../delivery/record.js` not found.

- [ ] **Step 3: Implement recordDeliveryPending**

Create `packages/core/src/delivery/record.ts`:

```typescript
import type { EventCreateClient } from "../events/persist.js";
import type { DomainEvent } from "../events/types.js";
import { persistEvent } from "../events/persist.js";

/** Minimal Prisma interface for delivery operations. */
export interface DeliveryClient {
  delivery: {
    upsert: (args: {
      where: { digestId_channel: { digestId: string; channel: string } };
      create: {
        digestId: string;
        jobId: string;
        channel: string;
        status: string;
      };
      update: {
        status: string;
        error: string | null;
        externalId: string | null;
        sentAt: Date | null;
      };
    }) => Promise<unknown>;
  };
}

/** Minimal Prisma interface for transactional delivery + event persistence. */
export interface DeliveryTransactionClient extends DeliveryClient {
  $transaction: (fn: (tx: DeliveryClient & EventCreateClient) => Promise<void>) => Promise<void>;
}

type DeliveryChannelType = "EMAIL" | "SLACK";

/**
 * Upsert PENDING delivery rows for each channel.
 * Uses upsert for idempotency on Trigger.dev retries.
 */
export async function recordDeliveryPending(
  db: DeliveryClient,
  digestId: string,
  jobId: string,
  channels: DeliveryChannelType[],
): Promise<void> {
  await Promise.all(
    channels.map((channel) =>
      db.delivery.upsert({
        where: { digestId_channel: { digestId, channel } },
        create: { digestId, jobId, channel, status: "PENDING" },
        update: { status: "PENDING", error: null, externalId: null, sentAt: null },
      }),
    ),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @redgest/core exec vitest run src/__tests__/delivery-record.test.ts
```

Expected: recordDeliveryPending tests PASS.

- [ ] **Step 5: Write failing tests for recordDeliveryResult**

Add to `packages/core/src/__tests__/delivery-record.test.ts`:

```typescript
describe("recordDeliveryResult", () => {
  it("upserts SENT status with externalId and persists DeliverySucceeded event", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({});
    const mockEventCreate = vi.fn().mockResolvedValue({});
    const mockTransaction = vi.fn().mockImplementation(async (fn) => {
      const tx = stub<{ delivery: { upsert: typeof mockUpsert }; event: { create: typeof mockEventCreate } }>();
      tx.delivery = { upsert: mockUpsert };
      tx.event = { create: mockEventCreate };
      await fn(tx);
    });
    const db = stub<{ $transaction: typeof mockTransaction }>();
    db.$transaction = mockTransaction;

    await recordDeliveryResult(db, "digest-1", "job-1", "EMAIL", {
      status: "SENT",
      externalId: "resend-123",
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { digestId_channel: { digestId: "digest-1", channel: "EMAIL" } },
      create: {
        digestId: "digest-1",
        jobId: "job-1",
        channel: "EMAIL",
        status: "SENT",
        externalId: "resend-123",
        sentAt: expect.any(Date),
      },
      update: {
        status: "SENT",
        error: null,
        externalId: "resend-123",
        sentAt: expect.any(Date),
      },
    });
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "DeliverySucceeded",
        aggregateId: "job-1",
        aggregateType: "Job",
      }),
    });
  });

  it("upserts FAILED status with error and persists DeliveryFailed event", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({});
    const mockEventCreate = vi.fn().mockResolvedValue({});
    const mockTransaction = vi.fn().mockImplementation(async (fn) => {
      const tx = stub<{ delivery: { upsert: typeof mockUpsert }; event: { create: typeof mockEventCreate } }>();
      tx.delivery = { upsert: mockUpsert };
      tx.event = { create: mockEventCreate };
      await fn(tx);
    });
    const db = stub<{ $transaction: typeof mockTransaction }>();
    db.$transaction = mockTransaction;

    await recordDeliveryResult(db, "digest-1", "job-1", "SLACK", {
      status: "FAILED",
      error: "Webhook returned 403",
    });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { digestId_channel: { digestId: "digest-1", channel: "SLACK" } },
      create: {
        digestId: "digest-1",
        jobId: "job-1",
        channel: "SLACK",
        status: "FAILED",
        error: "Webhook returned 403",
      },
      update: {
        status: "FAILED",
        error: "Webhook returned 403",
        externalId: null,
        sentAt: null,
      },
    });
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "DeliveryFailed",
        payload: expect.objectContaining({
          channel: "SLACK",
          error: "Webhook returned 403",
        }),
      }),
    });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run:
```bash
pnpm --filter @redgest/core exec vitest run src/__tests__/delivery-record.test.ts
```

Expected: FAIL — `recordDeliveryResult` not exported.

- [ ] **Step 7: Implement recordDeliveryResult**

Add to `packages/core/src/delivery/record.ts`:

```typescript
type DeliveryResult =
  | { status: "SENT"; externalId?: string }
  | { status: "FAILED"; error: string };

/**
 * Record a delivery result: upsert delivery row + persist domain event.
 * Both writes happen in a single $transaction for atomicity.
 * Does NOT emit to DomainEventBus (worker has no access to it).
 */
export async function recordDeliveryResult(
  db: DeliveryTransactionClient,
  digestId: string,
  jobId: string,
  channel: DeliveryChannelType,
  result: DeliveryResult,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const now = new Date();

    if (result.status === "SENT") {
      await tx.delivery.upsert({
        where: { digestId_channel: { digestId, channel } },
        create: {
          digestId,
          jobId,
          channel,
          status: "SENT",
          externalId: result.externalId ?? null,
          sentAt: now,
        },
        update: {
          status: "SENT",
          error: null,
          externalId: result.externalId ?? null,
          sentAt: now,
        },
      });
    } else {
      await tx.delivery.upsert({
        where: { digestId_channel: { digestId, channel } },
        create: {
          digestId,
          jobId,
          channel,
          status: "FAILED",
          error: result.error,
        },
        update: {
          status: "FAILED",
          error: result.error,
          externalId: null,
          sentAt: null,
        },
      });
    }

    const event: DomainEvent = result.status === "SENT"
      ? {
          type: "DeliverySucceeded",
          payload: {
            jobId,
            digestId,
            channel,
            ...(result.externalId ? { externalId: result.externalId } : {}),
          },
          aggregateId: jobId,
          aggregateType: "Job",
          version: 1,
          correlationId: null,
          causationId: null,
          metadata: {},
          occurredAt: now,
        }
      : {
          type: "DeliveryFailed",
          payload: { jobId, digestId, channel, error: result.error },
          aggregateId: jobId,
          aggregateType: "Job",
          version: 1,
          correlationId: null,
          causationId: null,
          metadata: {},
          occurredAt: now,
        };

    await persistEvent(tx, event);
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run:
```bash
pnpm --filter @redgest/core exec vitest run src/__tests__/delivery-record.test.ts
```

Expected: All delivery record tests PASS.

- [ ] **Step 9: Export from core index**

In `packages/core/src/index.ts`, add:

```typescript
// Delivery recording
export { recordDeliveryPending, recordDeliveryResult } from "./delivery/record.js";
export type { DeliveryClient, DeliveryTransactionClient } from "./delivery/record.js";
```

- [ ] **Step 10: Run full typecheck and tests**

Run:
```bash
turbo typecheck && turbo test --filter=@redgest/core
```

Expected: All pass.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/delivery/ packages/core/src/__tests__/delivery-record.test.ts packages/core/src/index.ts
git commit -m "feat(core): add delivery record functions with event persistence (#26)"
```

---

## Chunk 2: Query Handler + MCP Tool + Worker Integration

### Task 4: Add GetDeliveryStatus query handler

**Files:**
- Modify: `packages/core/src/queries/types.ts`
- Create: `packages/core/src/queries/handlers/get-delivery-status.ts`
- Modify: `packages/core/src/queries/handlers/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/__tests__/query-handlers.test.ts`

- [ ] **Step 1: Add types to QueryMap and QueryResultMap**

In `packages/core/src/queries/types.ts`, add a result type:

```typescript
export interface DeliveryStatusChannel {
  channel: string;
  status: string;
  error: string | null;
  externalId: string | null;
  sentAt: string | null;
}

export interface DeliveryStatusDigest {
  digestId: string;
  digestCreatedAt: string;
  jobId: string;
  channels: DeliveryStatusChannel[];
}

export interface DeliveryStatusResult {
  digests: DeliveryStatusDigest[];
}
```

Add to `QueryMap`:

```typescript
GetDeliveryStatus: { digestId?: string; limit?: number };
```

Add to `QueryResultMap`:

```typescript
GetDeliveryStatus: DeliveryStatusResult;
```

- [ ] **Step 2: Write failing tests for the handler**

Add to `packages/core/src/__tests__/query-handlers.test.ts`:

```typescript
describe("handleGetDeliveryStatus", () => {
  it("returns delivery status for a specific digest", async () => {
    const mockDigest = { id: "d-1", createdAt: new Date("2026-03-12"), jobId: "j-1" };
    const mockDeliveries = [
      {
        deliveryId: "del-1",
        digestId: "d-1",
        jobId: "j-1",
        channel: "EMAIL",
        status: "SENT",
        error: null,
        externalId: "resend-123",
        sentAt: new Date("2026-03-12T07:01:00Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
        digestCreatedAt: new Date("2026-03-12"),
        jobStatus: "COMPLETED",
      },
    ];
    const mockFindUnique = vi.fn().mockResolvedValue(mockDigest);
    const mockFindMany = vi.fn().mockResolvedValue(mockDeliveries);
    const ctx = makeCtx({
      digest: { findUnique: mockFindUnique },
      deliveryView: { findMany: mockFindMany },
    });

    const result = await handleGetDeliveryStatus({ digestId: "d-1" }, ctx);

    expect(result.digests).toHaveLength(1);
    expect(result.digests[0].digestId).toBe("d-1");
    expect(result.digests[0].channels).toHaveLength(1);
    expect(result.digests[0].channels[0].channel).toBe("EMAIL");
    expect(result.digests[0].digestCreatedAt).toBe("2026-03-12T00:00:00.000Z");
    expect(result.digests[0].channels[0].status).toBe("SENT");
    expect(result.digests[0].channels[0].sentAt).toBe("2026-03-12T07:01:00.000Z");
  });

  it("returns recent digests with delivery status when no digestId", async () => {
    const mockDigests = [
      { id: "d-2", createdAt: new Date("2026-03-12"), jobId: "j-2" },
      { id: "d-1", createdAt: new Date("2026-03-11"), jobId: "j-1" },
    ];
    const mockDeliveries = [
      {
        deliveryId: "del-1",
        digestId: "d-2",
        jobId: "j-2",
        channel: "EMAIL",
        status: "SENT",
        error: null,
        externalId: null,
        sentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        digestCreatedAt: new Date("2026-03-12"),
        jobStatus: "COMPLETED",
      },
    ];
    const mockFindManyDigests = vi.fn().mockResolvedValue(mockDigests);
    const mockFindManyDeliveries = vi.fn().mockResolvedValue(mockDeliveries);
    const ctx = makeCtx({
      digest: { findMany: mockFindManyDigests },
      deliveryView: { findMany: mockFindManyDeliveries },
    });

    const result = await handleGetDeliveryStatus({ limit: 2 }, ctx);

    expect(result.digests).toHaveLength(2);
    expect(result.digests[0].digestId).toBe("d-2");
    expect(result.digests[0].channels).toHaveLength(1);
    expect(result.digests[1].digestId).toBe("d-1");
    expect(result.digests[1].channels).toHaveLength(0); // no deliveries
  });

  it("returns NOT_FOUND error for unknown digestId", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    await expect(
      handleGetDeliveryStatus({ digestId: "unknown" }, ctx),
    ).rejects.toThrow();
  });

  it("clamps limit to max 20", async () => {
    const mockFindManyDigests = vi.fn().mockResolvedValue([]);
    const mockFindManyDeliveries = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      digest: { findMany: mockFindManyDigests },
      deliveryView: { findMany: mockFindManyDeliveries },
    });

    await handleGetDeliveryStatus({ limit: 100 }, ctx);

    expect(mockFindManyDigests).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
pnpm --filter @redgest/core exec vitest run src/__tests__/query-handlers.test.ts
```

Expected: FAIL — `handleGetDeliveryStatus` not found.

- [ ] **Step 4: Implement the handler**

Create `packages/core/src/queries/handlers/get-delivery-status.ts`:

```typescript
import { RedgestError } from "../../errors.js";
import type { QueryHandler } from "../types.js";

export const handleGetDeliveryStatus: QueryHandler<"GetDeliveryStatus"> = async (
  params,
  ctx,
) => {
  const limit = Math.min(params.limit ?? 5, 20);

  if (params.digestId) {
    // Single digest lookup
    const digest = await ctx.db.digest.findUnique({
      where: { id: params.digestId },
      select: { id: true, createdAt: true, jobId: true },
    });

    if (!digest) {
      throw new RedgestError("NOT_FOUND", `Digest ${params.digestId} not found`);
    }

    const deliveries = await ctx.db.deliveryView.findMany({
      where: { digestId: params.digestId },
      orderBy: { channel: "asc" },
    });

    return {
      digests: [
        {
          digestId: digest.id,
          digestCreatedAt: digest.createdAt.toISOString(),
          jobId: digest.jobId,
          channels: deliveries.map((d) => ({
            channel: d.channel,
            status: d.status,
            error: d.error,
            externalId: d.externalId,
            sentAt: d.sentAt?.toISOString() ?? null,
          })),
        },
      ],
    };
  }

  // Recent digests
  const digests = await ctx.db.digest.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, createdAt: true, jobId: true },
  });

  if (digests.length === 0) {
    return { digests: [] };
  }

  const digestIds = digests.map((d) => d.id);
  const deliveries = await ctx.db.deliveryView.findMany({
    where: { digestId: { in: digestIds } },
    orderBy: { channel: "asc" },
  });

  // Group deliveries by digestId
  const deliveriesByDigest = new Map<string, typeof deliveries>();
  for (const d of deliveries) {
    const existing = deliveriesByDigest.get(d.digestId);
    if (existing) {
      existing.push(d);
    } else {
      deliveriesByDigest.set(d.digestId, [d]);
    }
  }

  return {
    digests: digests.map((digest) => {
      const digestDeliveries = deliveriesByDigest.get(digest.id) ?? [];
      return {
        digestId: digest.id,
        digestCreatedAt: digest.createdAt.toISOString(),
        jobId: digest.jobId,
        channels: digestDeliveries.map((d) => ({
          channel: d.channel,
          status: d.status,
          error: d.error,
          externalId: d.externalId,
          sentAt: d.sentAt,
        })),
      };
    }),
  };
};
```

- [ ] **Step 5: Register handler**

In `packages/core/src/queries/handlers/index.ts`, add:

```typescript
import { handleGetDeliveryStatus } from "./get-delivery-status.js";
```

And add to the registry object:

```typescript
GetDeliveryStatus: handleGetDeliveryStatus,
```

- [ ] **Step 6: Export handler from core index**

In `packages/core/src/index.ts`, add `handleGetDeliveryStatus` to the query handler exports and add `DeliveryStatusResult`, `DeliveryStatusDigest` to the query type exports.

- [ ] **Step 7: Run tests to verify they pass**

Run:
```bash
pnpm --filter @redgest/core exec vitest run src/__tests__/query-handlers.test.ts
```

Expected: All tests PASS including new GetDeliveryStatus tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/queries/ packages/core/src/__tests__/query-handlers.test.ts packages/core/src/index.ts
git commit -m "feat(core): add GetDeliveryStatus query handler (#26)"
```

---

### Task 5: Add get_delivery_status MCP tool

**Files:**
- Modify: `packages/mcp-server/src/tools.ts`
- Modify: `packages/mcp-server/src/__tests__/tools.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/mcp-server/src/__tests__/tools.test.ts`:

```typescript
describe("get_delivery_status", () => {
  it("returns delivery status for a specific digest", async () => {
    const { result: deps, query } = createMockDeps();
    const handlers = createToolHandlers(deps);
    query.mockResolvedValue({
      digests: [
        {
          digestId: "d-1",
          digestCreatedAt: "2026-03-12T00:00:00.000Z",
          jobId: "j-1",
          channels: [
            { channel: "EMAIL", status: "SENT", error: null, externalId: "r-1", sentAt: "2026-03-12T07:01:00.000Z" },
          ],
        },
      ],
    });

    const result = await invoke(handlers, "get_delivery_status", { digestId: "d-1" });
    const data = parseEnvelope(result);

    expect(data.ok).toBe(true);
    expect(data.data.digests).toHaveLength(1);
    expect(data.data.digests[0].channels[0].status).toBe("SENT");
    expect(query).toHaveBeenCalledWith("GetDeliveryStatus", { digestId: "d-1" }, expect.anything());
  });

  it("returns recent digests when no digestId", async () => {
    const { result: deps, query } = createMockDeps();
    const handlers = createToolHandlers(deps);
    query.mockResolvedValue({ digests: [] });

    const result = await invoke(handlers, "get_delivery_status", { limit: 3 });
    const data = parseEnvelope(result);

    expect(data.ok).toBe(true);
    expect(query).toHaveBeenCalledWith(
      "GetDeliveryStatus",
      { limit: 3 },
      expect.anything(),
    );
  });

  it("passes default params when no args", async () => {
    const { result: deps, query } = createMockDeps();
    const handlers = createToolHandlers(deps);
    query.mockResolvedValue({ digests: [] });

    await invoke(handlers, "get_delivery_status", {});

    expect(query).toHaveBeenCalledWith("GetDeliveryStatus", {}, expect.anything());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts
```

Expected: FAIL — `get_delivery_status` not in handlers.

- [ ] **Step 3: Add tool handler**

In `packages/mcp-server/src/tools.ts`, add to `createToolHandlers()`:

```typescript
get_delivery_status: async (args) =>
  safe(async () => {
    const params: { digestId?: string; limit?: number } = {};
    if (typeof args.digestId === "string") params.digestId = args.digestId;
    if (typeof args.limit === "number") params.limit = args.limit;

    const result = await deps.query("GetDeliveryStatus", params, deps.ctx);
    return envelope(result);
  }),
```

- [ ] **Step 4: Register tool in createToolServer**

In `packages/mcp-server/src/tools.ts`, add to `createToolServer()`:

```typescript
server.tool(
  "get_delivery_status",
  "Check delivery status for digests across email and Slack channels",
  {
    digestId: z.string().optional().describe("Specific digest ID. If omitted, returns recent digests."),
    limit: z.number().optional().describe("Number of recent digests to check (default 5, max 20). Ignored when digestId is provided."),
  },
  handlers.get_delivery_status,
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts
```

Expected: All tests PASS including new get_delivery_status tests.

- [ ] **Step 6: Run full check**

Run:
```bash
pnpm check
```

Expected: lint + typecheck + tests all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-server/src/tools.ts packages/mcp-server/src/__tests__/tools.test.ts
git commit -m "feat(mcp): add get_delivery_status tool (#26)"
```

---

### Task 6: Integrate delivery recording into worker

**Files:**
- Modify: `apps/worker/src/trigger/deliver-digest.ts`

- [ ] **Step 1: Add imports**

In `apps/worker/src/trigger/deliver-digest.ts`, add:

```typescript
import { recordDeliveryPending, recordDeliveryResult } from "@redgest/core";
```

- [ ] **Step 2: Add PENDING rows before dispatch**

After building the channels array but before `Promise.allSettled`, add:

```typescript
const channelTypes = channels.map((ch) =>
  ch.name === "email" ? "EMAIL" as const : "SLACK" as const,
);
await recordDeliveryPending(prisma, payload.digestId, digest.jobId, channelTypes);
```

Note: The worker needs access to `digest.jobId`. The current code loads the digest — check if `jobId` is available on the loaded digest. If not, add it to the select/include.

- [ ] **Step 3: Record results after Promise.allSettled**

Replace the existing result processing loop with:

```typescript
const delivered: string[] = [];
const channelName = (i: number) => channels[i]?.name;

for (const [i, r] of results.entries()) {
  const name = channelName(i);
  if (!name) continue;
  const channel = name === "email" ? "EMAIL" as const : "SLACK" as const;

  if (r.status === "fulfilled") {
    delivered.push(name);
    const externalId = r.value && typeof r.value === "object" && "id" in r.value
      ? String(r.value.id)
      : undefined;
    await recordDeliveryResult(prisma, payload.digestId, digest.jobId, channel, {
      status: "SENT",
      externalId,
    });
  } else {
    const errorMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    logger.error(`Delivery to ${name} failed: ${errorMsg}`);
    await recordDeliveryResult(prisma, payload.digestId, digest.jobId, channel, {
      status: "FAILED",
      error: errorMsg,
    });
  }
}
```

- [ ] **Step 4: Run typecheck**

Run:
```bash
turbo typecheck --filter=@redgest/worker
```

Expected: PASS. The worker depends on `@redgest/core` which exports the functions.

- [ ] **Step 5: Run full check**

Run:
```bash
pnpm check
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/trigger/deliver-digest.ts
git commit -m "feat(worker): integrate delivery recording into deliver-digest task (#26)"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run:
```bash
pnpm check
```

Expected: lint + typecheck + tests all pass across all packages.

- [ ] **Step 2: Verify test count increased**

Check that new tests are included in the count (should be ~385+ tests, up from 370+).

- [ ] **Step 3: Close the issue**

Run:
```bash
gh issue close 26 --comment "Implemented get_delivery_status tool with delivery tracking table, domain events, query handler, and MCP tool. See commits referencing #26."
```
