import type { DomainEvent } from "./types";

/**
 * Minimal interface for the transaction client's event model.
 * Avoids importing PrismaClient directly — keeps persist testable with mocks.
 */
export interface EventCreateClient {
  event: {
    create: (args: {
      data: {
        type: string;
        payload: unknown;
        aggregateId: string;
        aggregateType: string;
        version: number;
        organizationId?: string | null;
        correlationId: string | null;
        causationId: string | null;
        metadata: unknown;
      };
    }) => Promise<unknown>;
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
      organizationId: event.organizationId ?? null,
      correlationId: event.correlationId,
      causationId: event.causationId,
      metadata: event.metadata,
    },
  });
}
