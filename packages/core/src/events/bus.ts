import { EventEmitter } from "node:events";
import type { DomainEvent, DomainEventType } from "./types.js";

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
