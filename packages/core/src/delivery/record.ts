import type { EventCreateClient } from "../events/persist";
import { persistEvent } from "../events/persist";

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
      update: {
        status: string;
        error: null;
        externalId: null;
        sentAt: null;
      };
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

/** Shared envelope fields for delivery domain events. */
function deliveryEventEnvelope(digestId: string, jobId: string, occurredAt: Date) {
  return {
    aggregateId: digestId,
    aggregateType: "Delivery" as const,
    version: 1,
    correlationId: jobId,
    causationId: null,
    metadata: {},
    occurredAt,
  };
}

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
  await Promise.all(
    channels.map((channel) =>
      db.delivery.upsert({
        where: { digestId_channel: { digestId, channel } },
        create: {
          digestId,
          jobId,
          channel,
          status: "PENDING",
        },
        update: {
          status: "PENDING",
          error: null,
          externalId: null,
          sentAt: null,
        },
      }),
    ),
  );
}

/**
 * Upsert a delivery row to SENT or FAILED, and persist the corresponding
 * domain event — both within the same transaction client.
 *
 * Does NOT publish to the EventBus (caller is responsible for that if needed).
 * This is intentional: the worker runs outside the MCP server process,
 * so the event bus isn't wired to dispatch handlers.
 */
export async function recordDeliveryResult(
  tx: DeliveryTransactionClient,
  digestId: string,
  jobId: string,
  channel: DeliveryChannelType,
  result: DeliveryResult,
): Promise<void> {
  const now = new Date();

  if (result.ok) {
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

    await persistEvent(tx, {
      type: "DeliverySucceeded",
      payload,
      ...deliveryEventEnvelope(digestId, jobId, now),
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
      },
    });

    await persistEvent(tx, {
      type: "DeliveryFailed",
      payload: { jobId, digestId, channel, error: result.error },
      ...deliveryEventEnvelope(digestId, jobId, now),
    });
  }
}
