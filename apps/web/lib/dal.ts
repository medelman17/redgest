import "server-only";

import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import {
  DomainEventBus,
  createExecute,
  createQuery,
  commandHandlers,
  queryHandlers,
  runDigestPipeline,
  type HandlerContext,
  type ExecuteContext,
  type PipelineDeps,
  type CommandMap,
  type CommandResultMap,
  type QueryResultMap,
} from "@redgest/core";
import {
  RedditClient,
  PublicRedditClient,
  TokenBucket,
  RedditContentSource,
  type RedditApiClient,
} from "@redgest/reddit";

// --- Bootstrap singleton (globalThis guard for HMR) ---

interface BootstrapResult {
  execute: ReturnType<typeof createExecute>;
  query: ReturnType<typeof createQuery>;
  queryCtx: HandlerContext;
  executeCtx: ExecuteContext;
}

const globalForDal = globalThis as unknown as {
  __redgestDal?: BootstrapResult;
};

async function getBootstrap(): Promise<BootstrapResult> {
  if (globalForDal.__redgestDal) {
    return globalForDal.__redgestDal;
  }

  const config = loadConfig();
  const db = prisma;
  const eventBus = new DomainEventBus();

  // execute() requires ExecuteContext (db: TransactableClient)
  // query() requires HandlerContext (db: DbClient)
  // Runtime db is always PrismaClient which satisfies both; cast needed
  // because Prisma's $transaction overloads don't structurally match
  // TransactableClient (same pattern as mcp-server/tools.ts:execCtx)
  const executeCtx: ExecuteContext = {
    db: db as unknown as ExecuteContext["db"],
    eventBus,
    config,
  };
  const queryCtx: HandlerContext = { db, eventBus, config };

  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);

  // Pipeline deps for in-process fallback
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
      "[dal] REDDIT_CLIENT_ID/SECRET not set — using public .json endpoint (10 req/min limit)",
    );
    redditClient = new PublicRedditClient({ userAgent: "redgest/1.0.0" });
    rateLimiter = new TokenBucket({ capacity: 10, refillRate: 10 / 60 });
  }
  const contentSource = new RedditContentSource(redditClient, rateLimiter);
  const pipelineDeps: PipelineDeps = { db, eventBus, contentSource, config };

  // In-process pipeline fallback — update job status on failure
  async function runInProcess(
    jobId: string,
    subredditIds: string[],
  ): Promise<void> {
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

  // Event wiring: DigestRequested → Trigger.dev or in-process
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

  const result: BootstrapResult = { execute, query, queryCtx, executeCtx };

  if (process.env.NODE_ENV !== "production") {
    globalForDal.__redgestDal = result;
  }

  return result;
}

// --- Query wrappers ---

// Record<string, never> can't be constructed without a cast;
// typed constant avoids repeated object literal assertions
const EMPTY_PARAMS: Record<string, never> = {};

export async function listSubreddits(): Promise<
  QueryResultMap["ListSubreddits"]
> {
  const { query, queryCtx } = await getBootstrap();
  return query("ListSubreddits", EMPTY_PARAMS, queryCtx);
}

export async function getConfig(): Promise<QueryResultMap["GetConfig"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetConfig", EMPTY_PARAMS, queryCtx);
}

export async function getDigest(
  digestId: string,
): Promise<QueryResultMap["GetDigest"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetDigest", { digestId }, queryCtx);
}

export async function listDigests(
  limit?: number,
): Promise<QueryResultMap["ListDigests"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("ListDigests", { limit }, queryCtx);
}

export async function listRuns(
  limit?: number,
): Promise<QueryResultMap["ListRuns"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("ListRuns", { limit }, queryCtx);
}

export async function getRunStatus(
  jobId: string,
): Promise<QueryResultMap["GetRunStatus"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetRunStatus", { jobId }, queryCtx);
}

export async function getDigestByJobId(
  jobId: string,
): Promise<QueryResultMap["GetDigestByJobId"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetDigestByJobId", { jobId }, queryCtx);
}

// --- Command wrappers ---

export async function addSubreddit(
  params: CommandMap["AddSubreddit"],
): Promise<CommandResultMap["AddSubreddit"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("AddSubreddit", params, executeCtx);
}

export async function updateSubreddit(
  params: CommandMap["UpdateSubreddit"],
): Promise<CommandResultMap["UpdateSubreddit"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("UpdateSubreddit", params, executeCtx);
}

export async function removeSubreddit(
  subredditId: string,
): Promise<CommandResultMap["RemoveSubreddit"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("RemoveSubreddit", { subredditId }, executeCtx);
}

export async function updateConfig(
  params: CommandMap["UpdateConfig"],
): Promise<CommandResultMap["UpdateConfig"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("UpdateConfig", params, executeCtx);
}

export async function generateDigest(
  params: CommandMap["GenerateDigest"],
): Promise<CommandResultMap["GenerateDigest"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("GenerateDigest", params, executeCtx);
}
