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
