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

describe("queryHandlers registry", () => {
  it("registers all 10 handlers", () => {
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
  });

  it("has exactly 10 entries", () => {
    const handlerCount = Object.keys(queryHandlers).length;
    expect(handlerCount).toBe(10);
  });
});
