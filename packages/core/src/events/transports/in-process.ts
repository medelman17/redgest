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
