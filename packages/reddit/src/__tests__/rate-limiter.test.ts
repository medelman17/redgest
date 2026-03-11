import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucket } from "../rate-limiter.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to capacity", async () => {
    const bucket = new TokenBucket({ capacity: 3, refillRate: 1 });

    // Should resolve immediately for first 3 requests
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(true).toBe(true); // No timeout = success
  });

  it("blocks when tokens exhausted and resolves after refill", async () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 1 });

    await bucket.acquire(); // Uses the 1 available token

    let resolved = false;
    const pending = bucket.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    // Advance 1 second — refill 1 token
    await vi.advanceTimersByTimeAsync(1000);

    await pending;
    expect(resolved).toBe(true);
  });

  it("queues multiple waiters in FIFO order", async () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 1 });

    await bucket.acquire(); // Drain

    const order: number[] = [];
    const p1 = bucket.acquire().then(() => order.push(1));
    const p2 = bucket.acquire().then(() => order.push(2));

    // Advance 1s — first waiter gets token
    await vi.advanceTimersByTimeAsync(1000);
    // Advance another 1s — second waiter gets token
    await vi.advanceTimersByTimeAsync(1000);

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("sync() adjusts tokens from Reddit headers", async () => {
    const bucket = new TokenBucket({ capacity: 60, refillRate: 1 });

    // Reddit says only 5 remaining with 30s until reset
    bucket.sync(5, 30);

    // Should be able to acquire 5 times
    for (let i = 0; i < 5; i++) {
      await bucket.acquire();
    }

    // 6th should block
    let resolved = false;
    bucket.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
  });

  it("starts with full capacity", async () => {
    const bucket = new TokenBucket({ capacity: 60, refillRate: 1 });

    // Should be able to acquire 60 times without blocking
    for (let i = 0; i < 60; i++) {
      await bucket.acquire();
    }
    expect(true).toBe(true);
  });

  describe("getState", () => {
    it("returns capacity, refillRate, and available tokens", () => {
      const bucket = new TokenBucket({ capacity: 60, refillRate: 1 });

      const state = bucket.getState();

      expect(state).toEqual({
        availableTokens: 60,
        capacity: 60,
        refillRate: 1,
        pendingRequests: 0,
      });
    });

    it("reflects tokens consumed by acquire()", async () => {
      const bucket = new TokenBucket({ capacity: 5, refillRate: 1 });

      await bucket.acquire();
      await bucket.acquire();

      const state = bucket.getState();
      expect(state.availableTokens).toBe(3);
      expect(state.pendingRequests).toBe(0);
    });

    it("reflects pending waiters when tokens exhausted", async () => {
      const bucket = new TokenBucket({ capacity: 1, refillRate: 1 });

      await bucket.acquire(); // Drain the bucket

      // These will queue as waiters
      bucket.acquire();
      bucket.acquire();

      const state = bucket.getState();
      expect(state.availableTokens).toBe(0);
      expect(state.pendingRequests).toBe(2);
    });

    it("reflects sync() adjustments", () => {
      const bucket = new TokenBucket({ capacity: 60, refillRate: 1 });

      bucket.sync(5, 30);

      const state = bucket.getState();
      expect(state.availableTokens).toBe(5);
      expect(state.capacity).toBe(60);
    });
  });
});
