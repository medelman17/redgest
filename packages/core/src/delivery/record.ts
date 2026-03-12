import type { EventCreateClient } from "../events/persist.js";
import { persistEvent } from "../events/persist.js";
import type { DomainEvent } from "../events/types.js";

type DeliveryChannelType = "EMAIL" | "SLACK";

/**
 * Minimal interface for the DB client used by recordDeliveryPending.
 * Requires only delivery.upsert — keeps the function testable with mocks.
 */
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
      update: Record<string, never>;
    }) => Promise<unknown>;
  };
}

/**
 * Minimal interface for the transaction client used by recordDeliveryResult.
 * Needs delivery.upsert + event.create (via EventCreateClient).
 */
export interface DeliveryTransactionClient extends EventCreateClient {
  delivery: {
    upsert: (args: {
      where: { digestId_channel: { digestId: string; channel: string } };
      create: {
        digestId: string;
        jobId: string;
        channel: string;
        status: string;
        externalId?: string;
        error?: string;
        sentAt?: Date;
      };
      update: {
        status: string;
        externalId?: string;
        error?: string | null;
        sentAt?: Date;
      };
    }) => Promise<unknown>;
  };
}

type DeliverySuccess = { ok: true; externalId?: string };
type DeliveryFailure = { ok: false; error: string };
type DeliveryResult = DeliverySuccess | DeliveryFailure;

/**
 * Upsert PENDING delivery rows for each channel.
 * Uses upsert (not create) for Trigger.dev retry idempotency —
 * re-running this on retry won't fail if the row already exists.
 */
export async function recordDeliveryPending(
  db: DeliveryClient,
  digestId: string,
  jobId: string,
  channels: DeliveryChannelType[],
): Promise<void> {
  for (const channel of channels) {
    await db.delivery.upsert({
      where: { digestId_channel: { digestId, channel } },
      create: {
        digestId,
        jobId,
        channel,
        status: "PENDING",
      },
      update: {},
    });
  }
}

/**
 * Upsert a delivery row to SENT or FAILED, and persist the corresponding
 * domain event — both within the same transaction client.
 *
 * Does NOT emit to DomainEventBus (caller is responsible for that if needed).
 * This is intentional: the worker runs outside the MCP server process,
 * so the in-process event bus isn't available.
 */
export async function recordDeliveryResult(
  tx: DeliveryTransactionClient,
  digestId: string,
  jobId: string,
  channel: DeliveryChannelType,
  result: DeliveryResult,
): Promise<void> {
  if (result.ok) {
    const now = new Date();
    await tx.delivery.upsert({
      where: { digestId_channel: { digestId, channel } },
      create: {
        digestId,
        jobId,
        channel,
        status: "SENT",
        externalId: result.externalId,
        sentAt: now,
      },
      update: {
        status: "SENT",
        externalId: result.externalId,
        sentAt: now,
        error: null,
      },
    });

    const payload: { jobId: string; digestId: string; channel: DeliveryChannelType; externalId?: string } =
      result.externalId !== undefined
        ? { jobId, digestId, channel, externalId: result.externalId }
        : { jobId, digestId, channel };

    const event: DomainEvent = {
      type: "DeliverySucceeded",
      payload,
      aggregateId: digestId,
      aggregateType: "delivery",
      version: 1,
      correlationId: jobId,
      causationId: null,
      metadata: {},
      occurredAt: now,
    };

    await persistEvent(tx, event);
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
      },
    });

    const event: DomainEvent = {
      type: "DeliveryFailed",
      payload: { jobId, digestId, channel, error: result.error },
      aggregateId: digestId,
      aggregateType: "delivery",
      version: 1,
      correlationId: jobId,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    await persistEvent(tx, event);
  }
}
