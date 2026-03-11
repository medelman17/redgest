import type { RedditApiClient } from "./client.js";
import type { TokenBucket } from "./rate-limiter.js";
import { fetchSubredditContent } from "./fetcher.js";
import type { FetchOptions, FetchedContent } from "./fetcher.js";

export class RedditContentSource {
  constructor(
    private client: RedditApiClient,
    private rateLimiter: TokenBucket,
  ) {}

  async fetchContent(
    subreddit: string,
    options: FetchOptions,
  ): Promise<FetchedContent> {
    return fetchSubredditContent(
      this.client,
      this.rateLimiter,
      subreddit,
      options,
    );
  }
}
