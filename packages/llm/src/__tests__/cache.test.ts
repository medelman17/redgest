import { describe, it, expect, beforeEach } from "vitest";
import { hashKey, withCache, disconnectCache, _resetCacheState } from "../cache.js";

describe("hashKey", () => {
  it("produces consistent keys for the same input", () => {
    const data = { posts: [1, 2], prompts: ["test"] };
    const key1 = hashKey("triage", data);
    const key2 = hashKey("triage", data);
    expect(key1).toBe(key2);
  });

  it("produces different keys for different prefixes", () => {
    const data = { foo: "bar" };
    const key1 = hashKey("triage", data);
    const key2 = hashKey("summary", data);
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different data", () => {
    const key1 = hashKey("triage", { a: 1 });
    const key2 = hashKey("triage", { a: 2 });
    expect(key1).not.toBe(key2);
  });

  it("includes the prefix in the key", () => {
    const key = hashKey("triage", { test: true });
    expect(key).toMatch(/^redgest:triage:/);
  });

  it("produces a 16-char hex hash suffix", () => {
    const key = hashKey("summary", { data: "test" });
    const parts = key.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[2]).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("withCache", () => {
  beforeEach(() => {
    _resetCacheState();
    delete process.env.REDIS_URL;
  });

  it("calls fn() when no Redis URL is set", async () => {
    const fn = async () => ({ result: 42 });
    const { data, cached } = await withCache("triage", { key: "val" }, fn);

    expect(data).toEqual({ result: 42 });
    expect(cached).toBe(false);
  });

  it("returns cached: false when Redis is unavailable", async () => {
    const fn = async () => "hello";
    const { data, cached } = await withCache("summary", {}, fn);

    expect(data).toBe("hello");
    expect(cached).toBe(false);
  });

  it("always calls fn exactly once when Redis is unavailable", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return callCount;
    };

    const result1 = await withCache("triage", { key: 1 }, fn);
    const result2 = await withCache("triage", { key: 1 }, fn);

    expect(result1.data).toBe(1);
    expect(result2.data).toBe(2);
    expect(callCount).toBe(2);
  });
});

describe("disconnectCache", () => {
  beforeEach(() => {
    _resetCacheState();
    delete process.env.REDIS_URL;
  });

  it("is safe to call when not connected", async () => {
    // Should not throw
    await disconnectCache();
  });

  it("is safe to call multiple times", async () => {
    await disconnectCache();
    await disconnectCache();
  });
});
