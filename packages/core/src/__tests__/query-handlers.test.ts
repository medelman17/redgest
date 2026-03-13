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
import { handleGetSubredditStats } from "../queries/handlers/get-subreddit-stats.js";
import { handleCompareDigests } from "../queries/handlers/compare-digests.js";
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
  it("returns paginated digests ordered by createdAt desc", async () => {
    const mockDigests = [
      { digestId: "d-2", createdAt: new Date() },
      { digestId: "d-1", createdAt: new Date() },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockDigests);
    const ctx = makeCtx({ digestView: { findMany: mockFindMany } });

    const result = await handleListDigests({ limit: 10 }, ctx);

    expect(result.items).toEqual(mockDigests);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 11,
    });
  });

  it("uses default page size when no limit provided", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ digestView: { findMany: mockFindMany } });

    await handleListDigests({}, ctx);

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 11,
    });
  });

  it("sets hasMore and nextCursor when more items exist", async () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      digestId: `d-${i}`,
      createdAt: new Date(),
    }));
    const mockFindMany = vi.fn().mockResolvedValue(items);
    const ctx = makeCtx({ digestView: { findMany: mockFindMany } });

    const result = await handleListDigests({ limit: 10 }, ctx);

    expect(result.items).toHaveLength(10);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("d-9");
  });

  it("passes cursor to findMany when provided", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ digestView: { findMany: mockFindMany } });

    await handleListDigests({ limit: 5, cursor: "d-prev" }, ctx);

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 6,
      cursor: { digestId: "d-prev" },
      skip: 1,
    });
  });
});

