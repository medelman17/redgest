import { RedgestError } from "@redgest/core";
import type { RedditApiClient } from "./client.js";

const PUBLIC_BASE = "https://www.reddit.com";

export interface PublicRedditClientOptions {
  userAgent: string;
}

/**
 * Reddit API client that uses the public `.json` endpoint.
 *
 * No OAuth credentials required — appends `.json` to Reddit URLs.
 * Rate limit is ~10 req/min (vs 60 req/min with OAuth).
 */
export class PublicRedditClient implements RedditApiClient {
  private readonly userAgent: string;

  constructor(options: PublicRedditClientOptions) {
    this.userAgent = options.userAgent;
  }

  async authenticate(): Promise<void> {
    // No-op — public endpoint needs no authentication
  }

  isAuthenticated(): boolean {
    return true;
  }

  async get<T>(path: string): Promise<T> {
    const url = this.buildUrl(path);
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.userAgent,
      },
    });
    return this.handleResponse<T>(response);
  }

  /** Transform API path to public .json URL. */
  private buildUrl(path: string): string {
    if (path.startsWith("http")) return path;

    const qIndex = path.indexOf("?");
    if (qIndex === -1) {
      return `${PUBLIC_BASE}${path}.json`;
    }
    const pathPart = path.slice(0, qIndex);
    const queryPart = path.slice(qIndex);
    return `${PUBLIC_BASE}${pathPart}.json${queryPart}`;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 403) {
      throw new RedgestError("REDDIT_API_ERROR", `Forbidden: ${response.statusText}`, {
        status: 403,
      });
    }
    if (response.status === 429) {
      throw new RedgestError("RATE_LIMITED", "Reddit API rate limit exceeded", {
        status: 429,
      });
    }
    if (!response.ok) {
      throw new RedgestError(
        "REDDIT_API_ERROR",
        `Reddit API error: ${response.status} ${response.statusText}`,
        { status: response.status },
      );
    }
    return response.json() as Promise<T>;
  }
}
