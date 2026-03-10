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

  const redditClient = new RedditClient({
    clientId: config.REDDIT_CLIENT_ID,
    clientSecret: config.REDDIT_CLIENT_SECRET,
    userAgent: "redgest/1.0.0",
  });
  const rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
  const contentSource = new RedditContentSource(redditClient, rateLimiter);

  const pipelineDeps: PipelineDeps = { db, eventBus, contentSource, config };

  // Phase 1: in-process execution; swap to Trigger.dev in Phase 2
  eventBus.on("DigestRequested", async (event) => {
    const { jobId, subredditIds } = event.payload;
    try {
      await runDigestPipeline(jobId, subredditIds, pipelineDeps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[DigestRequested] Pipeline failed for job ${jobId}: ${message}`);
    }
  });

  return { execute, query, ctx, config, db };
}
