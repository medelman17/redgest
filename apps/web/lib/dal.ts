import "server-only";

import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import {
  createEventBus,
  type EventBus,
  type EventBusTransport,
  createExecute,
  createQuery,
  createSearchService,
  commandHandlers,
  queryHandlers,
  wireDigestDispatch,
  type HandlerContext,
  type ExecuteContext,
  type CommandMap,
  type CommandResultMap,
  type QueryResultMap,
  type SearchService,
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
  eventBus: EventBus;
  searchService: SearchService;
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
  const eventBus = await createEventBus({
    transport: config.EVENT_BUS_TRANSPORT as EventBusTransport,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
  });

  // Cleanup external transport connections on process exit
  process.on("beforeExit", () => void eventBus.close());

  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);
  const searchService = createSearchService(db);

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

  const result: CachedInfra = { execute, query, db, eventBus, searchService };

  if (process.env.NODE_ENV !== "production") {
    globalForDal.__redgestInfra = result;
  }

  return result;
}

function buildContexts(
  infra: CachedInfra,
  organizationId: string,
  config: ReturnType<typeof loadConfig>,
): { executeCtx: ExecuteContext; queryCtx: HandlerContext } {
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
    searchService: infra.searchService,
  };
  return { executeCtx, queryCtx };
}

// Shared setup for all DAL operations — resolves org ID, infra, and contexts once.
async function getOrgContexts() {
  const [organizationId, infra] = await Promise.all([
    getOrganizationId(),
    getInfra(),
  ]);
  const config = loadConfig();
  const { executeCtx, queryCtx } = buildContexts(infra, organizationId, config);
  return { ...infra, executeCtx, queryCtx };
}

// --- Query wrappers ---

// Record<string, never> can't be constructed without a cast;
// typed constant avoids repeated object literal assertions
const EMPTY_PARAMS: Record<string, never> = {};

export async function listSubreddits(): Promise<
  QueryResultMap["ListSubreddits"]
> {
  const { query, queryCtx } = await getOrgContexts();
  return query("ListSubreddits", EMPTY_PARAMS, queryCtx);
}

export async function getConfig(): Promise<QueryResultMap["GetConfig"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetConfig", EMPTY_PARAMS, queryCtx);
}

export async function getDigest(
  digestId: string,
): Promise<QueryResultMap["GetDigest"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetDigest", { digestId }, queryCtx);
}

export async function listDigests(
  limit?: number,
  cursor?: string,
): Promise<QueryResultMap["ListDigests"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("ListDigests", { limit, cursor }, queryCtx);
}

export async function listRuns(
  limit?: number,
): Promise<QueryResultMap["ListRuns"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("ListRuns", { limit }, queryCtx);
}

export async function getRunStatus(
  jobId: string,
): Promise<QueryResultMap["GetRunStatus"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetRunStatus", { jobId }, queryCtx);
}

export async function getDigestByJobId(
  jobId: string,
): Promise<QueryResultMap["GetDigestByJobId"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetDigestByJobId", { jobId }, queryCtx);
}

// --- Command wrappers ---

export async function addSubreddit(
  params: CommandMap["AddSubreddit"],
): Promise<CommandResultMap["AddSubreddit"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("AddSubreddit", params, executeCtx);
}

export async function updateSubreddit(
  params: CommandMap["UpdateSubreddit"],
): Promise<CommandResultMap["UpdateSubreddit"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("UpdateSubreddit", params, executeCtx);
}

export async function removeSubreddit(
  subredditId: string,
): Promise<CommandResultMap["RemoveSubreddit"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("RemoveSubreddit", { subredditId }, executeCtx);
}

export async function updateConfig(
  params: CommandMap["UpdateConfig"],
): Promise<CommandResultMap["UpdateConfig"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("UpdateConfig", params, executeCtx);
}

export async function generateDigest(
  params: CommandMap["GenerateDigest"],
): Promise<CommandResultMap["GenerateDigest"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("GenerateDigest", params, executeCtx);
}

// --- Profile queries ---

export async function listProfiles(): Promise<
  QueryResultMap["ListProfiles"]
> {
  const { query, queryCtx } = await getOrgContexts();
  return query("ListProfiles", EMPTY_PARAMS, queryCtx);
}

export async function getProfile(
  profileId: string,
): Promise<QueryResultMap["GetProfile"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetProfile", { profileId }, queryCtx);
}

// --- Delivery queries ---

export async function getDeliveryStatus(
  digestId?: string,
  limit?: number,
): Promise<QueryResultMap["GetDeliveryStatus"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetDeliveryStatus", { digestId, limit }, queryCtx);
}

// --- Profile commands ---

export async function createProfile(
  params: CommandMap["CreateProfile"],
): Promise<CommandResultMap["CreateProfile"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("CreateProfile", params, executeCtx);
}

export async function updateProfile(
  params: CommandMap["UpdateProfile"],
): Promise<CommandResultMap["UpdateProfile"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("UpdateProfile", params, executeCtx);
}

export async function deleteProfile(
  profileId: string,
): Promise<CommandResultMap["DeleteProfile"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("DeleteProfile", { profileId }, executeCtx);
}

// --- Run commands ---

export async function cancelRun(
  jobId: string,
): Promise<CommandResultMap["CancelRun"]> {
  const { execute, executeCtx } = await getOrgContexts();
  return execute("CancelRun", { jobId }, executeCtx);
}

// --- Search queries ---

export async function searchPosts(params: {
  query: string;
  subreddit?: string;
  since?: string;
  sentiment?: string;
  minScore?: number;
  limit?: number;
}): Promise<QueryResultMap["SearchPosts"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("SearchPosts", params, queryCtx);
}

export async function searchDigests(params: {
  query: string;
  subreddit?: string;
  since?: string;
  limit?: number;
}): Promise<QueryResultMap["SearchDigests"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("SearchDigests", params, queryCtx);
}

export async function findSimilar(params: {
  postId: string;
  limit?: number;
  subreddit?: string;
}): Promise<QueryResultMap["FindSimilar"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("FindSimilar", params, queryCtx);
}

export async function askHistory(params: {
  question: string;
  limit?: number;
  subreddit?: string;
  since?: string;
}): Promise<QueryResultMap["AskHistory"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("AskHistory", params, queryCtx);
}

// --- Analytics queries ---

export async function getTrendingTopics(params?: {
  limit?: number;
  since?: string;
  subreddit?: string;
}): Promise<QueryResultMap["GetTrendingTopics"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetTrendingTopics", params ?? {}, queryCtx);
}

export async function getLlmMetrics(params?: {
  jobId?: string;
  limit?: number;
}): Promise<QueryResultMap["GetLlmMetrics"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetLlmMetrics", params ?? {}, queryCtx);
}

export async function getSubredditStats(params?: {
  name?: string;
}): Promise<QueryResultMap["GetSubredditStats"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetSubredditStats", params ?? {}, queryCtx);
}

export async function getCrawlStatus(params?: {
  name?: string;
}): Promise<QueryResultMap["GetCrawlStatus"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("GetCrawlStatus", params ?? {}, queryCtx);
}

export async function comparePeriods(params: {
  periodA: string;
  periodB: string;
  subreddit?: string;
}): Promise<QueryResultMap["ComparePeriods"]> {
  const { query, queryCtx } = await getOrgContexts();
  return query("ComparePeriods", params, queryCtx);
}
