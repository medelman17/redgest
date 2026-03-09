import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSubredditContent } from "../fetcher.js";
import type { FetchOptions } from "../fetcher.js";
import type { RedditClient } from "../client.js";
import type { TokenBucket } from "../rate-limiter.js";
import type {
  RedditListing,
  RedditPostData,
  RedditCommentData,
} from "../types.js";

// --- Helpers ---

function makeListing<T>(items: T[]): RedditListing<T> {
  const listing: RedditListing<T> = {
    kind: "Listing",
    data: {
      after: null,
      before: null,
      children: items.map((item) => ({ kind: "t3", data: item })),
    },
  };
  return listing;
}

function makeCommentListing(
  post: RedditPostData,
  comments: Array<{ kind: string; data: RedditCommentData }>,
): [RedditListing<RedditPostData>, RedditListing<RedditCommentData>] {
  const postListing: RedditListing<RedditPostData> = {
    kind: "Listing",
    data: {
      after: null,
      before: null,
      children: [{ kind: "t3", data: post }],
    },
  };
  const commentListing: RedditListing<RedditCommentData> = {
    kind: "Listing",
    data: {
      after: null,
      before: null,
      children: comments,
    },
  };
  return [postListing, commentListing];
}

function makePost(id: string, title: string): RedditPostData {
  const post: RedditPostData = {
    id,
    name: `t3_${id}`,
    subreddit: "typescript",
    title,
    selftext: `Body of ${title}`,
    author: "testuser",
    score: 100,
    num_comments: 10,
    url: `https://reddit.com/r/typescript/${id}`,
    permalink: `/r/typescript/comments/${id}`,
    link_flair_text: null,
    over_18: false,
    created_utc: Date.now() / 1000,
    is_self: true,
  };
  return post;
}

function makeComment(id: string): RedditCommentData {
  const comment: RedditCommentData = {
    id,
    name: `t1_${id}`,
    author: "commenter",
    body: `Comment ${id}`,
    score: 50,
    depth: 0,
    created_utc: Date.now() / 1000,
  };
  return comment;
}

describe("fetchSubredditContent", () => {
  const mockGet = vi.fn();
  const mockAcquire = vi.fn().mockResolvedValue(undefined);

  const client = { get: mockGet } as unknown as RedditClient;
  const rateLimiter = { acquire: mockAcquire } as unknown as TokenBucket;

  beforeEach(() => {
    mockGet.mockReset();
    mockAcquire.mockReset().mockResolvedValue(undefined);
  });

  it("fetches posts from single sort and comments for each", async () => {
    const post = makePost("abc", "Test Post");
    const comment = makeComment("c1");

    // Sort listing
    mockGet.mockResolvedValueOnce(makeListing([post]));
    // Comment listing for post
    mockGet.mockResolvedValueOnce(
      makeCommentListing(post, [{ kind: "t1", data: comment }]),
    );

    const options: FetchOptions = {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 5,
    };
    const result = await fetchSubredditContent(
      client,
      rateLimiter,
      "typescript",
      options,
    );

    expect(result.subreddit).toBe("typescript");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.post.id).toBe("abc");
    expect(result.posts[0]?.comments).toHaveLength(1);
    expect(result.posts[0]?.comments[0]?.id).toBe("c1");
    expect(result.fetchedAt).toBeInstanceOf(Date);
    // 1 acquire for sort + 1 acquire for comments = 2
    expect(mockAcquire).toHaveBeenCalledTimes(2);
  });

  it("deduplicates posts across multiple sorts", async () => {
    const post1 = makePost("p1", "Post One");
    const post2 = makePost("p2", "Post Two");

    // hot returns both posts
    mockGet.mockResolvedValueOnce(makeListing([post1, post2]));
    // top returns the same posts (duplicates)
    mockGet.mockResolvedValueOnce(makeListing([post1, post2]));
    // Comments for p1
    mockGet.mockResolvedValueOnce(
      makeCommentListing(post1, [{ kind: "t1", data: makeComment("c1") }]),
    );
    // Comments for p2
    mockGet.mockResolvedValueOnce(
      makeCommentListing(post2, [{ kind: "t1", data: makeComment("c2") }]),
    );

    const options: FetchOptions = {
      sorts: ["hot", "top"],
      limit: 10,
      commentsPerPost: 5,
    };
    const result = await fetchSubredditContent(
      client,
      rateLimiter,
      "typescript",
      options,
    );

    // Deduplicated: only 2 unique posts
    expect(result.posts).toHaveLength(2);
    // 2 sort fetches + 2 comment fetches = 4
    expect(mockAcquire).toHaveBeenCalledTimes(4);
  });

  it("passes timeRange to top sort only", async () => {
    // hot listing
    mockGet.mockResolvedValueOnce(makeListing([]));
    // top listing
    mockGet.mockResolvedValueOnce(makeListing([]));

    const options: FetchOptions = {
      sorts: ["hot", "top"],
      limit: 5,
      timeRange: "week",
      commentsPerPost: 3,
    };
    await fetchSubredditContent(client, rateLimiter, "typescript", options);

    const hotUrl = mockGet.mock.calls[0]?.[0] as string;
    const topUrl = mockGet.mock.calls[1]?.[0] as string;

    // hot should NOT have &t= parameter (note: "t=" substring appears in "limit=")
    expect(hotUrl).not.toContain("&t=");
    expect(hotUrl).toContain("/r/typescript/hot");
    // top SHOULD have t=week
    expect(topUrl).toContain("t=week");
    expect(topUrl).toContain("/r/typescript/top");
  });

  it("filters out non-comment children", async () => {
    const post = makePost("p1", "Post");
    const comment = makeComment("c1");
    const moreNode: { kind: string; data: RedditCommentData } = {
      kind: "more",
      data: makeComment("more1"),
    };

    // Sort listing
    mockGet.mockResolvedValueOnce(makeListing([post]));
    // Comment listing with a "more" node mixed in
    mockGet.mockResolvedValueOnce(
      makeCommentListing(post, [{ kind: "t1", data: comment }, moreNode]),
    );

    const options: FetchOptions = {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 5,
    };
    const result = await fetchSubredditContent(
      client,
      rateLimiter,
      "typescript",
      options,
    );

    // Only the t1 comment should be included
    expect(result.posts[0]?.comments).toHaveLength(1);
    expect(result.posts[0]?.comments[0]?.id).toBe("c1");
  });

  it("handles empty listing results", async () => {
    // Empty listing
    mockGet.mockResolvedValueOnce(makeListing([]));

    const options: FetchOptions = {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 5,
    };
    const result = await fetchSubredditContent(
      client,
      rateLimiter,
      "typescript",
      options,
    );

    expect(result.posts).toHaveLength(0);
    // Only 1 acquire for the sort fetch, no comment fetches
    expect(mockAcquire).toHaveBeenCalledTimes(1);
  });
});
