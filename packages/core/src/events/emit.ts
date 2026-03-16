import type { PrismaClient } from "@redgest/db";
import type { EventBus } from "./bus.js";
import type { DomainEvent, DomainEventType, DomainEventMap } from "./types.js";
import { persistEvent, type EventCreateClient } from "./persist.js";

/**
 * Build, persist, and emit a domain event.
 *
 * Shared by the digest pipeline orchestrator (aggregateType "job") and
 * the crawl pipeline (aggregateType "subreddit").
 *
 * Contains a PrismaClient → EventCreateClient cast at the Prisma type boundary
 * (same pattern as TD-004 in commands/dispatch.ts — Prisma's generated types
 * are stricter than the minimal EventCreateClient interface, but compatible at runtime).
 */
export async function emitDomainEvent<K extends DomainEventType>(
  db: PrismaClient,
  eventBus: EventBus,
  type: K,
  payload: DomainEventMap[K],
  aggregateId: string,
  aggregateType: string,
  organizationId?: string,
): Promise<void> {
  const envelope: Record<string, unknown> = {
    type,
    payload,
    aggregateId,
    aggregateType,
    version: 1,
    organizationId: organizationId ?? null,
    correlationId: null,
    causationId: null,
    metadata: {},
    occurredAt: new Date(),
  };
  const event = envelope as DomainEvent;

  // PrismaClient satisfies EventCreateClient at runtime (TD-004 pattern)
  const client = db as unknown as EventCreateClient;
  await persistEvent(client, event);
  await eventBus.publish(event);
}
