import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@redgest/db";
import type {
  ContentSource,
  FetchedContent,
  RedditPostData,
  RedditCommentData,
} from "../pipeline/types.js";
import { fetchStep } from "../pipeline/fetch-step.js";

// ─── Helpers ─────────────────────────────────────────────

function makePost(overrides: Partial<RedditPostData> = {}): RedditPostData {
  return {
    id: "reddit-post-1",
    name: "t3_reddit-post-1",
    subreddit: "typescript",
    title: "Test Post",
    selftext: "Some body text",
    author: "testuser",
    score: 42,
    num_comments: 5,
    url: "https://reddit.com/r/typescript/comments/abc123",
    permalink: "/r/typescript/comments/abc123",
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
      upsert: vi.fn().mockResolvedValue(upsertReturn),
    },
    postComment: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaClient;
}

// ─── Tests ───────────────────────────────────────────────

describe("fetchStep", () => {
  const fetchedAt = new Date("2026-03-09T12:00:00Z");
  const subredditConfig = {
    name: "typescript",
    maxPosts: 25,
    includeNsfw: false,
  };

  let db: PrismaClient;
  let source: ContentSource;

  beforeEach(() => {
    db = makeDb();
  });

  it("calls fetchContent with correct options", async () => {
    const content: FetchedContent = {
      subreddit: "typescript",
      posts: [],
      fetchedAt,
    };
    source = makeSource(content);

    await fetchStep(subredditConfig, source, db);

    expect(source.fetchContent).toHaveBeenCalledWith("typescript", {
      sorts: ["hot", "top", "rising"],
      limit: 25,
      commentsPerPost: 10,
      timeRange: "day",
    });
  });

  it("upserts posts with correct create and update fields", async () => {
    const post = makePost();
    const content: FetchedContent = {
      subreddit: "typescript",
      posts: [{ post, comments: [] }],
      fetchedAt,
    };
    source = makeSource(content);

    await fetchStep(subredditConfig, source, db);

    const upsertCalls = (db.post.upsert as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(upsertCalls[0]?.[0]).toEqual({
      where: { redditId: "reddit-post-1" },
      create: {
        redditId: "reddit-post-1",
        subreddit: "typescript",
        title: "Test Post",
        body: "Some body text",
        author: "testuser",
        score: 42,
        commentCount: 5,
        url: "https://reddit.com/r/typescript/comments/abc123",
        permalink: "/r/typescript/comments/abc123",
        flair: null,
        isNsfw: false,
        fetchedAt,
      },
      update: {
        score: 42,
        commentCount: 5,
        fetchedAt,
      },
    });
  });

  it("filters NSFW posts when includeNsfw is false", async () => {
    const sfwPost = makePost({ id: "sfw-1", over_18: false });
    const nsfwPost = makePost({ id: "nsfw-1", over_18: true });
    const content: FetchedContent = {
      subreddit: "typescript",
      posts: [
        { post: sfwPost, comments: [] },
        { post: nsfwPost, comments: [] },
      ],
      fetchedAt,
    };
    source = makeSource(content);

    const result = await fetchStep(
      { ...subredditConfig, includeNsfw: false },
      source,
      db,
    );

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.redditId).toBe("sfw-1");
    expect(db.post.upsert).toHaveBeenCalledTimes(1);
  });

  it("includes NSFW posts when includeNsfw is true", async () => {
    const sfwPost = makePost({ id: "sfw-1", over_18: false });
    const nsfwPost = makePost({ id: "nsfw-1", over_18: true });

    // Need two different upsert return values
    (db.post.upsert as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "db-uuid-sfw" })
      .mockResolvedValueOnce({ id: "db-uuid-nsfw" });

    const content: FetchedContent = {
      subreddit: "typescript",
      posts: [
        { post: sfwPost, comments: [] },
        { post: nsfwPost, comments: [] },
      ],
      fetchedAt,
    };
    source = makeSource(content);

    const result = await fetchStep(
      { ...subredditConfig, includeNsfw: true },
      source,
      db,
    );

    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]?.redditId).toBe("sfw-1");
    expect(result.posts[1]?.redditId).toBe("nsfw-1");
    expect(db.post.upsert).toHaveBeenCalledTimes(2);
  });

  it("deletes old comments and creates new ones for each post", async () => {
    const post = makePost();
    const comments = [
      makeComment({ id: "c1", author: "alice", score: 20 }),
      makeComment({ id: "c2", author: "bob", score: 15 }),
    ];
    const content: FetchedContent = {
      subreddit: "typescript",
      posts: [{ post, comments }],
      fetchedAt,
    };
    source = makeSource(content);

    await fetchStep(subredditConfig, source, db);

    // Old comments deleted
    expect(db.postComment.deleteMany).toHaveBeenCalledWith({
      where: { postId: "db-uuid-1" },
    });

    // New comments created
    expect(db.postComment.createMany).toHaveBeenCalledWith({
      data: [
        {
          postId: "db-uuid-1",
          redditId: "c1",
          author: "alice",
          body: "Great post!",
          score: 20,
          depth: 0,
          fetchedAt,
        },
        {
          postId: "db-uuid-1",
          redditId: "c2",
          author: "bob",
          body: "Great post!",
          score: 15,
          depth: 0,
          fetchedAt,
        },
      ],
    });
  });

  it("skips createMany when post has no comments", async () => {
    const post = makePost();
    const content: FetchedContent = {
      subreddit: "typescript",
      posts: [{ post, comments: [] }],
      fetchedAt,
    };
    source = makeSource(content);

    await fetchStep(subredditConfig, source, db);

    expect(db.postComment.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.postComment.createMany).not.toHaveBeenCalled();
  });

  it("returns FetchStepResult with correct shape", async () => {
    const post = makePost();
    const comments = [makeComment()];
    const content: FetchedContent = {
      subreddit: "typescript",
      posts: [{ post, comments }],
      fetchedAt,
    };
    source = makeSource(content);

    const result = await fetchStep(subredditConfig, source, db);

    expect(result).toEqual({
      subreddit: "typescript",
      posts: [
        {
          postId: "db-uuid-1",
          redditId: "reddit-post-1",
          post,
          comments,
        },
      ],
      fetchedAt,
      fromCache: false,
    });
  });

  it("returns empty posts array when all posts are NSFW and includeNsfw is false", async () => {
    const nsfwPost = makePost({ id: "nsfw-1", over_18: true });
    const content: FetchedContent = {
      subreddit: "typescript",
      posts: [{ post: nsfwPost, comments: [] }],
      fetchedAt,
    };
    source = makeSource(content);

    const result = await fetchStep(
      { ...subredditConfig, includeNsfw: false },
      source,
      db,
    );

    expect(result.posts).toHaveLength(0);
    expect(db.post.upsert).not.toHaveBeenCalled();
  });
});
