import { describe, it, expect, vi } from "vitest";
import { DomainEventBus } from "../events/bus.js";
import type { HandlerContext } from "../context.js";
import { handleGetDigest } from "../queries/handlers/get-digest.js";
import { handleGetDigestByJobId } from "../queries/handlers/get-digest-by-job-id.js";
import { handleListDigests } from "../queries/handlers/list-digests.js";
import { handleSearchDigests } from "../queries/handlers/search-digests.js";
import { handleGetPost } from "../queries/handlers/get-post.js";
import { handleSearchPosts } from "../queries/handlers/search-posts.js";
import { handleGetRunStatus } from "../queries/handlers/get-run-status.js";
import { handleListRuns } from "../queries/handlers/list-runs.js";
import { handleListSubreddits } from "../queries/handlers/list-subreddits.js";
import { handleGetConfig } from "../queries/handlers/get-config.js";
import { queryHandlers } from "../queries/handlers/index.js";

/** Cast helper to avoid objectLiteralTypeAssertions lint rule on `{} as T`. */
function stub<T>(): T {
  const empty = {};
  return empty as T;
}

function makeCtx(dbMock: Record<string, unknown>): HandlerContext {
  const db = dbMock;
  return {
    db: db as unknown as HandlerContext["db"],
    eventBus: new DomainEventBus(),
    config: stub<HandlerContext["config"]>(),
  };
}

describe("handleGetDigest", () => {
  it("returns a digest view by digestId", async () => {
    const mockDigest = { digestId: "d-1", contentMarkdown: "# Digest" };
    const mockFindUnique = vi.fn().mockResolvedValue(mockDigest);
    const ctx = makeCtx({ digestView: { findUnique: mockFindUnique } });

    const result = await handleGetDigest({ digestId: "d-1" }, ctx);

    expect(result).toEqual(mockDigest);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { digestId: "d-1" },
    });
  });

  it("returns null when digest not found", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ digestView: { findUnique: mockFindUnique } });

    const result = await handleGetDigest({ digestId: "nonexistent" }, ctx);

    expect(result).toBeNull();
  });
});

describe("handleGetDigestByJobId", () => {
  it("returns digest when found", async () => {
    const fakeDigest = { digestId: "d-1", jobId: "j-1", contentMarkdown: "# Digest" };
    const mockFindFirst = vi.fn().mockResolvedValue(fakeDigest);
    const ctx = makeCtx({ digestView: { findFirst: mockFindFirst } });

    const result = await handleGetDigestByJobId({ jobId: "j-1" }, ctx);

    expect(result).toEqual(fakeDigest);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { jobId: "j-1" },
    });
  });

  it("returns null when no digest exists for jobId", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ digestView: { findFirst: mockFindFirst } });

    const result = await handleGetDigestByJobId({ jobId: "j-999" }, ctx);

    expect(result).toBeNull();
  });
});

describe("handleListDigests", () => {
  it("returns digests ordered by createdAt desc with limit", async () => {
    const mockDigests = [
      { digestId: "d-2", createdAt: new Date() },
      { digestId: "d-1", createdAt: new Date() },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockDigests);
    const ctx = makeCtx({ digestView: { findMany: mockFindMany } });

    const result = await handleListDigests({ limit: 10 }, ctx);

    expect(result).toEqual(mockDigests);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  });

  it("passes undefined take when no limit provided", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ digestView: { findMany: mockFindMany } });

    await handleListDigests({}, ctx);

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: undefined,
    });
  });
});

describe("handleSearchDigests", () => {
  it("searches digests by contentMarkdown case-insensitive", async () => {
    const mockDigests = [{ id: "dig-1", contentMarkdown: "typescript tips" }];
    const mockFindMany = vi.fn().mockResolvedValue(mockDigests);
    const ctx = makeCtx({ digest: { findMany: mockFindMany } });

    const result = await handleSearchDigests(
      { query: "typescript", limit: 5 },
      ctx,
    );

    expect(result).toEqual(mockDigests);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        contentMarkdown: { contains: "typescript", mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });

  it("returns empty array when no matches", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ digest: { findMany: mockFindMany } });

    const result = await handleSearchDigests({ query: "nonexistent" }, ctx);

    expect(result).toEqual([]);
  });
});

describe("handleGetPost", () => {
  it("returns a post view by postId", async () => {
    const mockPost = { postId: "p-1", title: "Test Post" };
    const mockFindUnique = vi.fn().mockResolvedValue(mockPost);
    const ctx = makeCtx({ postView: { findUnique: mockFindUnique } });

    const result = await handleGetPost({ postId: "p-1" }, ctx);

    expect(result).toEqual(mockPost);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { postId: "p-1" },
    });
  });

  it("returns null when post not found", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ postView: { findUnique: mockFindUnique } });

    const result = await handleGetPost({ postId: "nonexistent" }, ctx);

    expect(result).toBeNull();
  });
});

