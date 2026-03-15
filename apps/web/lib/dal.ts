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
import { getOrganizationId } from "./auth-utils.js";

// --- Bootstrap singleton (globalThis guard for HMR) ---
// Caches only infra that is org-independent: execute/query factories, db, eventBus, config.
// Per-request contexts (executeCtx, queryCtx) are built fresh each call using the
// session org ID from BetterAuth.

interface CachedInfra {
  execute: ReturnType<typeof createExecute>;
  query: ReturnType<typeof createQuery>;
  db: typeof prisma;
  eventBus: DomainEventBus;
}

const globalForDal = globalThis as unknown as {
  __redgestInfra?: CachedInfra;
};

async function getInfra(): Promise<CachedInfra> {
  if (globalForDal.__redgestInfra) {
    return globalForDal.__redgestInfra;
  }

  const config = loadConfig();
  const db = prisma;
  const eventBus = new DomainEventBus();

  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);

  const contentSource = createContentSource({
    clientId: config.REDDIT_CLIENT_ID,
    clientSecret: config.REDDIT_CLIENT_SECRET,
  });

  // wireDigestDispatch stays in infra init — digest pipeline runs in Trigger.dev
  // and gets organizationId from the job payload, not from the session.
  wireDigestDispatch({
    eventBus,
    pipelineDeps: { db, eventBus, contentSource, config, organizationId: "placeholder" },
    triggerSecretKey: config.TRIGGER_SECRET_KEY,
  });

  const result: CachedInfra = { execute, query, db, eventBus };

  if (process.env.NODE_ENV !== "production") {
    globalForDal.__redgestInfra = result;
  }

  return result;
}

function buildContexts(
  infra: CachedInfra,
  organizationId: string,
): { executeCtx: ExecuteContext; queryCtx: HandlerContext } {
  const config = loadConfig();
  // Runtime db is always PrismaClient which satisfies both context types at runtime;
  // the cast is needed because Prisma's $transaction overloads don't structurally
  // match TransactableClient (same pattern as mcp-server/tools.ts:execCtx)
  const executeCtx: ExecuteContext = {
    db: infra.db as unknown as ExecuteContext["db"],
    eventBus: infra.eventBus,
    config,
    organizationId,
  };
  const queryCtx: HandlerContext = {
    db: infra.db,
    eventBus: infra.eventBus,
    config,
    organizationId,
  };
  return { executeCtx, queryCtx };
}

// --- Query wrappers ---

// Record<string, never> can't be constructed without a cast;
// typed constant avoids repeated object literal assertions
const EMPTY_PARAMS: Record<string, never> = {};

export async function listSubreddits(): Promise<
  QueryResultMap["ListSubreddits"]
> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("ListSubreddits", EMPTY_PARAMS, queryCtx);
}

export async function getConfig(): Promise<QueryResultMap["GetConfig"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("GetConfig", EMPTY_PARAMS, queryCtx);
}

export async function getDigest(
  digestId: string,
): Promise<QueryResultMap["GetDigest"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("GetDigest", { digestId }, queryCtx);
}

export async function listDigests(
  limit?: number,
  cursor?: string,
): Promise<QueryResultMap["ListDigests"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("ListDigests", { limit, cursor }, queryCtx);
}

export async function listRuns(
  limit?: number,
): Promise<QueryResultMap["ListRuns"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("ListRuns", { limit }, queryCtx);
}

export async function getRunStatus(
  jobId: string,
): Promise<QueryResultMap["GetRunStatus"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("GetRunStatus", { jobId }, queryCtx);
}

export async function getDigestByJobId(
  jobId: string,
): Promise<QueryResultMap["GetDigestByJobId"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("GetDigestByJobId", { jobId }, queryCtx);
}

// --- Command wrappers ---

export async function addSubreddit(
  params: CommandMap["AddSubreddit"],
): Promise<CommandResultMap["AddSubreddit"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("AddSubreddit", params, executeCtx);
}

export async function updateSubreddit(
  params: CommandMap["UpdateSubreddit"],
): Promise<CommandResultMap["UpdateSubreddit"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("UpdateSubreddit", params, executeCtx);
}

export async function removeSubreddit(
  subredditId: string,
): Promise<CommandResultMap["RemoveSubreddit"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("RemoveSubreddit", { subredditId }, executeCtx);
}

export async function updateConfig(
  params: CommandMap["UpdateConfig"],
): Promise<CommandResultMap["UpdateConfig"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("UpdateConfig", params, executeCtx);
}

export async function generateDigest(
  params: CommandMap["GenerateDigest"],
): Promise<CommandResultMap["GenerateDigest"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("GenerateDigest", params, executeCtx);
}

// --- Profile queries ---

export async function listProfiles(): Promise<
  QueryResultMap["ListProfiles"]
> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("ListProfiles", EMPTY_PARAMS, queryCtx);
}

export async function getProfile(
  profileId: string,
): Promise<QueryResultMap["GetProfile"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("GetProfile", { profileId }, queryCtx);
}

// --- Delivery queries ---

export async function getDeliveryStatus(
  digestId?: string,
  limit?: number,
): Promise<QueryResultMap["GetDeliveryStatus"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { query, queryCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return query("GetDeliveryStatus", { digestId, limit }, queryCtx);
}

// --- Profile commands ---

export async function createProfile(
  params: CommandMap["CreateProfile"],
): Promise<CommandResultMap["CreateProfile"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("CreateProfile", params, executeCtx);
}

export async function updateProfile(
  params: CommandMap["UpdateProfile"],
): Promise<CommandResultMap["UpdateProfile"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("UpdateProfile", params, executeCtx);
}

export async function deleteProfile(
  profileId: string,
): Promise<CommandResultMap["DeleteProfile"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("DeleteProfile", { profileId }, executeCtx);
}

// --- Run commands ---

export async function cancelRun(
  jobId: string,
): Promise<CommandResultMap["CancelRun"]> {
  const organizationId = await getOrganizationId();
  const infra = await getInfra();
  const { execute, executeCtx } = { ...infra, ...buildContexts(infra, organizationId) };
  return execute("CancelRun", { jobId }, executeCtx);
}
