import { loadConfig, type RedgestConfig } from "@redgest/config";
import { prisma, type PrismaClient } from "@redgest/db";
import {
  DomainEventBus,
  createExecute,
  createQuery,
  createSearchService,
  commandHandlers,
  queryHandlers,
  wireDigestDispatch,
  recordDeliveryPending,
  recordDeliveryResult,
  type HandlerContext,
  type PipelineDeps,
  type DeliveryClient,
  type DeliveryTransactionClient,
} from "@redgest/core";
import { createContentSource, type ConnectivityStatus } from "@redgest/reddit";

/** Return type of bootstrap() — shared state injected into MCP tool handlers. */
export interface BootstrapResult {
  execute: ReturnType<typeof createExecute>;
  query: ReturnType<typeof createQuery>;
  ctx: HandlerContext;
  config: RedgestConfig;
  db: PrismaClient;
  checkConnectivity?: () => Promise<ConnectivityStatus>;
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
  const searchService = createSearchService(db);
  const ctx: HandlerContext = { db, eventBus, config, searchService };

  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);

  let pipelineDeps: PipelineDeps;
  let checkConnectivity: (() => Promise<ConnectivityStatus>) | undefined;

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

    checkConnectivity = () => contentSource.checkConnectivity();
    pipelineDeps = { db, eventBus, contentSource, config, searchService };
  }

  // Build in-process delivery callback for when Trigger.dev is not configured.
  // Uses dynamic imports to keep @redgest/email and @redgest/slack optional at load time.
  const deliverDigest = async (digestId: string, jobId: string) => {
    const digest = await db.digest.findUniqueOrThrow({
      where: { id: digestId },
      include: {
        digestPosts: {
          orderBy: { rank: "asc" },
          include: {
            post: {
              include: {
                summaries: { take: 1, orderBy: { createdAt: "desc" } },
              },
            },
          },
        },
      },
    });

    const { buildDeliveryData, sendDigestEmail } = await import(
      "@redgest/email"
    );
    const { sendDigestSlack } = await import("@redgest/slack");

    const deliveryData = buildDeliveryData(digest);

    // Determine which channels are configured
    const channels: Array<{
      name: string;
      type: "EMAIL" | "SLACK";
      send: () => Promise<unknown>;
    }> = [];

    if (config.RESEND_API_KEY && config.DELIVERY_EMAIL) {
      const { DELIVERY_EMAIL, RESEND_API_KEY } = config;
      channels.push({
        name: "email",
        type: "EMAIL",
        send: () =>
          sendDigestEmail(deliveryData, DELIVERY_EMAIL, RESEND_API_KEY),
      });
    }

    if (config.SLACK_WEBHOOK_URL) {
      const webhookUrl = config.SLACK_WEBHOOK_URL;
      channels.push({
        name: "slack",
        type: "SLACK",
        send: () => sendDigestSlack(deliveryData, webhookUrl),
      });
    }

    if (channels.length === 0) {
      console.warn(
        "[DigestCompleted] No delivery channels configured, skipping",
      );
      return;
    }

    // Record pending delivery rows
    await recordDeliveryPending(
      db as unknown as DeliveryClient,
      digestId,
      jobId,
      channels.map((ch) => ch.type),
    );

    // Dispatch to all configured channels
    const results = await Promise.allSettled(
      channels.map((ch) => ch.send()),
    );

    const delivered: string[] = [];
    for (const [i, r] of results.entries()) {
      const ch = channels[i];
      if (!ch) continue;

      if (r.status === "fulfilled") {
        delivered.push(ch.name);
        const externalId =
          r.value && typeof r.value === "object" && "id" in r.value
            ? String(r.value.id)
            : undefined;
        await recordDeliveryResult(
          db as unknown as DeliveryTransactionClient,
          digestId,
          jobId,
          ch.type,
          { ok: true, externalId },
        );
      } else {
        const errorMsg =
          r.reason instanceof Error ? r.reason.message : String(r.reason);
        await recordDeliveryResult(
          db as unknown as DeliveryTransactionClient,
          digestId,
          jobId,
          ch.type,
          { ok: false, error: errorMsg },
        );
      }
    }

    console.warn(
      `[DigestCompleted] In-process delivery: ${delivered.length > 0 ? delivered.join(", ") : "all channels failed"}`,
    );
  };

  wireDigestDispatch({
    eventBus,
    pipelineDeps,
    triggerSecretKey: config.TRIGGER_SECRET_KEY,
    deliverDigest,
  });

  return { execute, query, ctx, config, db, checkConnectivity };
}
