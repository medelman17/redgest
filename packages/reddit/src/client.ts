import { RedgestError } from "@redgest/core";
import type { RedditAuthToken } from "./types.js";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

export interface RedditClientOptions {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}

export class RedditClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly userAgent: string;
  private token: RedditAuthToken | null = null;

  constructor(options: RedditClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.userAgent = options.userAgent;
  }

  async authenticate(): Promise<void> {
    const credentials = btoa(`${this.clientId}:${this.clientSecret}`);
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.userAgent,
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      throw new RedgestError(
        "REDDIT_API_ERROR",
        `Authentication failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    this.token = {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  isAuthenticated(): boolean {
    return this.token !== null && Date.now() < this.token.expiresAt;
  }

  async get<T>(path: string): Promise<T> {
    if (!this.token) {
      throw new RedgestError(
        "REDDIT_API_ERROR",
        "Not authenticated. Call authenticate() first.",
      );
    }

    const response = await this.request(path, this.token);

    if (response.status === 401) {
      await this.authenticate();
      if (!this.token) {
        throw new RedgestError("REDDIT_API_ERROR", "Re-authentication failed");
      }
      const retry = await this.request(path, this.token);
      return this.handleResponse<T>(retry);
    }

    return this.handleResponse<T>(response);
  }

  private async request(path: string, token: RedditAuthToken): Promise<Response> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
    return fetch(url, {
      headers: {
        Authorization: `${token.tokenType} ${token.accessToken}`,
        "User-Agent": this.userAgent,
      },
    });
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
