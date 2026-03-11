import { RedditClient, type RedditApiClient } from "./client.js";
import { PublicRedditClient } from "./public-client.js";
import { TokenBucket } from "./rate-limiter.js";
import { RedditContentSource } from "./content-source.js";

export interface CreateContentSourceOptions {
  clientId?: string;
  clientSecret?: string;
  userAgent?: string;
}

/**
 * Factory for creating a RedditContentSource with the appropriate client
 * and rate limiter based on whether OAuth credentials are available.
 *
 * - With credentials: authenticated Script-type client, 60 req/min
 * - Without credentials: public .json endpoint fallback, 10 req/min
 */
export function createContentSource(
  options: CreateContentSourceOptions,
): RedditContentSource {
  const userAgent = options.userAgent ?? "redgest/1.0.0";
  let redditClient: RedditApiClient;
  let rateLimiter: TokenBucket;

  if (options.clientId && options.clientSecret) {
    redditClient = new RedditClient({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      userAgent,
    });
    rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
  } else {
    redditClient = new PublicRedditClient({ userAgent });
    rateLimiter = new TokenBucket({ capacity: 10, refillRate: 10 / 60 });
  }

  return new RedditContentSource(redditClient, rateLimiter);
}
