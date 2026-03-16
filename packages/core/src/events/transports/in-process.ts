import type { DomainEvent, DomainEventType } from "../types";
import type { EventBus } from "../bus";

type Handler = (event: DomainEvent) => void | Promise<void>;

/**
 * In-process event bus backed by a simple Map of handler sets.
 * Default transport — zero dependencies, single-process only.
 */
export class InProcessEventBus implements EventBus {
  private handlers = new Map<string, Set<Handler>>();

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
    let handlerSet = this.handlers.get(type);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(type, handlerSet);
    }
    handlerSet.add(handler as Handler);
  }

  unsubscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    this.handlers.get(type)?.delete(handler as Handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
