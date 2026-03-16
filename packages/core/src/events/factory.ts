import type { RedgestConfig } from "@redgest/config";
import type { EventBus } from "./bus.js";

export type EventBusTransport = RedgestConfig["EVENT_BUS_TRANSPORT"];

export interface EventBusOptions {
  transport?: EventBusTransport;
  /** pg.Pool instance for pg-notify transport (shares connection pool with Prisma). */
  pgPool?: import("pg").Pool;
  /** Redis URL for redis transport. */
  redisUrl?: string;
  /** Database URL for pg-notify transport (used if pgPool not provided). */
  databaseUrl?: string;
}

/**
 * Create an EventBus instance for the specified transport.
 * Dynamic imports keep PG and Redis dependencies lazy.
 */
export async function createEventBus(
  options?: EventBusOptions,
): Promise<EventBus> {
  const transport = options?.transport ?? "memory";

  switch (transport) {
    case "memory": {
      const { InProcessEventBus } = await import(
        "./transports/in-process.js"
      );
      return new InProcessEventBus();
    }
    case "pg-notify": {
      const { PgNotifyEventBus } = await import(
        "./transports/pg-notify.js"
      );
      return PgNotifyEventBus.create(options?.pgPool, options?.databaseUrl);
    }
    case "redis": {
      const { RedisEventBus } = await import("./transports/redis.js");
      return RedisEventBus.create(options?.redisUrl);
    }
    default: {
      const _exhaustive: never = transport;
      throw new Error(`Unknown event bus transport: ${String(_exhaustive)}`);
    }
  }
}