describe("handleSearchPosts", () => {
  it("searches posts by title case-insensitive", async () => {
    const mockPosts = [{ id: "post-1", title: "TypeScript Tips" }];
    const mockFindMany = vi.fn().mockResolvedValue(mockPosts);
    const ctx = makeCtx({ post: { findMany: mockFindMany } });

    const result = await handleSearchPosts(
      { query: "typescript", limit: 10 },
      ctx,
    );

    expect(result).toEqual(mockPosts);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { title: { contains: "typescript", mode: "insensitive" } },
      orderBy: { fetchedAt: "desc" },
      take: 10,
    });
  });

  it("returns empty array when no matches", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ post: { findMany: mockFindMany } });

    const result = await handleSearchPosts({ query: "nothing" }, ctx);

    expect(result).toEqual([]);
  });
});

describe("handleGetRunStatus", () => {
  it("returns a run view by jobId", async () => {
    const mockRun = { jobId: "j-1", status: "COMPLETED" };
    const mockFindUnique = vi.fn().mockResolvedValue(mockRun);
    const ctx = makeCtx({ runView: { findUnique: mockFindUnique } });

    const result = await handleGetRunStatus({ jobId: "j-1" }, ctx);

    expect(result).toEqual(mockRun);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { jobId: "j-1" },
    });
  });

  it("returns null when run not found", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ runView: { findUnique: mockFindUnique } });

    const result = await handleGetRunStatus({ jobId: "nonexistent" }, ctx);

    expect(result).toBeNull();
  });
});

describe("handleListRuns", () => {
  it("returns runs ordered by createdAt desc with limit", async () => {
    const mockRuns = [
      { jobId: "j-2", status: "COMPLETED" },
      { jobId: "j-1", status: "FAILED" },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockRuns);
    const ctx = makeCtx({ runView: { findMany: mockFindMany } });

    const result = await handleListRuns({ limit: 5 }, ctx);

    expect(result).toEqual(mockRuns);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });

  it("passes undefined take when no limit provided", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ runView: { findMany: mockFindMany } });

    await handleListRuns({}, ctx);

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: undefined,
    });
  });
});

describe("handleListSubreddits", () => {
  it("returns all subreddits ordered by name asc", async () => {
    const mockSubs = [
      { id: "s-1", name: "askreddit" },
      { id: "s-2", name: "typescript" },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockSubs);
    const ctx = makeCtx({ subredditView: { findMany: mockFindMany } });

    const emptyParams = stub<Record<string, never>>();
    const result = await handleListSubreddits(emptyParams, ctx);

    expect(result).toEqual(mockSubs);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
    });
  });

  it("returns empty array when no subreddits exist", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ subredditView: { findMany: mockFindMany } });

    const emptyParams = stub<Record<string, never>>();
    const result = await handleListSubreddits(emptyParams, ctx);

    expect(result).toEqual([]);
  });
});

describe("handleGetConfig", () => {
  it("returns the singleton config", async () => {
    const mockConfig = { id: 1, llmModel: "claude-sonnet-4-20250514" };
    const mockFindFirst = vi.fn().mockResolvedValue(mockConfig);
    const ctx = makeCtx({ config: { findFirst: mockFindFirst } });

    const emptyParams = stub<Record<string, never>>();
    const result = await handleGetConfig(emptyParams, ctx);

    expect(result).toEqual(mockConfig);
    expect(mockFindFirst).toHaveBeenCalledWith();
  });

  it("returns null when no config exists", async () => {
    const mockFindFirst = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ config: { findFirst: mockFindFirst } });

    const emptyParams = stub<Record<string, never>>();
    const result = await handleGetConfig(emptyParams, ctx);

    expect(result).toBeNull();
  });
});