describe("handleSearchDigests", () => {
  it("delegates to searchService.searchByKeyword", async () => {
    const mockResults = [
      { postId: "p-1", title: "typescript tips", subreddit: "typescript", score: 100, redditId: "t3_abc", summarySnippet: null, matchHighlights: [], relevanceRank: 1, sentiment: null, digestId: null, digestDate: null },
    ];
    const mockSearchService = { searchByKeyword: vi.fn().mockResolvedValue(mockResults), searchBySimilarity: vi.fn(), findSimilar: vi.fn(), searchHybrid: vi.fn() };
    const ctx = { ...makeCtx({}), searchService: mockSearchService };

    const result = await handleSearchDigests(
      { query: "typescript", limit: 5 },
      ctx,
    );

    expect(result).toEqual(mockResults);
    expect(mockSearchService.searchByKeyword).toHaveBeenCalledWith("typescript", {
      limit: 5,
      subreddit: undefined,
    });
  });

  it("throws when searchService not available", async () => {
    const ctx = makeCtx({});
    await expect(handleSearchDigests({ query: "test" }, ctx)).rejects.toThrow(
      "SearchService not available",
    );
  });

  it("passes since as a Date when provided", async () => {
    const mockSearchService = { searchByKeyword: vi.fn().mockResolvedValue([]), searchBySimilarity: vi.fn(), findSimilar: vi.fn(), searchHybrid: vi.fn() };
    const ctx = { ...makeCtx({}), searchService: mockSearchService };

    await handleSearchDigests({ query: "test", since: "7d" }, ctx);

    const callArgs = mockSearchService.searchByKeyword.mock.calls[0];
    expect(callArgs).toBeDefined();
    const options = callArgs?.[1];
    expect(options?.since).toBeInstanceOf(Date);
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
  it("delegates to searchService.searchByKeyword", async () => {
    const mockResults = [
      { postId: "p-1", title: "TypeScript Tips", subreddit: "typescript", score: 100, redditId: "t3_abc", summarySnippet: null, matchHighlights: [], relevanceRank: 1, sentiment: null, digestId: null, digestDate: null },
    ];
    const mockSearchService = { searchByKeyword: vi.fn().mockResolvedValue(mockResults), searchBySimilarity: vi.fn(), findSimilar: vi.fn(), searchHybrid: vi.fn() };
    const ctx = { ...makeCtx({}), searchService: mockSearchService };

    const result = await handleSearchPosts(
      { query: "typescript", limit: 10 },
      ctx,
    );

    expect(result).toEqual(mockResults);
    expect(mockSearchService.searchByKeyword).toHaveBeenCalledWith("typescript", {
      limit: 10,
      subreddit: undefined,
      sentiment: undefined,
      minScore: undefined,
    });
  });

  it("throws when searchService not available", async () => {
    const ctx = makeCtx({});
    await expect(handleSearchPosts({ query: "test" }, ctx)).rejects.toThrow(
      "SearchService not available",
    );
  });

  it("passes all filter options to searchService", async () => {
    const mockSearchService = { searchByKeyword: vi.fn().mockResolvedValue([]), searchBySimilarity: vi.fn(), findSimilar: vi.fn(), searchHybrid: vi.fn() };
    const ctx = { ...makeCtx({}), searchService: mockSearchService };

    await handleSearchPosts({
      query: "test",
      subreddit: "typescript",
      sentiment: "positive",
      minScore: 50,
      limit: 5,
    }, ctx);

    expect(mockSearchService.searchByKeyword).toHaveBeenCalledWith("test", {
      limit: 5,
      subreddit: "typescript",
      sentiment: "positive",
      minScore: 50,
    });
  });

  it("passes since as a Date when provided", async () => {
    const mockSearchService = { searchByKeyword: vi.fn().mockResolvedValue([]), searchBySimilarity: vi.fn(), findSimilar: vi.fn(), searchHybrid: vi.fn() };
    const ctx = { ...makeCtx({}), searchService: mockSearchService };

    await handleSearchPosts({ query: "test", since: "48h" }, ctx);

    const callArgs = mockSearchService.searchByKeyword.mock.calls[0];
    expect(callArgs).toBeDefined();
    const options = callArgs?.[1];
    expect(options?.since).toBeInstanceOf(Date);
  });
});

describe("handleGetRunStatus", () => {
  it("returns enriched run status with step breakdown", async () => {
    const mockRun = {
      jobId: "j-1",
      status: "COMPLETED",
      error: null,
      eventCount: 7,
      lastEventType: "DigestCompleted",
      lastEventAt: new Date("2026-03-12T10:05:00Z"),
      durationSeconds: 30,
      triggerRunId: null,
      startedAt: new Date("2026-03-12T10:00:00Z"),
      completedAt: new Date("2026-03-12T10:00:30Z"),
      createdAt: new Date("2026-03-12T10:00:00Z"),
      progress: null,
      subreddits: ["s-1", "s-2"],
    };
    const mockEvents = [
      {
        type: "PostsFetched",
        payload: { jobId: "j-1", subreddit: "typescript", count: 25 },
        createdAt: new Date("2026-03-12T10:00:05Z"),
      },
      {
        type: "PostsFetched",
        payload: { jobId: "j-1", subreddit: "rust", count: 18 },
        createdAt: new Date("2026-03-12T10:00:08Z"),
      },
      {
        type: "PostsTriaged",
        payload: { jobId: "j-1", subreddit: "typescript", selectedCount: 5 },
        createdAt: new Date("2026-03-12T10:00:12Z"),
      },
      {
        type: "PostsTriaged",
        payload: { jobId: "j-1", subreddit: "rust", selectedCount: 3 },
        createdAt: new Date("2026-03-12T10:00:15Z"),
      },
      {
        type: "PostsSummarized",
        payload: { jobId: "j-1", subreddit: "typescript", summaryCount: 5 },
        createdAt: new Date("2026-03-12T10:00:22Z"),
      },
      {
        type: "PostsSummarized",
        payload: { jobId: "j-1", subreddit: "rust", summaryCount: 3 },
        createdAt: new Date("2026-03-12T10:00:25Z"),
      },
      {
        type: "DigestCompleted",
        payload: { jobId: "j-1", digestId: "d-1" },
        createdAt: new Date("2026-03-12T10:00:28Z"),
      },
    ];
    const mockFindUnique = vi.fn().mockResolvedValue(mockRun);
    const mockEventFindMany = vi.fn().mockResolvedValue(mockEvents);
    const ctx = makeCtx({
      runView: { findUnique: mockFindUnique },
      event: { findMany: mockEventFindMany },
    });

    const result = await handleGetRunStatus({ jobId: "j-1" }, ctx);

    expect(result).not.toBeNull();
    // Preserves all RunView fields
    expect(result?.jobId).toBe("j-1");
    expect(result?.status).toBe("COMPLETED");

    // Step breakdown
    expect(result?.steps.fetch).toHaveLength(2);
    expect(result?.steps.fetch[0]).toEqual({
      subreddit: "typescript",
      count: 25,
      completedAt: "2026-03-12T10:00:05.000Z",
    });
    expect(result?.steps.triage).toHaveLength(2);
    expect(result?.steps.triage[0]?.count).toBe(5);
    expect(result?.steps.summarize).toHaveLength(2);
    expect(result?.steps.assemble).toEqual({
      status: "completed",
      digestId: "d-1",
      completedAt: "2026-03-12T10:00:28.000Z",
    });

    // No errors
    expect(result?.structuredErrors).toEqual([]);
  });

  it("returns null when run not found", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ runView: { findUnique: mockFindUnique } });

    const result = await handleGetRunStatus({ jobId: "nonexistent" }, ctx);

    expect(result).toBeNull();
  });

  it("parses structured errors from error string", async () => {
    const mockRun = {
      jobId: "j-2",
      status: "PARTIAL",
      error:
        "Failed to process r/golang: rate limited; Failed to summarize post abc123: timeout",
      eventCount: 3,
      lastEventType: "DigestCompleted",
      lastEventAt: new Date(),
      durationSeconds: 45,
      triggerRunId: null,
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      progress: null,
      subreddits: ["s-1"],
    };
    const mockFindUnique = vi.fn().mockResolvedValue(mockRun);
    const mockEventFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      runView: { findUnique: mockFindUnique },
      event: { findMany: mockEventFindMany },
    });

    const result = await handleGetRunStatus({ jobId: "j-2" }, ctx);

    expect(result?.structuredErrors).toEqual([
      { step: "fetch", subreddit: "golang", message: "rate limited" },
      { step: "summarize", message: "timeout" },
    ]);
  });

  it("returns pending assemble when no DigestCompleted event", async () => {
    const mockRun = {
      jobId: "j-3",
      status: "RUNNING",
      error: null,
      eventCount: 2,
      lastEventType: "PostsFetched",
      lastEventAt: new Date(),
      durationSeconds: null,
      triggerRunId: null,
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      progress: null,
      subreddits: ["s-1"],
    };
    const mockEvents = [
      {
        type: "PostsFetched",
        payload: { jobId: "j-3", subreddit: "python", count: 10 },
        createdAt: new Date("2026-03-12T10:00:05Z"),
      },
    ];
    const mockFindUnique = vi.fn().mockResolvedValue(mockRun);
    const mockEventFindMany = vi.fn().mockResolvedValue(mockEvents);
    const ctx = makeCtx({
      runView: { findUnique: mockFindUnique },
      event: { findMany: mockEventFindMany },
    });

    const result = await handleGetRunStatus({ jobId: "j-3" }, ctx);

    expect(result?.steps.fetch).toHaveLength(1);
    expect(result?.steps.triage).toHaveLength(0);
    expect(result?.steps.summarize).toHaveLength(0);
    expect(result?.steps.assemble).toEqual({ status: "pending" });
  });

  it("queries events with correct filters", async () => {
    const mockRun = {
      jobId: "j-4",
      status: "COMPLETED",
      error: null,
      eventCount: 0,
      lastEventType: null,
      lastEventAt: null,
      durationSeconds: 10,
      triggerRunId: null,
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      progress: null,
      subreddits: [],
    };
    const mockFindUnique = vi.fn().mockResolvedValue(mockRun);
    const mockEventFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      runView: { findUnique: mockFindUnique },
      event: { findMany: mockEventFindMany },
    });

    await handleGetRunStatus({ jobId: "j-4" }, ctx);

    expect(mockEventFindMany).toHaveBeenCalledWith({
      where: {
        aggregateId: "j-4",
        aggregateType: "job",
        type: {
          in: [
            "PostsFetched",
            "PostsTriaged",
            "PostsSummarized",
            "DigestCompleted",
            "DigestFailed",
            "DigestCanceled",
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      select: { type: true, payload: true, createdAt: true },
    });
  });
});

