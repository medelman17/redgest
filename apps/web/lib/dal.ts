import "server-only";

import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import {
  DomainEventBus,
  createExecute,
  createQuery,
  commandHandlers,
  queryHandlers,
  wireDigestDispatch,
  type HandlerContext,
  type ExecuteContext,
  type CommandMap,
  type CommandResultMap,
  type QueryResultMap,
} from "@redgest/core";
import { createContentSource } from "@redgest/reddit";

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
  // TODO: Read organizationId from auth session once auth UI is wired
  const organizationId = process.env.REDGEST_ORG_ID ?? "org_default";
  const executeCtx: ExecuteContext = {
    db: db as unknown as ExecuteContext["db"],
    eventBus,
    config,
    organizationId,
  };
  const queryCtx: HandlerContext = { db, eventBus, config, organizationId };

  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);

  const contentSource = createContentSource({
    clientId: config.REDDIT_CLIENT_ID,
    clientSecret: config.REDDIT_CLIENT_SECRET,
  });

  wireDigestDispatch({
    eventBus,
    pipelineDeps: { db, eventBus, contentSource, config },
    triggerSecretKey: config.TRIGGER_SECRET_KEY,
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
  cursor?: string,
): Promise<QueryResultMap["ListDigests"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("ListDigests", { limit, cursor }, queryCtx);
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

// --- Profile queries ---

export async function listProfiles(): Promise<
  QueryResultMap["ListProfiles"]
> {
  const { query, queryCtx } = await getBootstrap();
  return query("ListProfiles", EMPTY_PARAMS, queryCtx);
}

export async function getProfile(
  profileId: string,
): Promise<QueryResultMap["GetProfile"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetProfile", { profileId }, queryCtx);
}

// --- Delivery queries ---

export async function getDeliveryStatus(
  digestId?: string,
  limit?: number,
): Promise<QueryResultMap["GetDeliveryStatus"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetDeliveryStatus", { digestId, limit }, queryCtx);
}

// --- Profile commands ---

export async function createProfile(
  params: CommandMap["CreateProfile"],
): Promise<CommandResultMap["CreateProfile"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("CreateProfile", params, executeCtx);
}

export async function updateProfile(
  params: CommandMap["UpdateProfile"],
): Promise<CommandResultMap["UpdateProfile"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("UpdateProfile", params, executeCtx);
}

export async function deleteProfile(
  profileId: string,
): Promise<CommandResultMap["DeleteProfile"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("DeleteProfile", { profileId }, executeCtx);
}

// --- Run commands ---

export async function cancelRun(
  jobId: string,
): Promise<CommandResultMap["CancelRun"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("CancelRun", { jobId }, executeCtx);
}