describe("handleGetLlmMetrics", () => {
  it("returns aggregated metrics for a specific job", async () => {
    const mockAggregate = vi.fn().mockResolvedValue({
      _count: { _all: 5 },
      _sum: { inputTokens: 50000, outputTokens: 8000 },
      _avg: { durationMs: 2500 },
    });
    const mockCount = vi.fn().mockResolvedValue(2);
    const mockGroupBy = vi.fn()
      .mockResolvedValueOnce([
        {
          task: "triage",
          _count: { _all: 2 },
          _sum: { inputTokens: 16000, outputTokens: 2000 },
          _avg: { durationMs: 1500 },
        },
        {
          task: "summarize",
          _count: { _all: 3 },
          _sum: { inputTokens: 34000, outputTokens: 6000 },
          _avg: { durationMs: 3200 },
        },
      ])
      .mockResolvedValueOnce([
        { task: "triage", _count: { _all: 1 } },
        { task: "summarize", _count: { _all: 1 } },
      ]);
    const ctx = makeCtx({
      llmCall: {
        aggregate: mockAggregate,
        count: mockCount,
        groupBy: mockGroupBy,
      },
    });

    const { handleGetLlmMetrics } = await import(
      "../queries/handlers/get-llm-metrics.js"
    );
    const result = await handleGetLlmMetrics({ jobId: "j-1" }, ctx);

    expect(result.summary).toEqual({
      totalCalls: 5,
      totalInputTokens: 50000,
      totalOutputTokens: 8000,
      averageDurationMs: 2500,
      cacheHitRate: 0.4,
    });
    expect(result.byTask).toHaveLength(2);
    expect(result.byTask[0]).toEqual({
      task: "triage",
      calls: 2,
      inputTokens: 16000,
      outputTokens: 2000,
      avgDurationMs: 1500,
      cacheHitRate: 0.5,
    });
    expect(result.byTask[1]).toEqual({
      task: "summarize",
      calls: 3,
      inputTokens: 34000,
      outputTokens: 6000,
      avgDurationMs: 3200,
      cacheHitRate: expect.closeTo(0.333, 2),
    });
  });

  it("returns metrics for recent jobs when no jobId provided", async () => {
    const mockAggregate = vi.fn().mockResolvedValue({
      _count: { _all: 10 },
      _sum: { inputTokens: 100000, outputTokens: 15000 },
      _avg: { durationMs: 3000 },
    });
    const mockCount = vi.fn().mockResolvedValue(4);
    const mockGroupBy = vi.fn()
      .mockResolvedValueOnce([
        {
          task: "triage",
          _count: { _all: 4 },
          _sum: { inputTokens: 32000, outputTokens: 4000 },
          _avg: { durationMs: 1800 },
        },
        {
          task: "summarize",
          _count: { _all: 6 },
          _sum: { inputTokens: 68000, outputTokens: 11000 },
          _avg: { durationMs: 3800 },
        },
      ])
      .mockResolvedValueOnce([
        { task: "triage", _count: { _all: 2 } },
        { task: "summarize", _count: { _all: 2 } },
      ]);
    const mockFindMany = vi.fn().mockResolvedValue([
      { jobId: "j-3" },
      { jobId: "j-2" },
      { jobId: "j-1" },
    ]);
    const ctx = makeCtx({
      llmCall: {
        aggregate: mockAggregate,
        count: mockCount,
        groupBy: mockGroupBy,
        findMany: mockFindMany,
      },
    });

    const { handleGetLlmMetrics } = await import(
      "../queries/handlers/get-llm-metrics.js"
    );
    const result = await handleGetLlmMetrics({ limit: 3 }, ctx);

    expect(result.summary.totalCalls).toBe(10);
    expect(result.summary.cacheHitRate).toBe(0.4);
    expect(result.byTask).toHaveLength(2);
    // Verify findMany was called to get recent job IDs
    expect(mockFindMany).toHaveBeenCalled();
  });

  it("returns zero metrics when no LLM calls found", async () => {
    const mockAggregate = vi.fn().mockResolvedValue({
      _count: { _all: 0 },
      _sum: { inputTokens: null, outputTokens: null },
      _avg: { durationMs: null },
    });
    const mockCount = vi.fn().mockResolvedValue(0);
    const mockGroupBy = vi.fn().mockResolvedValue([]);
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      llmCall: {
        aggregate: mockAggregate,
        count: mockCount,
        groupBy: mockGroupBy,
        findMany: mockFindMany,
      },
    });

    const { handleGetLlmMetrics } = await import(
      "../queries/handlers/get-llm-metrics.js"
    );
    const result = await handleGetLlmMetrics({}, ctx);

    expect(result.summary).toEqual({
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      averageDurationMs: 0,
      cacheHitRate: 0,
    });
    expect(result.byTask).toEqual([]);
  });
});

describe("queryHandlers registry", () => {
  it("registers all 11 handlers", () => {
    expect(queryHandlers.GetDigest).toBe(handleGetDigest);
    expect(queryHandlers.GetDigestByJobId).toBe(handleGetDigestByJobId);
    expect(queryHandlers.ListDigests).toBe(handleListDigests);
    expect(queryHandlers.SearchDigests).toBe(handleSearchDigests);
    expect(queryHandlers.GetPost).toBe(handleGetPost);
    expect(queryHandlers.SearchPosts).toBe(handleSearchPosts);
    expect(queryHandlers.GetRunStatus).toBe(handleGetRunStatus);
    expect(queryHandlers.ListRuns).toBe(handleListRuns);
    expect(queryHandlers.ListSubreddits).toBe(handleListSubreddits);
    expect(queryHandlers.GetConfig).toBe(handleGetConfig);
    expect(queryHandlers.GetLlmMetrics).toBeDefined();
  });

  it("has exactly 11 entries", () => {
    const handlerCount = Object.keys(queryHandlers).length;
    expect(handlerCount).toBe(11);
  });
});
