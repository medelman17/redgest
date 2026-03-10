import type { ContentSource } from "@redgest/core";
import { fixturePostsForSubreddit } from "./reddit-data.js";

/**
 * Deterministic content source for testing.
 * Returns 3 fixture posts with 2 comments each for any subreddit.
 */
export class FakeContentSource implements ContentSource {
  async fetchContent(
    subreddit: string,
    _options: Parameters<ContentSource["fetchContent"]>[1],
  ): Promise<ReturnType<ContentSource["fetchContent"]> extends Promise<infer R> ? R : never> {
    return {
      subreddit,
      posts: fixturePostsForSubreddit(subreddit),
      fetchedAt: new Date(),
    };
  }
}
