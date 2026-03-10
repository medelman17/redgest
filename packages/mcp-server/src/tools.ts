import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RedgestError, type ExecuteContext } from "@redgest/core";
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
    return envelopeError("INTERNAL_ERROR", "An unexpected error occurred");
  }
}

function parseLookback(lookback?: string): number | undefined {
  if (!lookback) return undefined;
  const match = lookback.match(/^(\d+)h$/);
  return match ? Number(match[1]) : undefined;
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

### Digest Retrieval
- **get_digest** — Get a specific digest by ID, or the latest
- **list_digests** — List recent digests
- **search_digests** — Full-text search across digests

### Post Access
- **get_post** — Get a specific post summary by ID
- **search_posts** — Full-text search across post summaries

### Subreddit Management
- **add_subreddit** — Add a subreddit to monitor
- **remove_subreddit** — Remove a monitored subreddit by name
- **update_subreddit** — Update subreddit settings (insight prompt, max posts, active)
- **list_subreddits** — List all monitored subreddits

### Configuration
- **get_config** — View current global configuration
- **update_config** — Update global settings (insight prompt, lookback, LLM provider/model)

### Help
- **use_redgest** — Show this usage guide`;

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
        const result = await deps.execute(
          "GenerateDigest",
          {
            subredditIds: subreddits,
            lookbackHours: parseLookback(lookback),
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
        if (!result) return envelopeError("NOT_FOUND", `Run ${jobId} not found`);
        return envelope(result);
      });
    },

    list_runs: async (args) => {
      return safe(async () => {
        const limit = args.limit as number | undefined;
        const result = await deps.query(
          "ListRuns",
          { limit },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    get_digest: async (args) => {
      return safe(async () => {
        let digestId = args.digestId as string | undefined;

        if (!digestId) {
          const digests = await deps.query(
            "ListDigests",
            { limit: 1 },
            deps.ctx,
          );
          const first = digests[0];
          if (!first) {
            return envelopeError("NOT_FOUND", "No digests found");
          }
          digestId = first.digestId;
        }

        const result = await deps.query(
          "GetDigest",
          { digestId },
          deps.ctx,
        );
        if (!result) return envelopeError("NOT_FOUND", `Digest ${digestId} not found`);
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
        if (!result) return envelopeError("NOT_FOUND", `Post ${postId} not found`);
        return envelope(result);
      });
    },

    list_digests: async (args) => {
      return safe(async () => {
        const limit = args.limit as number | undefined;
        const result = await deps.query(
          "ListDigests",
          { limit },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    search_posts: async (args) => {
      return safe(async () => {
        const query = args.query as string;
        const limit = args.limit as number | undefined;
        const result = await deps.query(
          "SearchPosts",
          { query, limit },
          deps.ctx,
        );
        return envelope(result);
      });
    },

    search_digests: async (args) => {
      return safe(async () => {
        const query = args.query as string;
        const limit = args.limit as number | undefined;
        const result = await deps.query(
          "SearchDigests",
          { query, limit },
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
          return envelopeError("NOT_FOUND", `Subreddit "${name}" not found`);
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
          return envelopeError("NOT_FOUND", `Subreddit "${name}" not found`);
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
        if (!result) return envelopeError("NOT_FOUND", "Config not found");
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
          },
          eCtx,
        );
        return envelope(result);
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
    "Start a new digest run. Fetches posts, triages, summarizes, and assembles a digest.",
    {
      subreddits: z.array(z.string()).optional().describe("Subreddit IDs to include (omit for all active)"),
      lookback: z.string().optional().describe('Lookback window, e.g. "48h"'),
    },
    async (args) => call("generate_digest", args),
  );

  server.tool(
    "get_run_status",
    "Check the status of a digest run by job ID.",
    { jobId: z.string().describe("The job ID returned by generate_digest") },
    async (args) => call("get_run_status", args),
  );

  server.tool(
    "list_runs",
    "List recent digest runs.",
    { limit: z.number().optional().describe("Max number of runs to return") },
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
    "List recent digests.",
    { limit: z.number().optional().describe("Max number of digests to return") },
    async (args) => call("list_digests", args),
  );

  server.tool(
    "search_posts",
    "Full-text search across post summaries.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results"),
    },
    async (args) => call("search_posts", args),
  );

  server.tool(
    "search_digests",
    "Full-text search across digests.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results"),
    },
    async (args) => call("search_digests", args),
  );

  server.tool(
    "list_subreddits",
    "List all monitored subreddits.",
    async () => call("list_subreddits", {}),
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
    "update_config",
    "Update global Redgest configuration.",
    {
      globalInsightPrompt: z.string().optional().describe("Global insight prompt"),
      defaultLookbackHours: z.number().optional().describe("Default lookback window in hours"),
      llmProvider: z.string().optional().describe("LLM provider (anthropic, openai)"),
      llmModel: z.string().optional().describe("LLM model name"),
    },
    async (args) => call("update_config", args),
  );

  return server;
}
