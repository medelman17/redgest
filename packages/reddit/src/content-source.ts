import type { RedditApiClient, ConnectionTestResult } from "./client";
import type { TokenBucket } from "./rate-limiter";
import { fetchSubredditContent } from "./fetcher";
import type { FetchOptions, FetchedContent } from "./fetcher";

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
