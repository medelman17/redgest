# Design: `get_delivery_status` MCP Tool

**Issue:** #26 — Add get_delivery_status tool for delivery tracking
**Date:** 2026-03-12
**Status:** Draft

## Problem

Phase 2 adds email/Slack delivery via the `deliver-digest` Trigger.dev task, but delivery results are not persisted. There is no way to check whether a digest was actually delivered or why delivery failed. The task uses `Promise.allSettled` and logs errors to console, but results are discarded after the task completes.

## Solution

Add a `deliveries` table to persist per-channel delivery outcomes, emit domain events for delivery results, and expose a `get_delivery_status` MCP tool for querying delivery history.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | New `deliveries` table + domain events | Follows CQRS pattern: table for queries, events for reactivity. Avoids complex event aggregation queries. |
| Granularity | Latest attempt per channel per digest | At personal scale, current state matters more than full audit trail. Event log preserves history if needed. |
| Tool interface | Optional `digestId` + `limit` | Supports both "check this digest" and "are my deliveries working in general?" use cases. |
| Recipient info | Not stored | Recipient info is current config, queryable via `get_config`. Avoids duplication and sensitivity concerns. |

## Data Model

### New Enum: `DeliveryChannelType`

```prisma
enum DeliveryChannelType {
  EMAIL
  SLACK
}
```

Separate from the existing `DeliveryChannel` enum (`NONE`, `EMAIL`, `SLACK`, `ALL`) which is a config value on jobs. `DeliveryChannelType` represents an actual channel a delivery was attempted on.

### New Enum: `DeliveryStatus`

```prisma
enum DeliveryStatus {
  PENDING
  SENT
  FAILED
}
```

### New Table: `deliveries`

```prisma
model Delivery {
  id         String              @id @default(dbgenerated("gen_random_uuid()"))
  digestId   String
  jobId      String
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

- UUID v7 primary key (consistent with all other tables)
- `@@unique([digestId, channel])` enforces one row per channel per digest (upsert on retry)
- `externalId` captures provider-specific IDs (e.g., Resend message ID)
- `sentAt` records when delivery succeeded (distinct from `createdAt` which is row creation)

### Relation Additions

Add `deliveries Delivery[]` relation to both `Digest` and `Job` models.

### New View: `delivery_view`

```sql
CREATE OR REPLACE VIEW delivery_view AS
SELECT
  d.id AS delivery_id,
  d.digest_id,
  d.job_id,
  d.channel,
  d.status,
  d.error,
  d.external_id,
  d.sent_at,
  d.created_at,
  d.updated_at,
  dig.created_at AS digest_created_at,
  j.status AS job_status
FROM deliveries d
JOIN digests dig ON d.digest_id = dig.id
JOIN jobs j ON d.job_id = j.id
ORDER BY dig.created_at DESC, d.channel ASC;
```

## Domain Events

Two new events added to `DomainEventMap`:

```typescript
DeliverySucceeded: {
  jobId: string;
  digestId: string;
  channel: "EMAIL" | "SLACK";
  externalId?: string;
}

DeliveryFailed: {
  jobId: string;
  digestId: string;
  channel: "EMAIL" | "SLACK";
  error: string;
}
```

Corresponding Zod schemas added to `eventPayloadSchemas`.

## Worker Changes (`deliver-digest` task)

### Current Flow

1. Load digest with relations
2. Build delivery data via `buildDeliveryData()`
3. Map configured channels to send functions
4. `Promise.allSettled(channels.map(c => c.send()))`
5. Log errors, return `{ delivered: string[] }`

### New Flow

1. Load digest with relations
2. Build delivery data via `buildDeliveryData()`
3. Map configured channels to send functions
4. **Create `PENDING` delivery rows** for each channel via `recordDeliveryPending()`
5. `Promise.allSettled(channels.map(c => c.send()))`
6. **Upsert delivery rows** to `SENT` or `FAILED` via `recordDeliveryResult()`
7. **Persist domain events** (`DeliverySucceeded` / `DeliveryFailed`) via `persistEvent()`
8. Log errors, return `{ delivered: string[] }` (no breaking change)

### Extracted Functions

```typescript
// In @redgest/core or a shared location accessible by worker
async function recordDeliveryPending(
  db: PrismaClient,
  digestId: string,
  jobId: string,
  channels: DeliveryChannelType[]
): Promise<void>

async function recordDeliveryResult(
  db: PrismaClient,
  digestId: string,
  channel: DeliveryChannelType,
  result: { status: "SENT"; externalId?: string } | { status: "FAILED"; error: string }
): Promise<void>
```

These are extracted for testability — the Trigger.dev task calls them, but they can be unit tested independently.

## Query Handler

### `GetDeliveryStatus`

Added to `QueryMap`:

```typescript
GetDeliveryStatus: {
  params: { digestId?: string; limit?: number };
  result: {
    digests: Array<{
      digestId: string;
      digestCreatedAt: string;
      jobId: string;
      channels: Array<{
        channel: "EMAIL" | "SLACK";
        status: "PENDING" | "SENT" | "FAILED";
        error?: string;
        externalId?: string;
        sentAt?: string;
      }>;
    }>;
  };
};
```

**Behavior:**
- If `digestId` provided: return deliveries for that digest. Error if digest not found.
- If `digestId` omitted: return deliveries for the most recent `limit` digests (default 5, max 20).
- Groups rows by digest, nests channel results.
- Digest with no delivery rows returns empty `channels: []` (delivery not attempted).

**Implementation:** Query from `delivery_view`, group in handler code.

## MCP Tool

```typescript
{
  name: "get_delivery_status",
  description: "Check delivery status for digests across email and Slack channels",
  parameters: {
    digestId: { type: "string", description: "Specific digest ID. If omitted, returns recent digests." },
    limit: { type: "number", description: "Number of recent digests to check (default 5, max 20). Ignored when digestId is provided." }
  }
}
```

**Response:** `envelope({ digests: [...] })` with the shape from the query handler.

**Error cases:**
- `digestId` not found: `envelopeError("NOT_FOUND", "Digest not found")`
- No deliveries for valid digest: success with empty `channels: []`

## Testing

- **Query handler unit tests:** Mock DB responses, verify grouping logic, `digestId` vs `limit` behavior, max limit clamping, not-found error.
- **Event schema tests:** Zod validation for `DeliverySucceeded` and `DeliveryFailed` payloads.
- **`recordDeliveryPending` / `recordDeliveryResult` unit tests:** Verify correct Prisma calls, upsert behavior, status transitions.
- **MCP tool integration:** Verify envelope shape, parameter validation, error responses.

## Files Changed

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `DeliveryChannelType` enum, `DeliveryStatus` enum, `Delivery` model, relations on `Digest` and `Job` |
| `packages/db/prisma/migrations/*/migration.sql` | New migration + `delivery_view` |
| `packages/core/src/events/types.ts` | Add `DeliverySucceeded`, `DeliveryFailed` to `DomainEventMap` |
| `packages/core/src/events/schemas.ts` | Add Zod schemas for new events |
| `packages/core/src/queries/types.ts` | Add `GetDeliveryStatus` to `QueryMap` |
| `packages/core/src/queries/handlers/get-delivery-status.ts` | New query handler |
| `packages/core/src/delivery/record.ts` | New `recordDeliveryPending()` and `recordDeliveryResult()` functions |
| `apps/worker/src/trigger/deliver-digest.ts` | Integrate delivery recording + event emission |
| `packages/mcp-server/src/tools.ts` | Add `get_delivery_status` tool |
| Test files | Unit tests for handler, events, record functions |