describe("handleListRuns", () => {
  it("returns paginated runs ordered by createdAt desc", async () => {
    const mockRuns = [
      { jobId: "j-2", status: "COMPLETED" },
      { jobId: "j-1", status: "FAILED" },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockRuns);
    const ctx = makeCtx({ runView: { findMany: mockFindMany } });

    const result = await handleListRuns({ limit: 5 }, ctx);

    expect(result.items).toEqual(mockRuns);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 6,
    });
  });

  it("uses default page size when no limit provided", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ runView: { findMany: mockFindMany } });

    await handleListRuns({}, ctx);

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 11,
    });
  });

  it("passes cursor to findMany when provided", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ runView: { findMany: mockFindMany } });

    await handleListRuns({ limit: 5, cursor: "j-prev" }, ctx);

    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 6,
      cursor: { jobId: "j-prev" },
      skip: 1,
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

describe("handleGetSubredditStats", () => {
  it("returns all subreddits when no name provided", async () => {
    const mockSubs = [
      { id: "s-1", name: "askreddit", totalPostsFetched: 50, totalDigestsAppearedIn: 10 },
      { id: "s-2", name: "typescript", totalPostsFetched: 30, totalDigestsAppearedIn: 5 },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockSubs);
    const ctx = makeCtx({ subredditView: { findMany: mockFindMany } });

    const result = await handleGetSubredditStats({}, ctx);

    expect(result).toEqual(mockSubs);
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { name: "asc" },
    });
  });

  it("filters by name when provided", async () => {
    const mockSub = [
      { id: "s-1", name: "typescript", totalPostsFetched: 30 },
    ];
    const mockFindMany = vi.fn().mockResolvedValue(mockSub);
    const ctx = makeCtx({ subredditView: { findMany: mockFindMany } });

    const result = await handleGetSubredditStats({ name: "typescript" }, ctx);

    expect(result).toEqual(mockSub);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { name: "typescript" },
      orderBy: { name: "asc" },
    });
  });

  it("returns empty array when name not found", async () => {
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({ subredditView: { findMany: mockFindMany } });

    const result = await handleGetSubredditStats({ name: "nonexistent" }, ctx);

    expect(result).toEqual([]);
  });
});

