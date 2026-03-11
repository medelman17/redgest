export interface TokenBucketOptions {
  /** Max tokens in the bucket */
  capacity: number;
  /** Tokens added per second */
  refillRate: number;
}

/**
 * Token bucket rate limiter for Reddit API (60 req/min).
 *
 * acquire() returns a promise that resolves when a token is available.
 * sync() adjusts token count from Reddit's X-Ratelimit headers.
 */
export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private lastRefill: number;
  private readonly waiters: Array<() => void> = [];
  private refillTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillRate = options.refillRate;
    this.tokens = options.capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Acquire a token. Resolves immediately if available,
   * otherwise queues and resolves when a token is refilled.
   */
  acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }

    // No tokens — queue the waiter and start refill timer
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.startRefillTimer();
    });
  }

  /**
   * Sync token count with Reddit's rate limit headers.
   * Called after each API response.
   */
  sync(remaining: number, resetSeconds: number): void {
    this.tokens = Math.min(remaining, this.capacity);
    this.lastRefill = Date.now();

    // If Reddit says reset in N seconds, adjust refill timing
    if (resetSeconds > 0 && remaining === 0) {
      this.tokens = 0;
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;

    if (newTokens >= 1) {
      this.tokens = Math.min(this.capacity, this.tokens + Math.floor(newTokens));
      this.lastRefill = now;
    }
  }

  private startRefillTimer(): void {
    if (this.refillTimer) return;

    const intervalMs = Math.ceil(1000 / this.refillRate);
    this.refillTimer = setInterval(() => {
      this.refill();
      this.drainWaiters();

      if (this.waiters.length === 0 && this.refillTimer) {
        clearInterval(this.refillTimer);
        this.refillTimer = null;
      }
    }, intervalMs);
  }

  /** Snapshot of current rate limiter state for diagnostics. */
  getState(): {
    availableTokens: number;
    capacity: number;
    refillRate: number;
    pendingRequests: number;
  } {
    this.refill();
    return {
      availableTokens: this.tokens,
      capacity: this.capacity,
      refillRate: this.refillRate,
      pendingRequests: this.waiters.length,
    };
  }

  private drainWaiters(): void {
    while (this.waiters.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const waiter = this.waiters.shift();
      if (waiter) waiter();
    }
  }
}
