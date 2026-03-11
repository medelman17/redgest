import type { RedditApiClient, ConnectionTestResult } from "./client.js";
import type { TokenBucket } from "./rate-limiter.js";
import { fetchSubredditContent } from "./fetcher.js";
import type { FetchOptions, FetchedContent } from "./fetcher.js";

export interface ConnectivityStatus extends ConnectionTestResult {
  rateLimiter: {
    availableTokens: number;
    capacity: number;
    refillRate: number;
    pendingRequests: number;
  };
}

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

  async checkConnectivity(): Promise<ConnectivityStatus> {
    const connectionResult = await this.client.testConnection();
    const rateLimiterState = this.rateLimiter.getState();
    return {
      ...connectionResult,
      rateLimiter: rateLimiterState,
    };
  }
}
