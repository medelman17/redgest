import { loadConfig, type RedgestConfig } from "@redgest/config";
import { prisma, type PrismaClient } from "@redgest/db";
import {
  DomainEventBus,
  createExecute,
  createQuery,
  commandHandlers,
  queryHandlers,
  runDigestPipeline,
  type HandlerContext,
  type PipelineDeps,
} from "@redgest/core";
import {
  RedditClient,
  PublicRedditClient,
  TokenBucket,
  RedditContentSource,
} from "@redgest/reddit";
import type { RedditApiClient } from "@redgest/reddit";

/** Return type of bootstrap() — shared state injected into MCP tool handlers. */
export interface BootstrapResult {
  execute: ReturnType<typeof createExecute>;
  query: ReturnType<typeof createQuery>;
  ctx: HandlerContext;
  config: RedgestConfig;
  db: PrismaClient;
}

/**
 * Shared startup function for both HTTP and stdio entry points.
 *
 * Constructs all dependencies and wires the event-driven pipeline:
 * - Loads config, creates PrismaClient, EventBus, dispatchers
 * - Creates RedditContentSource (client + token bucket rate limiter)
 * - Registers DigestRequested → runDigestPipeline (Phase 1 in-process execution)
 */
export async function bootstrap(): Promise<BootstrapResult> {
  const config = loadConfig();
  const db = prisma;
  const eventBus = new DomainEventBus();
  const ctx: HandlerContext = { db, eventBus, config };

  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);

  let pipelineDeps: PipelineDeps;

  if (process.env.REDGEST_TEST_MODE === "1") {
    // Dynamic import from tests/fixtures — only in test mode.
    // Variable paths prevent TypeScript from resolving these at compile time
    // (they live outside rootDir and are only needed at runtime).
    const fixtureBase = "../../../tests/fixtures";
    const contentMod = await import(`${fixtureBase}/fake-content-source.js`);
    const llmMod = await import(`${fixtureBase}/fake-llm.js`);

    pipelineDeps = {
      db,
      eventBus,
      contentSource: new contentMod.FakeContentSource() as PipelineDeps["contentSource"],
      config,
      generateTriage: llmMod.fakeGenerateTriageResult as PipelineDeps["generateTriage"],
      generateSummary: llmMod.fakeGeneratePostSummary as PipelineDeps["generateSummary"],
    };
  } else {
    let redditClient: RedditApiClient;
    let rateLimiter: TokenBucket;

    if (config.REDDIT_CLIENT_ID && config.REDDIT_CLIENT_SECRET) {
      redditClient = new RedditClient({
        clientId: config.REDDIT_CLIENT_ID,
        clientSecret: config.REDDIT_CLIENT_SECRET,
        userAgent: "redgest/1.0.0",
      });
      rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
    } else {
      console.warn(
        "[bootstrap] REDDIT_CLIENT_ID/SECRET not set — using public .json endpoint (10 req/min limit)",
      );
      redditClient = new PublicRedditClient({ userAgent: "redgest/1.0.0" });
      rateLimiter = new TokenBucket({ capacity: 10, refillRate: 10 / 60 });
    }

    const contentSource = new RedditContentSource(redditClient, rateLimiter);

    pipelineDeps = { db, eventBus, contentSource, config };
  }

  // Shared fallback: run pipeline in-process, update job status on failure
  async function runInProcess(jobId: string, subredditIds: string[]): Promise<void> {
    try {
      await runDigestPipeline(jobId, subredditIds, pipelineDeps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[DigestRequested] Pipeline failed for job ${jobId}: ${message}`,
      );
      // Defensive: ensure job is marked FAILED (orchestrator should handle this,
      // but guard against edge cases where it can't, e.g. DB down during pipeline)
      try {
        await db.job.update({
          where: { id: jobId },
          data: { status: "FAILED", completedAt: new Date(), error: message },
        });
      } catch {
        console.error(`[DigestRequested] Failed to update job ${jobId} status to FAILED`);
      }
    }
  }

  // Trigger.dev dispatch if configured; otherwise in-process
  eventBus.on("DigestRequested", async (event) => {
    const { jobId, subredditIds } = event.payload;

    if (config.TRIGGER_SECRET_KEY) {
      try {
        const { tasks } = await import("@trigger.dev/sdk/v3");
        await tasks.trigger("generate-digest", { jobId, subredditIds });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[DigestRequested] Trigger.dev dispatch failed: ${message}, falling back to in-process`,
        );
        await runInProcess(jobId, subredditIds);
      }
    } else {
      await runInProcess(jobId, subredditIds);
    }
  });

  return { execute, query, ctx, config, db };
}
