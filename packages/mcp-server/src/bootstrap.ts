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
  TokenBucket,
  RedditContentSource,
} from "@redgest/reddit";

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
    const redditClient = new RedditClient({
      clientId: config.REDDIT_CLIENT_ID,
      clientSecret: config.REDDIT_CLIENT_SECRET,
      userAgent: "redgest/1.0.0",
    });
    const rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
    const contentSource = new RedditContentSource(redditClient, rateLimiter);

    pipelineDeps = { db, eventBus, contentSource, config };
  }

  // Phase 2: Trigger.dev dispatch if configured; fallback to in-process
  if (config.TRIGGER_SECRET_KEY) {
    eventBus.on("DigestRequested", async (event) => {
      const { jobId, subredditIds } = event.payload;
      try {
        const { tasks } = await import("@trigger.dev/sdk/v3");
        await tasks.trigger("generate-digest", { jobId, subredditIds });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[DigestRequested] Trigger.dev dispatch failed: ${message}, falling back to in-process`,
        );
        // Fallback to in-process on dispatch failure
        try {
          await runDigestPipeline(jobId, subredditIds, pipelineDeps);
        } catch (fallbackErr) {
          const fbMsg =
            fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr);
          console.error(
            `[DigestRequested] Pipeline failed for job ${jobId}: ${fbMsg}`,
          );
        }
      }
    });
  } else {
    // In-process fallback (no Trigger.dev configured)
    eventBus.on("DigestRequested", async (event) => {
      const { jobId, subredditIds } = event.payload;
      try {
        await runDigestPipeline(jobId, subredditIds, pipelineDeps);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[DigestRequested] Pipeline failed for job ${jobId}: ${message}`,
        );
      }
    });
  }

  return { execute, query, ctx, config, db };
}
