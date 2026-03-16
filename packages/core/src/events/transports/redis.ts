import type { DomainEvent, DomainEventType } from "../types.js";
import type { EventBus } from "../bus.js";
import { serializeEvent, deserializeEvent } from "../serialization.js";

const CHANNEL_PREFIX = "redgest:";

type Handler = (event: DomainEvent) => void | Promise<void>;

/**
 * Event bus using Redis PUBLISH/SUBSCRIBE.
 * Requires two connections: one for publishing, one for subscribing
 * (Redis enters pub/sub mode on SUBSCRIBE, blocking normal commands).
 */
export class RedisEventBus implements EventBus {
  private pub: import("ioredis").default;
  private sub: import("ioredis").default;
  private handlers = new Map<string, Set<Handler>>();
  private closed = false;

  private constructor(
    pub: import("ioredis").default,
    sub: import("ioredis").default,
  ) {
    this.pub = pub;
    this.sub = sub;

    this.sub.on("message", (channel: string, message: string) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      const type = channel.slice(CHANNEL_PREFIX.length);
      const handlerSet = this.handlers.get(type);
      if (!handlerSet || handlerSet.size === 0) return;

      try {
        const event = deserializeEvent(message);
        for (const handler of handlerSet) {
          Promise.resolve(handler(event)).catch((err) => {
            console.error(
              `[RedisEventBus] Handler error for ${type}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      } catch (err) {
        console.error(
          `[RedisEventBus] Failed to deserialize event on ${channel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /**
   * Create a RedisEventBus. Uses provided URL or REDIS_URL env var.
   */
  static async create(redisUrl?: string): Promise<RedisEventBus> {
    const url = redisUrl ?? process.env.REDIS_URL;
    if (!url) {
      throw new Error(
        "RedisEventBus: No Redis URL available. Provide redisUrl or set REDIS_URL.",
      );
    }

    let Redis: typeof import("ioredis").default;
    try {
      const mod = await import("ioredis");
      Redis = mod.default;
    } catch {
      throw new Error(
        "RedisEventBus: ioredis is not installed. Install it with: pnpm add ioredis",
      );
    }

    const pub = new Redis(url);
    const sub = new Redis(url);

    return new RedisEventBus(pub, sub);
  }

  async publish(event: DomainEvent): Promise<void> {
    if (this.closed) return;
    const channel = `${CHANNEL_PREFIX}${event.type}`;
    const payload = serializeEvent(event);
    await this.pub.publish(channel, payload);
  }

  subscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    let handlerSet = this.handlers.get(type);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(type, handlerSet);
      const channel = `${CHANNEL_PREFIX}${type}`;
      this.sub.subscribe(channel).catch((err) => {
        console.error(
          `[RedisEventBus] SUBSCRIBE failed for ${channel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    handlerSet.add(handler as Handler);
  }

  unsubscribe<K extends DomainEventType>(
    type: K,
    handler: (event: DomainEvent & { type: K }) => void | Promise<void>,
  ): void {
    const handlerSet = this.handlers.get(type);
    if (handlerSet) {
      handlerSet.delete(handler as Handler);
      if (handlerSet.size === 0) {
        this.handlers.delete(type);
        const channel = `${CHANNEL_PREFIX}${type}`;
        this.sub.unsubscribe(channel).catch(() => {});
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    try {
      await this.sub.unsubscribe();
      this.sub.disconnect();
      this.pub.disconnect();
    } catch {
      // Best-effort cleanup
    }
  }
}
