import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FetchOptions, FetchedContent } from "../fetcher.js";
import type { RedditApiClient } from "../client.js";
import type { TokenBucket } from "../rate-limiter.js";

vi.mock("../fetcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../fetcher.js")>();
  return {
    ...actual,
    fetchSubredditContent: vi.fn(),
  };
});

import { RedditContentSource } from "../content-source.js";
import { fetchSubredditContent } from "../fetcher.js";

const mockFetch = vi.mocked(fetchSubredditContent);

describe("RedditContentSource", () => {
  const client = {} as unknown as RedditApiClient;
  const rateLimiter = {} as unknown as TokenBucket;

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("delegates fetchContent to fetchSubredditContent", async () => {
    const expected: FetchedContent = {
      subreddit: "typescript",
      posts: [],
      fetchedAt: new Date(),
    };
    mockFetch.mockResolvedValueOnce(expected);

    const source = new RedditContentSource(client, rateLimiter);
    const options: FetchOptions = {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 5,
    };

    const result = await source.fetchContent("typescript", options);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      client,
      rateLimiter,
      "typescript",
      options,
    );
    expect(result).toBe(expected);
  });

  it("passes client and rateLimiter from constructor", async () => {
    const specificClient = { tag: "client" } as unknown as RedditApiClient;
    const specificLimiter = { tag: "limiter" } as unknown as TokenBucket;
    mockFetch.mockResolvedValueOnce({
      subreddit: "rust",
      posts: [],
      fetchedAt: new Date(),
    });

    const source = new RedditContentSource(specificClient, specificLimiter);
    const options: FetchOptions = {
      sorts: ["top", "rising"],
      limit: 25,
      timeRange: "week",
      commentsPerPost: 10,
    };

    await source.fetchContent("rust", options);

    expect(mockFetch).toHaveBeenCalledWith(
      specificClient,
      specificLimiter,
      "rust",
      options,
    );
  });

  it("returns the result from fetchSubredditContent", async () => {
    const expected: FetchedContent = {
      subreddit: "node",
      posts: [
        {
          post: {
            id: "abc",
            name: "t3_abc",
            subreddit: "node",
            title: "Test",
            selftext: "body",
            author: "user",
            score: 42,
            num_comments: 5,
            url: "https://reddit.com/r/node/abc",
            permalink: "/r/node/comments/abc",
            link_flair_text: null,
            over_18: false,
            created_utc: Date.now() / 1000,
            is_self: true,
          },
          comments: [],
        },
      ],
      fetchedAt: new Date(),
    };
    mockFetch.mockResolvedValueOnce(expected);

    const source = new RedditContentSource(client, rateLimiter);
    const result = await source.fetchContent("node", {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 3,
    });

    expect(result).toBe(expected);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.post.id).toBe("abc");
  });

  it("propagates errors from fetchSubredditContent", async () => {
    const error = new Error("API failure");
    mockFetch.mockRejectedValueOnce(error);

    const source = new RedditContentSource(client, rateLimiter);

    await expect(
      source.fetchContent("fail", {
        sorts: ["hot"],
        limit: 10,
        commentsPerPost: 5,
      }),
    ).rejects.toThrow("API failure");
  });
});
