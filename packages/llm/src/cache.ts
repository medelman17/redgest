import { createHash } from "node:crypto";

// Lazy-loaded Redis client — only created if REDIS_URL is set
let redisClient: import("ioredis").default | null = null;
let redisInitAttempted = false;

async function getRedis(): Promise<import("ioredis").default | null> {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const { default: Redis } = await import("ioredis");
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redisClient.connect();
    return redisClient;
  } catch {
    console.warn("[llm-cache] Redis unavailable, caching disabled");
    redisClient = null;
    return null;
  }
}

/** Generate a cache key from input data. */
export function hashKey(prefix: string, data: unknown): string {
  const json = JSON.stringify(data);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  return `redgest:${prefix}:${hash}`;
}

/** TTLs in seconds */
const TTL = {
  triage: 2 * 60 * 60, // 2 hours
  summary: 7 * 24 * 60 * 60, // 7 days
  "delivery-email": 7 * 24 * 60 * 60, // 7 days
  "delivery-slack": 7 * 24 * 60 * 60, // 7 days
} as const;

export interface CacheResult<T> {
  data: T;
  cached: boolean;
}

/**
 * Try to get a cached result; if miss, call fn() and cache the result.
 * Gracefully falls back to fn() if Redis is unavailable.
 */
export async function withCache<T>(
  taskType: keyof typeof TTL,
  inputs: unknown,
  fn: () => Promise<T>,
): Promise<CacheResult<T>> {
  const redis = await getRedis();
  if (!redis) {
    return { data: await fn(), cached: false };
  }

  const key = hashKey(taskType, inputs);

  try {
    const cached = await redis.get(key);
    if (cached) {
      return { data: JSON.parse(cached) as T, cached: true };
    }
  } catch {
    // Redis read failed — proceed without cache
  }

  const data = await fn();

  try {
    await redis.set(key, JSON.stringify(data), "EX", TTL[taskType]);
  } catch {
    // Redis write failed — that's fine, result still returned
  }

  return { data, cached: false };
}

/** Disconnect Redis client (for cleanup/testing). */
export async function disconnectCache(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redisInitAttempted = false;
  }
}

/**
 * Reset internal state without connecting to Redis (for testing).
 * @internal
 */
export function _resetCacheState(): void {
  redisClient = null;
  redisInitAttempted = false;
}
