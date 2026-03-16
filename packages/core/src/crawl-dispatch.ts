import type { EventBus } from "./events/bus";
import { runCrawl, type CrawlDeps } from "./crawl-pipeline";

export interface CrawlDispatchDeps {
  eventBus: EventBus;
  crawlDeps: CrawlDeps;
  triggerSecretKey?: string;
}

/**
 * Wires SubredditAdded events to trigger an immediate crawl (backfill).
 * If Trigger.dev is configured, dispatches to the crawl-subreddit task.
 * Otherwise, runs the crawl in-process.
 */
export function wireCrawlDispatch(deps: CrawlDispatchDeps): void {
  const { eventBus, crawlDeps, triggerSecretKey } = deps;

  async function runInProcess(subredditId: string): Promise<void> {
    try {
      await runCrawl(subredditId, crawlDeps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[CrawlDispatch] In-process crawl failed for subreddit ${subredditId}: ${message}`,
      );
    }
  }

  // On SubredditAdded → trigger immediate crawl (backfill)
  eventBus.subscribe("SubredditAdded", async (event) => {
    const { subredditId } = event.payload;

    if (triggerSecretKey) {
      try {
        const { tasks } = await import("@trigger.dev/sdk/v3");
        await tasks.trigger("crawl-subreddit", { subredditId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[CrawlDispatch] Trigger.dev dispatch failed: ${message}, falling back to in-process`,
        );
        await runInProcess(subredditId);
      }
    } else {
      await runInProcess(subredditId);
    }
  });
}
