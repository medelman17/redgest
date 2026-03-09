/**
 * Reddit OAuth2 token response.
 */
export interface RedditAuthToken {
  accessToken: string;
  tokenType: string;
  expiresAt: number; // Unix timestamp (ms)
}

/**
 * Reddit API "thing" wrapper for listings.
 */
export interface RedditListing<T> {
  kind: "Listing";
  data: {
    after: string | null;
    before: string | null;
    children: Array<{ kind: string; data: T }>;
  };
}

/**
 * Reddit post (t3) data from the API.
 * Only the fields we use — Reddit returns many more.
 */
export interface RedditPostData {
  id: string;
  name: string; // t3_ prefixed
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  link_flair_text: string | null;
  over_18: boolean;
  created_utc: number;
  is_self: boolean;
}

/**
 * Reddit comment (t1) data from the API.
 */
export interface RedditCommentData {
  id: string;
  name: string; // t1_ prefixed
  author: string;
  body: string;
  score: number;
  depth: number;
  created_utc: number;
}

/**
 * Options for fetching subreddit posts.
 */
export interface FetchPostsOptions {
  subreddit: string;
  sort: "hot" | "top" | "rising" | "new";
  limit?: number;
  timeframe?: "hour" | "day" | "week" | "month" | "year" | "all";
}
