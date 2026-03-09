import { EventEmitter } from "node:events";

export class DomainEventBus {
  private emitter = new EventEmitter();
}
