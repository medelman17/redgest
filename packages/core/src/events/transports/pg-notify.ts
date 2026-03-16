import pg from "pg";
import type { DomainEvent, DomainEventType } from "../types.js";
import type { EventBus } from "../bus.js";
import { serializeEvent, deserializeEvent } from "../serialization.js";

const CHANNEL_PREFIX = "redgest:";

type Handler = (event: DomainEvent) => void | Promise<void>;

/**
 * Event bus using Postgres NOTIFY/LISTEN.
 * Zero new infrastructure — reuses the existing Postgres instance.
 *
 * Publishing uses the shared Pool. Subscribing uses a dedicated
 * pg.Client (not from the pool) to maintain persistent LISTEN registrations.
 */
export class PgNotifyEventBus implements EventBus {
  private pool: pg.Pool;
  private listener: pg.Client | null;
  private connectionString: string;
  private handlers = new Map<string, Set<Handler>>();
  private closed = false;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;

  private constructor(pool: pg.Pool, listener: pg.Client, connectionString: string) {
    this.pool = pool;
    this.listener = listener;
    this.connectionString = connectionString;
    this.setupListenerEvents(listener);
  }

  private setupListenerEvents(listener: pg.Client): void {
    listener.on("notification", (msg) => {
      if (!msg.channel.startsWith(CHANNEL_PREFIX) || !msg.payload) return;
      const type = msg.channel.slice(CHANNEL_PREFIX.length);
      const handlerSet = this.handlers.get(type);
      if (!handlerSet || handlerSet.size === 0) return;

      try {
        const event = deserializeEvent(msg.payload);
        for (const handler of handlerSet) {
          Promise.resolve(handler(event)).catch((err) => {
            console.error(
              `[PgNotifyEventBus] Handler error for ${type}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      } catch (err) {
        console.error(
          `[PgNotifyEventBus] Failed to deserialize event on ${msg.channel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    listener.on("error", (err) => {
      console.warn(
        `[PgNotifyEventBus] Listener error: ${err.message}`,
      );
      void this.reconnect();
    });

    listener.on("end", () => {
      if (!this.closed) {
        console.warn("[PgNotifyEventBus] Listener connection ended, reconnecting...");
        void this.reconnect();
      }
    });
  }

  private async reconnect(): Promise<void> {
    if (this.closed) return;
    this.listener = null;

    while (!this.closed) {
      try {
        console.info(
          `[PgNotifyEventBus] Reconnecting in ${this.reconnectDelay}ms...`,
        );
        await new Promise((r) => setTimeout(r, this.reconnectDelay));
        if (this.closed) return;

        const newListener = new pg.Client({
          connectionString: this.connectionString,
        });
        await newListener.connect();

        // Re-issue LISTEN for all active channels
        for (const type of this.handlers.keys()) {
          const channel = `${CHANNEL_PREFIX}${type}`;
          await newListener.query(`LISTEN "${channel}"`);
        }

        this.listener = newListener;
        this.setupListenerEvents(newListener);
        this.reconnectDelay = 1000; // Reset on success
        console.info("[PgNotifyEventBus] Reconnected successfully");
        return;
      } catch (err) {
        console.warn(
          `[PgNotifyEventBus] Reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
      }
    }
  }

  /**
   * Create a PgNotifyEventBus. Fallback chain for connection:
   * 1. Provided pg.Pool
   * 2. New Pool from provided databaseUrl
   * 3. New Pool from DATABASE_URL env var
   */
  static async create(
    pool?: pg.Pool,
    databaseUrl?: string,
  ): Promise<PgNotifyEventBus> {
    const connString = databaseUrl ?? process.env.DATABASE_URL;
    if (!connString) {
      throw new Error(
        "PgNotifyEventBus: No database connection available. Provide databaseUrl or set DATABASE_URL.",
      );
    }

    const resolvedPool = pool ?? new pg.Pool({ connectionString: connString });

    const listener = new pg.Client({ connectionString: connString });
    await listener.connect();

    return new PgNotifyEventBus(resolvedPool, listener, connString);
  }

  async publish(event: DomainEvent): Promise<void> {
    if (this.closed) return;
    const channel = `${CHANNEL_PREFIX}${event.type}`;
    const payload = serializeEvent(event);
    const client = await this.pool.connect();
    try {
      await client.query(`NOTIFY "${channel}", '${payload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
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
      // LISTEN is fire-and-forget — errors logged
      const channel = `${CHANNEL_PREFIX}${type}`;
      if (this.listener) {
        this.listener.query(`LISTEN "${channel}"`).catch((err) => {
          console.error(
            `[PgNotifyEventBus] LISTEN failed for ${channel}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
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
        if (this.listener) {
          this.listener.query(`UNLISTEN "${channel}"`).catch(() => {});
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    try {
      if (this.listener) {
        await this.listener.query("UNLISTEN *");
        await this.listener.end();
      }
    } catch {
      // Best-effort cleanup
    }
  }
}
