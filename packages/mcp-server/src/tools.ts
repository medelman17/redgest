import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, RedgestError, type ExecuteContext } from "@redgest/core";
import type { DeliveryChannel } from "@redgest/db";
import { buildDeliveryData, renderDigestHtml } from "@redgest/email";
import { formatDigestBlocks, type SlackBlock } from "@redgest/slack";
import type { BootstrapResult } from "./bootstrap.js";
import { envelope, envelopeError, type ToolResult } from "./envelope.js";

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// ── Shared helpers ───────────────────────────────────────────────────

async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RedgestError) {
      return envelopeError(err.code, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[MCP] Unexpected error:", message);
    return envelopeError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred");
  }
}

function parseLookback(lookback?: string): number | undefined {
  if (!lookback) return undefined;
  const match = lookback.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new RedgestError(
      "VALIDATION_ERROR",
      `Invalid lookback format "${lookback}". Use a number with m (minutes), h (hours), or d (days), e.g. "48h", "2d", "30m".`,
    );
  }
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "m") return value / 60;
  if (unit === "d") return value * 24;
  return value; // hours
}

async function lookupSubredditId(
  name: string,
  deps: BootstrapResult,
): Promise<string | null> {
  const subs = await deps.query("ListSubreddits", {}, deps.ctx);
  const match = subs.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
  return match ? match.id : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSubredditIds(
  inputs: string[],
  deps: BootstrapResult,
): Promise<string[]> {
  const ids: string[] = [];
  const namesToResolve: string[] = [];

  for (const s of inputs) {
    if (UUID_RE.test(s)) {
      ids.push(s);
    } else {
      namesToResolve.push(s);
    }
  }

  if (namesToResolve.length === 0) return ids;

  const allSubs = await deps.query("ListSubreddits", {}, deps.ctx);
  for (const name of namesToResolve) {
    const match = allSubs.find(
      (s) => s.name.toLowerCase() === name.toLowerCase(),
    );
    if (!match) {
      throw new RedgestError("NOT_FOUND", `Subreddit "${name}" not found`);
    }
    ids.push(match.id);
  }

  return ids;
}

/** Runtime deps.db is always the full PrismaClient; cast is safe. */
function execCtx(deps: BootstrapResult): ExecuteContext {
  return {
    db: deps.db as unknown as ExecuteContext["db"],
    eventBus: deps.ctx.eventBus,
    config: deps.ctx.config,
  };
}

// ── Usage guide ──────────────────────────────────────────────────────

const USAGE_GUIDE = `# Redgest — Reddit Digest Engine

## Quick Start
1. **add_subreddit** — Add subreddits you want to monitor
2. **list_subreddits** — See your monitored subreddits
3. **generate_digest** — Trigger a new digest run
4. **get_run_status** — Check progress of a digest run
5. **get_digest** — Retrieve the latest digest (or a specific one)

## All Tools

### Digest Generation
- **generate_digest** — Start a new digest run for configured subreddits
- **get_run_status** — Check the status of a digest run by job ID
- **list_runs** — List recent digest runs
- **cancel_run** — Cancel an in-progress or queued digest run

### Digest Retrieval
- **get_digest** — Get a specific digest by ID, or the latest
- **list_digests** — List recent digests
- **search_digests** — Full-text search across digests (filter by subreddit, since)
- **preview_digest** — Preview a digest rendered for a specific delivery channel (markdown, email HTML, Slack blocks)
- **compare_digests** — Compare two digests: new/dropped posts, overlap, subreddit trends
- **get_delivery_status** — Check delivery status (email/Slack) for one or more digests

### Post Access
- **get_post** — Get a specific post summary by ID
- **search_posts** — Full-text search across post summaries (filter by subreddit, since, sentiment, min_score)
- **find_similar** — Find posts similar to a given post based on semantic similarity
- **ask_history** — Search digest history using natural language

### Subreddit Management
- **add_subreddit** — Add a subreddit to monitor
- **remove_subreddit** — Remove a monitored subreddit by name
- **update_subreddit** — Update subreddit settings (insight prompt, max posts, active)
- **list_subreddits** — List all monitored subreddits
- **get_subreddit_stats** — View per-subreddit metrics (posts fetched, digest appearances, utilization)

### Configuration
- **get_config** — View current global configuration
- **update_config** — Update global settings (insight prompt, lookback, LLM provider/model, delivery channel, schedule)

### Observability
- **get_llm_metrics** — View LLM usage metrics (tokens, latency, cache hits) by task type
- **check_reddit_connectivity** — Test Reddit API health: status, auth type, latency, rate limiter state

### Trends & History
- **get_trending_topics** — View trending topics with frequency and recency (filter by subreddit or time window)
- **compare_periods** — Compare two time periods: volume changes, new/dropped topics, subreddit activity shifts

### Help
- **use_redgest** — Show this usage guide

## Error Codes

All tools return errors in a consistent envelope: \`{ ok: false, error: { code, message } }\`

| Code | Meaning |
|------|---------|
| NOT_FOUND | Requested resource (digest, post, run, subreddit, config) does not exist |
| VALIDATION_ERROR | Invalid input (e.g. bad lookback format "abc" — use "48h", "2d", "30m") |
| CONFLICT | Action conflicts with current state (e.g. a digest run is already in progress) |
| INTERNAL_ERROR | Unexpected server error — retry or check logs |

### Per-Tool Error Codes

| Tool | Possible Codes |
|------|---------------|
| generate_digest | NOT_FOUND, VALIDATION_ERROR, CONFLICT, INTERNAL_ERROR |
| get_run_status | NOT_FOUND, INTERNAL_ERROR |
| get_digest | NOT_FOUND, INTERNAL_ERROR |
| get_post | NOT_FOUND, INTERNAL_ERROR |
| remove_subreddit | NOT_FOUND, INTERNAL_ERROR |
| update_subreddit | NOT_FOUND, INTERNAL_ERROR |
| get_config | NOT_FOUND, INTERNAL_ERROR |
| list_runs, list_digests, list_subreddits | INTERNAL_ERROR |
| search_posts, search_digests | INTERNAL_ERROR |
| find_similar, ask_history | INTERNAL_ERROR |
| add_subreddit, update_config | INTERNAL_ERROR |
| cancel_run | NOT_FOUND, CONFLICT, INTERNAL_ERROR |
| get_llm_metrics | INTERNAL_ERROR |
| check_reddit_connectivity | INTERNAL_ERROR |
| get_subreddit_stats | INTERNAL_ERROR |
| preview_digest | NOT_FOUND, CONFLICT, VALIDATION_ERROR, INTERNAL_ERROR |
| compare_digests | NOT_FOUND, VALIDATION_ERROR, INTERNAL_ERROR |
| get_delivery_status | NOT_FOUND, INTERNAL_ERROR |
| get_trending_topics | INTERNAL_ERROR |
| compare_periods | VALIDATION_ERROR, INTERNAL_ERROR |`;

// ── Handler factory ───────────────────────────────────────────────────

export function createToolHandlers(
  deps: BootstrapResult,
): Record<string, ToolHandler> {
  const eCtx = execCtx(deps);

  const handlers: Record<string, ToolHandler> = {
    use_redgest: async () => {
      return envelope(USAGE_GUIDE);
    },

    generate_digest: async (args) => {
      return safe(async () => {
        const subreddits = args.subreddits as string[] | undefined;
        const lookback = args.lookback as string | undefined;
        const subredditIds =
          subreddits && subreddits.length > 0
            ? await resolveSubredditIds(subreddits, deps)
            : subreddits;
        const result = await deps.execute(
          "GenerateDigest",
          {
            subredditIds,
            lookbackHours: parseLookback(lookback),
            forceRefresh: args.force_refresh as boolean | undefined,
          },
          eCtx,
        );
        return envelope(result);
      });
    },

    get_run_status: async (args) => {
      return safe(async () => {
        const jobId = args.jobId as string;
        const result = await deps.query(
          "GetRunStatus",
          { jobId },
          deps.ctx,
        );
        if (!result) return envelopeError(ErrorCode.NOT_FOUND, `Run ${jobId} not found`);
        return envelope(result);
      });
    },

    list_runs: async (args) => {
      return safe(async () => {
        const limit = args.limit as number | undefined;
        const cursor = args.cursor as string | undefined;
        const result = await deps.query(
          "ListRuns",
          { limit, cursor },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    get_digest: async (args) => {
      return safe(async () => {
        let digestId = args.digestId as string | undefined;

        if (!digestId) {
          const result = await deps.query(
            "ListDigests",
            { limit: 1 },
            deps.ctx,
          );
          const first = result.items[0];
          if (!first) {
            return envelopeError(ErrorCode.NOT_FOUND, "No digests found");
          }
          digestId = first.digestId;
        }

        const result = await deps.query(
          "GetDigest",
          { digestId },
          deps.ctx,
        );
        if (!result) return envelopeError(ErrorCode.NOT_FOUND, `Digest ${digestId} not found`);
        return envelope(result);
      });
    },

    get_post: async (args) => {
      return safe(async () => {
        const postId = args.postId as string;
        const result = await deps.query(
          "GetPost",
          { postId },
          deps.ctx,
        );
        if (!result) return envelopeError(ErrorCode.NOT_FOUND, `Post ${postId} not found`);
        return envelope(result);
      });
    },

    list_digests: async (args) => {
      return safe(async () => {
        const limit = args.limit as number | undefined;
        const cursor = args.cursor as string | undefined;
        const result = await deps.query(
          "ListDigests",
          { limit, cursor },
          deps.ctx,
        );
        const summaries = result.items.map((d) => ({
          digestId: d.digestId,
          jobId: d.jobId,
          jobStatus: d.jobStatus,
          startedAt: d.startedAt,
          completedAt: d.completedAt,
          subredditList: d.subredditList,
          postCount: d.postCount,
          createdAt: d.createdAt,
        }));
        return envelope({
          items: summaries,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        });
      });
    },

    search_posts: async (args) => {
      return safe(async () => {
        const query = args.query as string;
        const limit = args.limit as number | undefined;
        const subreddit = args.subreddit as string | undefined;
        const since = args.since as string | undefined;
        const sentiment = args.sentiment as string | undefined;
        const minScore = args.min_score as number | undefined;
        const result = await deps.query(
          "SearchPosts",
          { query, limit, subreddit, since, sentiment, minScore },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    search_digests: async (args) => {
      return safe(async () => {
        const query = args.query as string;
        const limit = args.limit as number | undefined;
        const subreddit = args.subreddit as string | undefined;
        const since = args.since as string | undefined;
        const result = await deps.query(
          "SearchDigests",
          { query, limit, subreddit, since },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    find_similar: async (args) => {
      return safe(async () => {
        const postId = args.postId as string;
        const limit = args.limit as number | undefined;
        const subreddit = args.subreddit as string | undefined;
        const result = await deps.query(
          "FindSimilar",
          { postId, limit, subreddit },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    ask_history: async (args) => {
      return safe(async () => {
        const question = args.question as string;
        const limit = args.limit as number | undefined;
        const subreddit = args.subreddit as string | undefined;
        const since = args.since as string | undefined;
        const result = await deps.query(
          "AskHistory",
          { question, limit, subreddit, since },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    list_subreddits: async () => {
      return safe(async () => {
        const result = await deps.query("ListSubreddits", {}, deps.ctx);
        return envelope(result);
      });
    },

    get_subreddit_stats: async (args) => {
      return safe(async () => {
        const name = args.name as string | undefined;
        const result = await deps.query(
          "GetSubredditStats",
          { name },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    add_subreddit: async (args) => {
      return safe(async () => {
        const name = args.name as string;
        const result = await deps.execute(
          "AddSubreddit",
          {
            name,
            displayName: name,
            insightPrompt: args.insightPrompt as string | undefined,
            maxPosts: args.maxPosts as number | undefined,
            nsfw: args.includeNsfw as boolean | undefined,
          },
          eCtx,
        );
        return envelope(result);
      });
    },

    remove_subreddit: async (args) => {
      return safe(async () => {
        const name = args.name as string;
        const subredditId = await lookupSubredditId(name, deps);
        if (!subredditId) {
          return envelopeError(ErrorCode.NOT_FOUND, `Subreddit "${name}" not found`);
        }
        const result = await deps.execute(
          "RemoveSubreddit",
          { subredditId },
          eCtx,
        );
        return envelope(result);
      });
    },

    update_subreddit: async (args) => {
      return safe(async () => {
        const name = args.name as string;
        const subredditId = await lookupSubredditId(name, deps);
        if (!subredditId) {
          return envelopeError(ErrorCode.NOT_FOUND, `Subreddit "${name}" not found`);
        }
        const result = await deps.execute(
          "UpdateSubreddit",
          {
            subredditId,
            insightPrompt: args.insightPrompt as string | undefined,
            maxPosts: args.maxPosts as number | undefined,
            active: args.active as boolean | undefined,
          },
          eCtx,
        );
        return envelope(result);
      });
    },

    get_config: async () => {
      return safe(async () => {
        const result = await deps.query("GetConfig", {}, deps.ctx);
        if (!result) return envelopeError(ErrorCode.NOT_FOUND, "Config not found");
        return envelope(result);
      });
    },

    update_config: async (args) => {
      return safe(async () => {
        const result = await deps.execute(
          "UpdateConfig",
          {
            globalInsightPrompt: args.globalInsightPrompt as string | undefined,
            defaultLookbackHours: args.defaultLookbackHours as number | undefined,
            llmProvider: args.llmProvider as string | undefined,
            llmModel: args.llmModel as string | undefined,
            defaultDelivery: args.defaultDelivery as DeliveryChannel | undefined,
            schedule: args.schedule as string | null | undefined,
          },
          eCtx,
        );
        return envelope(result);
      });
    },

    get_llm_metrics: async (args) => {
      return safe(async () => {
        const jobId = args.jobId as string | undefined;
        const limit = args.limit as number | undefined;
        const result = await deps.query(
          "GetLlmMetrics",
          { jobId, limit },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    cancel_run: async (args) => {
      return safe(async () => {
        const jobId = args.jobId as string;
        const result = await deps.execute(
          "CancelRun",
          { jobId },
          eCtx,
        );
        return envelope(result);
      });
    },

    check_reddit_connectivity: async () => {
      return safe(async () => {
        if (!deps.checkConnectivity) {
          return envelopeError(
            ErrorCode.INTERNAL_ERROR,
            "Reddit connectivity check is not available (test mode or missing credentials)",
          );
        }
        const result = await deps.checkConnectivity();
        return envelope(result);
      });
    },

    get_delivery_status: async (args) =>
      safe(async () => {
        const params: { digestId?: string; limit?: number } = {};
        if (typeof args.digestId === "string") params.digestId = args.digestId;
        if (typeof args.limit === "number") params.limit = args.limit;

        const result = await deps.query("GetDeliveryStatus", params, deps.ctx);
        return envelope(result);
      }),

    compare_digests: async (args) => {
      return safe(async () => {
        let digestIdA = args.digestIdA as string;
        let digestIdB = args.digestIdB as string;
        const subreddit = args.subreddit as string | undefined;

        // Resolve shorthand
        const needsResolution = digestIdA === "latest" || digestIdA === "previous"
          || digestIdB === "latest" || digestIdB === "previous";

        if (needsResolution) {
          const recent = await deps.db.digest.findMany({
            take: 2,
            orderBy: { createdAt: "desc" },
            select: { id: true, createdAt: true },
          });

          const resolveId = (value: string): string | null => {
            if (value !== "latest" && value !== "previous") return value;
            if (value === "latest") {
              const first = recent[0];
              return first ? first.id : null;
            }
            const second = recent[1];
            return second ? second.id : null;
          };

          const resolvedA = resolveId(digestIdA);
          const resolvedB = resolveId(digestIdB);

          if (!resolvedA || !resolvedB) {
            const needed = recent.length < 2 ? "Need at least 2 digests to compare" : "No previous digest found";
            return envelopeError(ErrorCode.NOT_FOUND, needed);
          }

          digestIdA = resolvedA;
          digestIdB = resolvedB;
        }

        // Validate not comparing same digest
        if (digestIdA === digestIdB) {
          return envelopeError(ErrorCode.VALIDATION_ERROR, "Cannot compare a digest with itself");
        }

        const result = await deps.query("CompareDigests", { digestIdA, digestIdB, subreddit }, deps.ctx);
        return envelope(result);
      });
    },

    get_trending_topics: async (args) => {
      return safe(async () => {
        const limit = args.limit as number | undefined;
        const since = args.since as string | undefined;
        const subreddit = args.subreddit as string | undefined;
        const result = await deps.query(
          "GetTrendingTopics",
          { limit, since, subreddit },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    compare_periods: async (args) => {
      return safe(async () => {
        const periodA = args.periodA as string;
        const periodB = args.periodB as string;
        const subreddit = args.subreddit as string | undefined;
        const result = await deps.query(
          "ComparePeriods",
          { periodA, periodB, subreddit },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    preview_digest: async (args) => {
      return safe(async () => {
        const digestId = args.digestId as string;
        const channel = (args.channel as string | undefined) ?? "markdown";

        if (!["markdown", "email", "slack"].includes(channel)) {
          return envelopeError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid channel: ${channel}. Must be markdown, email, or slack`,
          );
        }

        // Check digest exists and job is in terminal state
        const digestView = await deps.db.digestView.findUnique({
          where: { digestId },
        });
        if (!digestView) {
          return envelopeError(ErrorCode.NOT_FOUND, `Digest ${digestId} not found`);
        }

        const terminalStatuses = ["COMPLETED", "PARTIAL", "FAILED", "CANCELED"];
        if (!terminalStatuses.includes(digestView.jobStatus)) {
          return envelopeError(
            ErrorCode.CONFLICT,
            `Digest ${digestId} is still being generated (status: ${digestView.jobStatus})`,
          );
        }

        // Markdown channel — return stored contentMarkdown
        if (channel === "markdown") {
          const content = digestView.contentMarkdown as string;
          return envelope({
            channel: "markdown",
            content,
            metadata: {
              sizeBytes: Buffer.byteLength(content, "utf-8"),
            },
          });
        }

        // Email/Slack channels — load full relations and render
        const digest = await deps.db.digest.findUnique({
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

        if (!digest) {
          return envelopeError(ErrorCode.NOT_FOUND, `Digest ${digestId} not found`);
        }

        const deliveryData = buildDeliveryData(digest);

        if (channel === "email") {
          const html = await renderDigestHtml(deliveryData);
          return envelope({
            channel: "email",
            content: html,
            metadata: {
              sizeBytes: Buffer.byteLength(html, "utf-8"),
            },
          });
        }

        // Slack channel
        const blocks: SlackBlock[] = formatDigestBlocks(deliveryData);
        const SLACK_BLOCK_LIMIT = 50;
        const SLACK_TEXT_LIMIT = 3000;
        const truncationWarnings: string[] = [];

        if (blocks.length > SLACK_BLOCK_LIMIT) {
          truncationWarnings.push(
            `Message has ${blocks.length} blocks (limit: ${SLACK_BLOCK_LIMIT})`,
          );
        }

        for (const [i, block] of blocks.entries()) {
          const textLen = block.text?.text?.length ?? 0;
          if (textLen > SLACK_TEXT_LIMIT) {
            truncationWarnings.push(
              `Block ${i + 1} text (${textLen} chars) exceeds Slack's ${SLACK_TEXT_LIMIT} char limit`,
            );
          }
        }

        const serialized = JSON.stringify(blocks);
        return envelope({
          channel: "slack",
          content: blocks,
          metadata: {
            sizeBytes: Buffer.byteLength(serialized, "utf-8"),
            blockCount: blocks.length,
            truncationWarnings,
          },
        });
      });
    },
  };

  return handlers;
}

// ── Server factory ────────────────────────────────────────────────────

export function createToolServer(deps: BootstrapResult): McpServer {
  const server = new McpServer({
    name: "redgest",
    version: "0.1.0",
  });

  const h = createToolHandlers(deps);

  function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const handler = h[name];
    if (!handler) throw new Error(`Missing handler: ${name}`);
    return handler(args);
  }

  server.tool(
    "use_redgest",
    "Show usage guide for Redgest MCP tools",
    async () => call("use_redgest", {}),
  );

  server.tool(
    "generate_digest",
    "Start a new digest run. Returns a jobId — poll with get_run_status until complete, then fetch with get_digest.",
    {
      subreddits: z.array(z.string()).optional().describe("Subreddit names or IDs to include (omit for all active)"),
      lookback: z.string().optional().describe('Lookback window: number + unit, e.g. "48h", "2d", "30m" (default: 24h)'),
      force_refresh: z.boolean().optional().describe("Bypass fetch cache and always hit Reddit API"),
    },
    async (args) => call("generate_digest", args),
  );

  server.tool(
    "get_run_status",
    "Check the status of a digest run by job ID. Returns per-step breakdown (fetch/triage/summarize/assemble) with per-subreddit counts and timing, plus structured error details.",
    { jobId: z.string().describe("The job ID returned by generate_digest") },
    async (args) => call("get_run_status", args),
  );

  server.tool(
    "list_runs",
    "List recent digest runs with status and timing. Supports cursor-based pagination.",
    {
      limit: z.number().optional().describe("Max number of runs to return (default: 10)"),
      cursor: z.string().optional().describe("Cursor from a previous response's nextCursor to fetch the next page"),
    },
    async (args) => call("list_runs", args),
  );

  server.tool(
    "get_digest",
    "Get a specific digest by ID, or the latest if no ID provided.",
    { digestId: z.string().optional().describe("Digest ID (omit for latest)") },
    async (args) => call("get_digest", args),
  );

  server.tool(
    "get_post",
    "Get a specific post summary by ID.",
    { postId: z.string().describe("Post ID") },
    async (args) => call("get_post", args),
  );

  server.tool(
    "list_digests",
    "List recent digests (metadata only — use get_digest for full content). Supports cursor-based pagination.",
    {
      limit: z.number().optional().describe("Max number of digests to return (default: 10)"),
      cursor: z.string().optional().describe("Cursor from a previous response's nextCursor to fetch the next page"),
    },
    async (args) => call("list_digests", args),
  );

  server.tool(
    "search_posts",
    "Full-text search across post summaries using tsvector search. Returns ranked results with match highlights.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default: 10)"),
      subreddit: z.string().optional().describe("Filter results to a specific subreddit"),
      since: z.string().optional().describe("Only return posts from the last duration, e.g. '7d', '48h', '30m'"),
      sentiment: z.string().optional().describe("Filter by sentiment (e.g. 'positive', 'negative', 'neutral')"),
      min_score: z.number().optional().describe("Minimum Reddit score filter"),
    },
    async (args) => call("search_posts", args),
  );

  server.tool(
    "search_digests",
    "Full-text search across digests using tsvector search. Returns ranked results with match highlights.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default: 10)"),
      subreddit: z.string().optional().describe("Filter results to a specific subreddit"),
      since: z.string().optional().describe("Only return posts from the last duration, e.g. '7d', '48h', '30m'"),
    },
    async (args) => call("search_digests", args),
  );

  server.tool(
    "find_similar",
    "Find posts similar to a given post based on semantic similarity. Requires embeddings to be populated.",
    {
      postId: z.string().describe("Post ID to find similar posts for"),
      limit: z.number().optional().describe("Max results (default: 5)"),
      subreddit: z.string().optional().describe("Filter results to a specific subreddit"),
    },
    async (args) => call("find_similar", args),
  );

  server.tool(
    "ask_history",
    "Search your digest history using natural language. Ask questions about topics, trends, or past discussions.",
    {
      question: z.string().describe("Natural language question or search query about your digest history"),
      limit: z.number().optional().describe("Max results (default: 10)"),
      subreddit: z.string().optional().describe("Filter results to a specific subreddit"),
      since: z.string().optional().describe("Duration filter e.g. '7d', '48h'"),
    },
    async (args) => call("ask_history", args),
  );

  server.tool(
    "cancel_run",
    "Cancel an in-progress or queued digest run. Stops the pipeline at the next step boundary and preserves any partial results.",
    { jobId: z.string().describe("The job ID to cancel") },
    async (args) => call("cancel_run", args),
  );

  server.tool(
    "list_subreddits",
    "List all monitored subreddits.",
    async () => call("list_subreddits", {}),
  );

  server.tool(
    "get_subreddit_stats",
    "View per-subreddit metrics: posts fetched, digest appearances, maxPosts utilization, last digest date. Useful for tuning subreddit configuration.",
    {
      name: z
        .string()
        .optional()
        .describe("Subreddit name to get stats for (omit for all)"),
    },
    async (args) => call("get_subreddit_stats", args),
  );

  server.tool(
    "add_subreddit",
    "Add a subreddit to monitor.",
    {
      name: z.string().describe("Subreddit name (without r/ prefix)"),
      insightPrompt: z.string().optional().describe("What to look for in this subreddit"),
      maxPosts: z.number().optional().describe("Max posts per digest run"),
      includeNsfw: z.boolean().optional().describe("Include NSFW content"),
    },
    async (args) => call("add_subreddit", args),
  );

  server.tool(
    "remove_subreddit",
    "Remove a monitored subreddit by name.",
    { name: z.string().describe("Subreddit name to remove") },
    async (args) => call("remove_subreddit", args),
  );

  server.tool(
    "update_subreddit",
    "Update subreddit settings (insight prompt, max posts, active status).",
    {
      name: z.string().describe("Subreddit name to update"),
      insightPrompt: z.string().optional().describe("New insight prompt"),
      maxPosts: z.number().optional().describe("New max posts per run"),
      active: z.boolean().optional().describe("Enable/disable monitoring"),
    },
    async (args) => call("update_subreddit", args),
  );

  server.tool(
    "get_config",
    "View current global Redgest configuration.",
    async () => call("get_config", {}),
  );

  server.tool(
    "get_llm_metrics",
    "Get aggregated LLM usage metrics: total tokens, latency, cache hit rate, broken down by task type. Scope to a specific run with jobId, or see recent aggregate.",
    {
      jobId: z.string().optional().describe("Scope metrics to a specific job/run ID"),
      limit: z.number().optional().describe("Number of recent jobs to aggregate over (default: 10, ignored when jobId set)"),
    },
    async (args) => call("get_llm_metrics", args),
  );

  server.tool(
    "check_reddit_connectivity",
    "Test Reddit API connectivity. Returns: API status, auth type (oauth/public), latency, and rate limiter state (tokens remaining, capacity, pending requests).",
    async () => call("check_reddit_connectivity", {}),
  );

  server.tool(
    "update_config",
    "Update global Redgest configuration.",
    {
      globalInsightPrompt: z.string().optional().describe("Global insight prompt"),
      defaultLookbackHours: z.number().optional().describe("Default lookback window in hours"),
      llmProvider: z.string().optional().describe("LLM provider (anthropic, openai)"),
      llmModel: z.string().optional().describe("LLM model name"),
      defaultDelivery: z.enum(["NONE", "EMAIL", "SLACK", "ALL"]).optional().describe("Default delivery channel for digests"),
      schedule: z.string().nullable().optional().describe("Cron expression for scheduled digests, or null to disable"),
    },
    async (args) => call("update_config", args),
  );

  server.tool(
    "get_delivery_status",
    "Check delivery status for digests across email and Slack channels",
    {
      digestId: z.string().optional().describe("Specific digest ID. If omitted, returns recent digests."),
      limit: z.number().optional().describe("Number of recent digests to check (default 5, max 20). Ignored when digestId is provided."),
    },
    async (args) => call("get_delivery_status", args),
  );

  server.tool(
    "compare_digests",
    "Compare two digests to see new/dropped posts, overlap percentage, and subreddit trends. Use for trend analysis across runs.",
    {
      digestIdA: z.string().describe("Digest UUID, 'latest', or 'previous'"),
      digestIdB: z.string().describe("Digest UUID, 'latest', or 'previous'"),
      subreddit: z.string().optional().describe("Filter comparison to a specific subreddit name"),
    },
    async (args) => call("compare_digests", args),
  );

  server.tool(
    "preview_digest",
    "Preview a digest rendered for a specific delivery channel without sending. Returns rendered content + metadata (size, Slack block count, truncation warnings).",
    {
      digestId: z.string().describe("Digest ID to preview"),
      channel: z
        .enum(["markdown", "email", "slack"])
        .optional()
        .describe('Delivery channel format to preview (default: "markdown")'),
    },
    async (args) => call("preview_digest", args),
  );

  server.tool(
    "get_trending_topics",
    "View trending topics extracted from digest history. Shows topic frequency and recency.",
    {
      limit: z.number().optional().describe("Max topics to return (default: 10)"),
      since: z.string().optional().describe("Duration filter e.g. '7d', '30d'"),
      subreddit: z.string().optional().describe("Filter to a specific subreddit"),
    },
    async (args) => call("get_trending_topics", args),
  );

  server.tool(
    "compare_periods",
    "Compare two time periods to see volume changes, new/dropped topics, and subreddit activity shifts. periodA is the recent window, periodB is the comparison window.",
    {
      periodA: z.string().describe("Recent period duration, e.g. '7d' for last 7 days"),
      periodB: z.string().describe("Comparison period duration, e.g. '7d' for the 7 days before periodA"),
      subreddit: z.string().optional().describe("Filter to a specific subreddit"),
    },
    async (args) => call("compare_periods", args),
  );

  return server;
}