describe("handleCompareDigests", () => {
  // Helper to build a mock digest with digestPosts
  function mockDigestWithPosts(
    id: string,
    createdAt: Date,
    posts: Array<{ id: string; redditId: string; title: string; subreddit: string; score: number; rank: number }>,
  ) {
    return {
      id,
      createdAt,
      digestPosts: posts.map((p) => ({
        rank: p.rank,
        subreddit: p.subreddit,
        post: { id: p.id, redditId: p.redditId, title: p.title, subreddit: p.subreddit, score: p.score },
      })),
    };
  }

  it("computes overlap, added, and removed posts between two digests", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), [
      { id: "p1", redditId: "t3_aaa", title: "Post A1", subreddit: "typescript", score: 100, rank: 1 },
      { id: "p2", redditId: "t3_bbb", title: "Post A2", subreddit: "typescript", score: 80, rank: 2 },
      { id: "p3", redditId: "t3_ccc", title: "Post A3", subreddit: "rust", score: 60, rank: 3 },
    ]);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), [
      { id: "p2", redditId: "t3_bbb", title: "Post A2", subreddit: "typescript", score: 85, rank: 1 },
      { id: "p4", redditId: "t3_ddd", title: "Post B1", subreddit: "rust", score: 90, rank: 2 },
      { id: "p5", redditId: "t3_eee", title: "Post B2", subreddit: "nextjs", score: 70, rank: 3 },
    ]);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    // Digest summaries
    expect(result.digestA.id).toBe("d-a");
    expect(result.digestA.postCount).toBe(3);
    expect(result.digestA.subreddits).toEqual(["rust", "typescript"]);
    expect(result.digestB.id).toBe("d-b");
    expect(result.digestB.postCount).toBe(3);
    expect(result.digestB.subreddits).toEqual(["nextjs", "rust", "typescript"]);

    // Overlap: t3_bbb is in both
    expect(result.overlap.count).toBe(1);
    expect(result.overlap.percentage).toBeCloseTo(33.33, 1);
    expect(result.overlap.posts[0]?.redditId).toBe("t3_bbb");

    // Added: t3_ddd, t3_eee (in B, not A)
    expect(result.added.count).toBe(2);
    expect(result.added.posts.map((p) => p.redditId).sort()).toEqual(["t3_ddd", "t3_eee"]);

    // Removed: t3_aaa, t3_ccc (in A, not B)
    expect(result.removed.count).toBe(2);
    expect(result.removed.posts.map((p) => p.redditId).sort()).toEqual(["t3_aaa", "t3_ccc"]);

    // Subreddit deltas
    expect(result.subredditDeltas).toContainEqual({ subreddit: "typescript", countA: 2, countB: 1, delta: -1 });
    expect(result.subredditDeltas).toContainEqual({ subreddit: "rust", countA: 1, countB: 1, delta: 0 });
    expect(result.subredditDeltas).toContainEqual({ subreddit: "nextjs", countA: 0, countB: 1, delta: 1 });
  });

  it("handles complete overlap (identical digests by content)", async () => {
    const posts = [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
    ];
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), posts);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), posts);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    expect(result.overlap.count).toBe(1);
    expect(result.overlap.percentage).toBe(100);
    expect(result.added.count).toBe(0);
    expect(result.removed.count).toBe(0);
  });

  it("handles no overlap", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
    ]);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), [
      { id: "p2", redditId: "t3_bbb", title: "Post 2", subreddit: "rust", score: 90, rank: 1 },
    ]);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    expect(result.overlap.count).toBe(0);
    expect(result.overlap.percentage).toBe(0);
    expect(result.added.count).toBe(1);
    expect(result.removed.count).toBe(1);
  });

  it("handles both digests empty", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), []);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), []);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    expect(result.overlap.count).toBe(0);
    expect(result.overlap.percentage).toBe(0);
    expect(result.added.count).toBe(0);
    expect(result.removed.count).toBe(0);
    expect(result.subredditDeltas).toEqual([]);
  });

  it("handles empty digest A (percentage is 0)", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), []);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
    ]);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b" },
      ctx,
    );

    expect(result.overlap.percentage).toBe(0);
    expect(result.added.count).toBe(1);
    expect(result.removed.count).toBe(0);
  });

  it("applies subreddit filter", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
      { id: "p2", redditId: "t3_bbb", title: "Post 2", subreddit: "rust", score: 80, rank: 2 },
    ]);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), [
      { id: "p1", redditId: "t3_aaa", title: "Post 1", subreddit: "typescript", score: 100, rank: 1 },
      { id: "p3", redditId: "t3_ccc", title: "Post 3", subreddit: "typescript", score: 70, rank: 2 },
    ]);

    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    const result = await handleCompareDigests(
      { digestIdA: "d-a", digestIdB: "d-b", subreddit: "typescript" },
      ctx,
    );

    // Only typescript posts considered
    expect(result.digestA.postCount).toBe(1);
    expect(result.digestB.postCount).toBe(2);
    expect(result.overlap.count).toBe(1);
    expect(result.added.count).toBe(1);
    expect(result.removed.count).toBe(0);
    // Subreddit deltas only include filtered subreddit
    expect(result.subredditDeltas).toHaveLength(1);
    expect(result.subredditDeltas[0]).toEqual({ subreddit: "typescript", countA: 1, countB: 2, delta: 1 });
  });

  it("throws RedgestError NOT_FOUND when digest A not found", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    await expect(
      handleCompareDigests({ digestIdA: "missing", digestIdB: "d-b" }, ctx),
    ).rejects.toThrow("Digest missing not found");
  });

  it("fetches digests with correct include shape", async () => {
    const digestA = mockDigestWithPosts("d-a", new Date("2026-03-10"), []);
    const digestB = mockDigestWithPosts("d-b", new Date("2026-03-11"), []);
    const mockFindUnique = vi.fn()
      .mockResolvedValueOnce(digestA)
      .mockResolvedValueOnce(digestB);
    const ctx = makeCtx({ digest: { findUnique: mockFindUnique } });

    await handleCompareDigests({ digestIdA: "d-a", digestIdB: "d-b" }, ctx);

    const expectedQuery = {
      where: { id: "d-a" },
      include: {
        digestPosts: {
          orderBy: { rank: "asc" },
          include: { post: true },
        },
      },
    };
    expect(mockFindUnique).toHaveBeenCalledWith(expectedQuery);
    expect(mockFindUnique).toHaveBeenCalledWith({
      ...expectedQuery,
      where: { id: "d-b" },
    });
  });
});

