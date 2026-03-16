import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@redgest/db";
import type {
  ContentSource,
  FetchedContent,
  RedditPostData,
  RedditCommentData,
} from "../pipeline/types";
import { fetchStep } from "../pipeline/fetch-step";

// ─── Helpers ─────────────────────────────────────────────

function makePost(overrides: Partial<RedditPostData> = {}): RedditPostData {
  return {
    id: "abc123",
    name: "t3_abc123",
    subreddit: "test",
    title: "Test Post",
    selftext: "body",
    author: "user1",
    score: 42,
    num_comments: 5,
    url: "https://reddit.com/r/test/abc123",
    permalink: "/r/test/abc123",
    link_flair_text: null,
    over_18: false,
    created_utc: 1700000000,
    is_self: true,
    ...overrides,
  };
}

function makeComment(
  overrides: Partial<RedditCommentData> = {},
): RedditCommentData {
  return {
    id: "comment-1",
    name: "t1_comment-1",
    author: "commenter",
    body: "Great post!",
    score: 10,
    depth: 0,
    created_utc: 1700001000,
    ...overrides,
  };
}

function makeSource(content: FetchedContent): ContentSource {
  return { fetchContent: vi.fn().mockResolvedValue(content) };
}

function makeDb() {
  const upsertReturn = { id: "db-uuid-1" };
  return {
    post: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(upsertReturn),
      findMany: vi.fn().mockResolvedValue([]),
    },
    postComment: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────

describe("fetchStep cache behavior", () => {
  const fetchedAt = new Date("2026-03-09T12:00:00Z");
  let db: ReturnType<typeof makeDb>;
  let source: ContentSource;

  const fakeFetchResult: FetchedContent = {
    subreddit: "test",
    posts: [{ post: makePost(), comments: [makeComment()] }],
    fetchedAt,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    source = makeSource(fakeFetchResult);
  });

  it("fetches from source when no lastFetchedAt exists", async () => {
    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: null },
      source,
      db as unknown as PrismaClient,
    );

    expect(source.fetchContent).toHaveBeenCalled();
    expect(result.posts.length).toBeGreaterThan(0);
  });

  it("fetches from source when lastFetchedAt is undefined", async () => {
    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false },
      source,
      db as unknown as PrismaClient,
    );

    expect(source.fetchContent).toHaveBeenCalled();
    expect(result.posts.length).toBeGreaterThan(0);
  });

  it("fetches from source when cache is stale", async () => {
    const staleDate = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago

    await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: staleDate },
      source,
      db as unknown as PrismaClient,
    );

    expect(source.fetchContent).toHaveBeenCalled();
  });

  it("skips fetch when cache is fresh and uses DB posts", async () => {
    const freshDate = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago

    const dbPost = {
      id: "db-uuid-1",
      redditId: "abc123",
      subreddit: "test",
      title: "Test Post",
      body: "body",
      author: "user1",
      score: 42,
      commentCount: 5,
      url: "https://reddit.com/r/test/abc123",
      permalink: "/r/test/abc123",
      flair: null,
      isNsfw: false,
      fetchedAt: freshDate,
      comments: [
        {
          id: "comment-db-1",
          redditId: "comment-1",
          author: "commenter",
          body: "Great post!",
          score: 10,
          depth: 0,
          fetchedAt: freshDate,
        },
      ],
    };

    db.post.findMany.mockResolvedValue([dbPost]);

    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: freshDate },
      source,
      db as unknown as PrismaClient,
      { cacheTtlMs: 15 * 60 * 1000 },
    );

    expect(source.fetchContent).not.toHaveBeenCalled();
    expect(db.post.findMany).toHaveBeenCalled();
    expect(result.subreddit).toBe("test");
    expect(result.posts.length).toBe(1);
    expect(result.posts[0]?.postId).toBe("db-uuid-1");
    expect(result.posts[0]?.redditId).toBe("abc123");
  });

  it("returns correct RedditPostData shape from cache", async () => {
    const freshDate = new Date(Date.now() - 5 * 60 * 1000);

    const dbPost = {
      id: "db-uuid-1",
      redditId: "abc123",
      subreddit: "test",
      title: "Test Post",
      body: "body",
      author: "user1",
      score: 42,
      commentCount: 5,
      url: "https://reddit.com/r/test/abc123",
      permalink: "/r/test/abc123",
      flair: null,
      isNsfw: false,
      fetchedAt: freshDate,
      comments: [],
    };

    db.post.findMany.mockResolvedValue([dbPost]);

    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: freshDate },
      source,
      db as unknown as PrismaClient,
      { cacheTtlMs: 15 * 60 * 1000 },
    );

    const post = result.posts[0];
    expect(post).toBeDefined();
    expect(post?.post.id).toBe("abc123");
    expect(post?.post.name).toBe("t3_abc123");
    expect(post?.post.subreddit).toBe("test");
    expect(post?.post.title).toBe("Test Post");
    expect(post?.post.selftext).toBe("body");
    expect(post?.post.author).toBe("user1");
    expect(post?.post.score).toBe(42);
    expect(post?.post.num_comments).toBe(5);
    expect(post?.post.over_18).toBe(false);
  });

  it("returns correct RedditCommentData shape from cache", async () => {
    const freshDate = new Date(Date.now() - 5 * 60 * 1000);

    const dbPost = {
      id: "db-uuid-1",
      redditId: "abc123",
      subreddit: "test",
      title: "Test Post",
      body: "body",
      author: "user1",
      score: 42,
      commentCount: 5,
      url: "https://reddit.com/r/test/abc123",
      permalink: "/r/test/abc123",
      flair: null,
      isNsfw: false,
      fetchedAt: freshDate,
      comments: [
        {
          id: "comment-db-1",
          redditId: "c1",
          author: "commenter",
          body: "Nice!",
          score: 10,
          depth: 0,
          fetchedAt: freshDate,
        },
      ],
    };

    db.post.findMany.mockResolvedValue([dbPost]);

    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: freshDate },
      source,
      db as unknown as PrismaClient,
      { cacheTtlMs: 15 * 60 * 1000 },
    );

    const comment = result.posts[0]?.comments[0];
    expect(comment).toBeDefined();
    expect(comment?.id).toBe("c1");
    expect(comment?.name).toBe("t1_c1");
    expect(comment?.author).toBe("commenter");
    expect(comment?.body).toBe("Nice!");
    expect(comment?.score).toBe(10);
    expect(comment?.depth).toBe(0);
  });

  it("uses default 15 min TTL when no options provided", async () => {
    // 10 minutes ago — within 15min default TTL
    const freshDate = new Date(Date.now() - 10 * 60 * 1000);

    db.post.findMany.mockResolvedValue([]);

    await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: freshDate },
      source,
      db as unknown as PrismaClient,
      // no options — should use default 15 min TTL
    );

    expect(source.fetchContent).not.toHaveBeenCalled();
    expect(db.post.findMany).toHaveBeenCalled();
  });

  it("fetches from source when cache is just past TTL", async () => {
    // 16 minutes ago — just past 15min default TTL
    const staleDate = new Date(Date.now() - 16 * 60 * 1000);

    await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: staleDate },
      source,
      db as unknown as PrismaClient,
    );

    expect(source.fetchContent).toHaveBeenCalled();
  });

  it("respects custom cacheTtlMs", async () => {
    // 4 minutes ago — stale with 3min TTL, fresh with 5min TTL
    const date = new Date(Date.now() - 4 * 60 * 1000);

    // With 3 minute TTL — should fetch (stale)
    await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: date },
      source,
      db as unknown as PrismaClient,
      { cacheTtlMs: 3 * 60 * 1000 },
    );

    expect(source.fetchContent).toHaveBeenCalled();
  });

  it("uses fetchedAt from lastFetchedAt for cache hit result", async () => {
    const freshDate = new Date(Date.now() - 5 * 60 * 1000);

    db.post.findMany.mockResolvedValue([]);

    const result = await fetchStep(
      { name: "test", maxPosts: 5, includeNsfw: false, lastFetchedAt: freshDate },
      source,
      db as unknown as PrismaClient,
      { cacheTtlMs: 15 * 60 * 1000 },
    );

    expect(result.fetchedAt).toBe(freshDate);
  });
});
