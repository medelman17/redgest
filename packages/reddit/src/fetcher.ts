import type { RedditApiClient } from "./client";
import type { TokenBucket } from "./rate-limiter";
import type {
  RedditListing,
  RedditPostData,
  RedditCommentData,
} from "./types";

export interface FetchOptions {
  sorts: Array<"hot" | "top" | "rising">;
  limit: number;
  timeRange?: "hour" | "day" | "week" | "month" | "year" | "all";
  commentsPerPost: number;
}

export interface FetchedContent {
  subreddit: string;
  posts: Array<{
    post: RedditPostData;
    comments: RedditCommentData[];
  }>;
  fetchedAt: Date;
}

export async function fetchSubredditContent(
  client: RedditApiClient,
  rateLimiter: TokenBucket,
  subreddit: string,
  options: FetchOptions,
): Promise<FetchedContent> {
  const allPosts = new Map<string, RedditPostData>();

  for (const sort of options.sorts) {
    await rateLimiter.acquire();
    const params = new URLSearchParams({ limit: String(options.limit) });
    if (sort === "top" && options.timeRange) {
      params.set("t", options.timeRange);
    }
    const listing = await client.get<RedditListing<RedditPostData>>(
      `/r/${subreddit}/${sort}?${params.toString()}`,
    );
    for (const child of listing.data.children) {
      allPosts.set(child.data.id, child.data);
    }
  }

  const results: FetchedContent["posts"] = [];

  for (const post of allPosts.values()) {
    await rateLimiter.acquire();
    const response = await client.get<
      [RedditListing<RedditPostData>, RedditListing<RedditCommentData>]
    >(
      `/r/${subreddit}/comments/${post.id}?limit=${options.commentsPerPost}&sort=top`,
    );
    const comments = response[1].data.children
      .filter((c) => c.kind === "t1")
      .map((c) => c.data);
    results.push({ post, comments });
  }

  return {
    subreddit,
    posts: results,
    fetchedAt: new Date(),
  };
}