describe("handleGetDeliveryStatus", () => {
  it("returns delivery status for a specific digest", async () => {
    const mockDigest = { id: "d-1", createdAt: new Date("2026-03-10T00:00:00Z"), jobId: "j-1" };
    const mockDeliveries = [
      {
        deliveryId: "del-1",
        digestId: "d-1",
        jobId: "j-1",
        channel: "EMAIL",
        status: "SENT",
        error: null,
        externalId: "ext-1",
        sentAt: new Date("2026-03-10T00:05:00Z"),
        createdAt: new Date("2026-03-10T00:04:00Z"),
        updatedAt: new Date("2026-03-10T00:05:00Z"),
        digestCreatedAt: new Date("2026-03-10T00:00:00Z"),
        jobStatus: "COMPLETED",
      },
      {
        deliveryId: "del-2",
        digestId: "d-1",
        jobId: "j-1",
        channel: "SLACK",
        status: "FAILED",
        error: "Webhook timeout",
        externalId: null,
        sentAt: null,
        createdAt: new Date("2026-03-10T00:04:00Z"),
        updatedAt: new Date("2026-03-10T00:05:00Z"),
        digestCreatedAt: new Date("2026-03-10T00:00:00Z"),
        jobStatus: "COMPLETED",
      },
    ];

    const mockFindUnique = vi.fn().mockResolvedValue(mockDigest);
    const mockFindMany = vi.fn().mockResolvedValue(mockDeliveries);
    const ctx = makeCtx({
      digest: { findUnique: mockFindUnique },
      deliveryView: { findMany: mockFindMany },
    });

    const { handleGetDeliveryStatus } = await import(
      "../queries/handlers/get-delivery-status.js"
    );
    const result = await handleGetDeliveryStatus({ digestId: "d-1" }, ctx);

    expect(result.digests).toHaveLength(1);
    expect(result.digests[0]?.digestId).toBe("d-1");
    expect(result.digests[0]?.digestCreatedAt).toBe("2026-03-10T00:00:00.000Z");
    expect(result.digests[0]?.jobId).toBe("j-1");
    expect(result.digests[0]?.channels).toHaveLength(2);
    expect(result.digests[0]?.channels[0]).toEqual({
      channel: "EMAIL",
      status: "SENT",
      error: null,
      externalId: "ext-1",
      sentAt: "2026-03-10T00:05:00.000Z",
    });
    expect(result.digests[0]?.channels[1]).toEqual({
      channel: "SLACK",
      status: "FAILED",
      error: "Webhook timeout",
      externalId: null,
      sentAt: null,
    });
  });

  it("returns recent digests when no digestId provided", async () => {
    const mockDigests = [
      { id: "d-2", createdAt: new Date("2026-03-11T00:00:00Z"), jobId: "j-2" },
      { id: "d-1", createdAt: new Date("2026-03-10T00:00:00Z"), jobId: "j-1" },
    ];
    const mockDeliveries = [
      {
        deliveryId: "del-3",
        digestId: "d-2",
        jobId: "j-2",
        channel: "EMAIL",
        status: "SENT",
        error: null,
        externalId: "ext-3",
        sentAt: new Date("2026-03-11T00:05:00Z"),
        createdAt: new Date("2026-03-11T00:04:00Z"),
        updatedAt: new Date("2026-03-11T00:05:00Z"),
        digestCreatedAt: new Date("2026-03-11T00:00:00Z"),
        jobStatus: "COMPLETED",
      },
    ];

    const mockDigestFindMany = vi.fn().mockResolvedValue(mockDigests);
    const mockDeliveryFindMany = vi.fn().mockResolvedValue(mockDeliveries);
    const ctx = makeCtx({
      digest: { findMany: mockDigestFindMany },
      deliveryView: { findMany: mockDeliveryFindMany },
    });

    const { handleGetDeliveryStatus } = await import(
      "../queries/handlers/get-delivery-status.js"
    );
    const result = await handleGetDeliveryStatus({}, ctx);

    expect(result.digests).toHaveLength(2);
    // d-2 has deliveries
    expect(result.digests[0]?.digestId).toBe("d-2");
    expect(result.digests[0]?.channels).toHaveLength(1);
    // d-1 has no deliveries
    expect(result.digests[1]?.digestId).toBe("d-1");
    expect(result.digests[1]?.channels).toHaveLength(0);
  });

  it("throws NOT_FOUND when specific digestId not found", async () => {
    const mockFindUnique = vi.fn().mockResolvedValue(null);
    const ctx = makeCtx({
      digest: { findUnique: mockFindUnique },
    });

    const { handleGetDeliveryStatus } = await import(
      "../queries/handlers/get-delivery-status.js"
    );

    await expect(
      handleGetDeliveryStatus({ digestId: "nonexistent" }, ctx),
    ).rejects.toThrow("Digest nonexistent not found");
  });

  it("clamps limit to max 20", async () => {
    const mockDigestFindMany = vi.fn().mockResolvedValue([]);
    const mockDeliveryFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      digest: { findMany: mockDigestFindMany },
      deliveryView: { findMany: mockDeliveryFindMany },
    });

    const { handleGetDeliveryStatus } = await import(
      "../queries/handlers/get-delivery-status.js"
    );
    await handleGetDeliveryStatus({ limit: 50 }, ctx);

    expect(mockDigestFindMany).toHaveBeenCalledWith({
      take: 20,
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, jobId: true },
    });
  });

  it("returns empty channels for a digest with no deliveries", async () => {
    const mockDigest = { id: "d-1", createdAt: new Date("2026-03-10T00:00:00Z"), jobId: "j-1" };
    const mockFindUnique = vi.fn().mockResolvedValue(mockDigest);
    const mockFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      digest: { findUnique: mockFindUnique },
      deliveryView: { findMany: mockFindMany },
    });

    const { handleGetDeliveryStatus } = await import(
      "../queries/handlers/get-delivery-status.js"
    );
    const result = await handleGetDeliveryStatus({ digestId: "d-1" }, ctx);

    expect(result.digests).toHaveLength(1);
    expect(result.digests[0]?.channels).toEqual([]);
  });

  it("uses default limit of 5 when not provided", async () => {
    const mockDigestFindMany = vi.fn().mockResolvedValue([]);
    const mockDeliveryFindMany = vi.fn().mockResolvedValue([]);
    const ctx = makeCtx({
      digest: { findMany: mockDigestFindMany },
      deliveryView: { findMany: mockDeliveryFindMany },
    });

    const { handleGetDeliveryStatus } = await import(
      "../queries/handlers/get-delivery-status.js"
    );
    await handleGetDeliveryStatus({}, ctx);

    expect(mockDigestFindMany).toHaveBeenCalledWith({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, jobId: true },
    });
  });
});

describe("queryHandlers registry", () => {
  it("registers all 18 handlers", () => {
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
    expect(queryHandlers.GetSubredditStats).toBe(handleGetSubredditStats);
    expect(queryHandlers.CompareDigests).toBe(handleCompareDigests);
    expect(queryHandlers.GetDeliveryStatus).toBeDefined();
    expect(queryHandlers.FindSimilar).toBeDefined();
    expect(queryHandlers.AskHistory).toBeDefined();
    expect(queryHandlers.GetTrendingTopics).toBeDefined();
    expect(queryHandlers.ComparePeriods).toBeDefined();
  });

  it("has exactly 18 entries", () => {
    const handlerCount = Object.keys(queryHandlers).length;
    expect(handlerCount).toBe(18);
  });
});
