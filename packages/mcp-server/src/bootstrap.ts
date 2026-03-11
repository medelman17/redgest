import { loadConfig, type RedgestConfig } from "@redgest/config";
import { prisma, type PrismaClient } from "@redgest/db";
import {
  DomainEventBus,
  createExecute,
  createQuery,
  commandHandlers,
  queryHandlers,
  wireDigestDispatch,
  type HandlerContext,
  type PipelineDeps,
} from "@redgest/core";
import { createContentSource } from "@redgest/reddit";

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
    const contentSource = createContentSource({
      clientId: config.REDDIT_CLIENT_ID,
      clientSecret: config.REDDIT_CLIENT_SECRET,
    });

    pipelineDeps = { db, eventBus, contentSource, config };
  }

  wireDigestDispatch({
    eventBus,
    pipelineDeps,
    triggerSecretKey: config.TRIGGER_SECRET_KEY,
  });

  return { execute, query, ctx, config, db };
}
