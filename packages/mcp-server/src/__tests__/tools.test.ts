import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RedgestError } from "@redgest/core";
import type { BootstrapResult } from "../bootstrap.js";
import type { ToolResult } from "../envelope.js";
import { createToolHandlers, createToolServer, type ToolHandler } from "../tools.js";

// ── Test helpers ──────────────────────────────────────────────────────

function parseEnvelope(result: ToolResult): {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
} {
  return JSON.parse(result.content[0].text) as {
    ok: boolean;
    data?: unknown;
    error?: { code: string; message: string };
  };
}

type MockFn = ReturnType<typeof vi.fn>;

interface MockDeps {
  result: BootstrapResult;
  execute: MockFn;
  query: MockFn;
}

function invoke(
  handlers: Record<string, ToolHandler>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args);
}

function createMockDeps(): MockDeps {
  const execute = vi.fn();
  const query = vi.fn();

  const db = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(),
  } as unknown as BootstrapResult["db"];

  const eventBus = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    emitEvent: vi.fn(),
  } as unknown as BootstrapResult["ctx"]["eventBus"];

  const config = {
    DATABASE_URL: "test",
  } as unknown as BootstrapResult["config"];

  const ctx: BootstrapResult["ctx"] = { db, eventBus, config };

  const checkConnectivity = vi.fn();

  const result: BootstrapResult = {
    execute: execute as unknown as BootstrapResult["execute"],
    query: query as unknown as BootstrapResult["query"],
    ctx,
    config,
    db,
    checkConnectivity: checkConnectivity as unknown as BootstrapResult["checkConnectivity"],
  };

  return { result, execute, query };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("createToolServer", () => {
  it("returns an McpServer instance", () => {
    const { result: deps } = createMockDeps();
    const server = createToolServer(deps);
    expect(server).toBeInstanceOf(McpServer);
  });
});

describe("use_redgest", () => {
  it("returns a usage guide containing key tool names", async () => {
    const { result: deps } = createMockDeps();
    const handlers = createToolHandlers(deps);
    const result = await invoke(handlers, "use_redgest");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(typeof env.data).toBe("string");
    const guide = String(env.data);
    expect(guide).toContain("generate_digest");
    expect(guide).toContain("get_digest");
    expect(guide).toContain("add_subreddit");
    expect(guide).toContain("list_subreddits");
  });
});

describe("generate_digest", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("resolves subreddit names to IDs", async () => {
    deps.query.mockResolvedValue([
      { id: "s1", name: "typescript" },
      { id: "s2", name: "rust" },
    ]);
    deps.execute.mockResolvedValue({ jobId: "j1", status: "pending" });

    await invoke(handlers, "generate_digest", {
      subreddits: ["typescript", "rust"],
      lookback: "48h",
    });

    expect(deps.execute).toHaveBeenCalledWith(
      "GenerateDigest",
      { subredditIds: ["s1", "s2"], lookbackHours: 48 },
      deps.result.ctx,
    );
  });

  it("passes UUIDs through without resolution", async () => {
    deps.execute.mockResolvedValue({ jobId: "j1", status: "pending" });
    const uuid = "01234567-89ab-cdef-0123-456789abcdef";

    await invoke(handlers, "generate_digest", {
      subreddits: [uuid],
      lookback: "48h",
    });

    expect(deps.execute).toHaveBeenCalledWith(
      "GenerateDigest",
      { subredditIds: [uuid], lookbackHours: 48 },
      deps.result.ctx,
    );
    // Should not call ListSubreddits when all inputs are UUIDs
    expect(deps.query).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when subreddit name cannot be resolved", async () => {
    deps.query.mockResolvedValue([{ id: "s1", name: "typescript" }]);

    const result = await invoke(handlers, "generate_digest", {
      subreddits: ["nonexistent"],
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
    expect(env.error?.message).toContain("nonexistent");
  });

  it("passes defaults when no params provided", async () => {
    deps.execute.mockResolvedValue({ jobId: "j2", status: "pending" });

    await invoke(handlers, "generate_digest");

    expect(deps.execute).toHaveBeenCalledWith(
      "GenerateDigest",
      { subredditIds: undefined, lookbackHours: undefined },
      deps.result.ctx,
    );
  });

  it("returns a success envelope on success", async () => {
    deps.execute.mockResolvedValue({ jobId: "j3", status: "pending" });

    const result = await invoke(handlers, "generate_digest");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ jobId: "j3", status: "pending" });
  });

  it("returns envelopeError for RedgestError", async () => {
    deps.execute.mockRejectedValue(new RedgestError("VALIDATION_ERROR", "bad input"));

    const result = await invoke(handlers, "generate_digest");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error).toEqual({ code: "VALIDATION_ERROR", message: "bad input" });
    expect(result.isError).toBe(true);
  });

  it("returns envelopeError with INTERNAL_ERROR for unknown errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.execute.mockRejectedValue(new Error("unexpected"));

    const result = await invoke(handlers, "generate_digest");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error).toEqual({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" });
    expect(result.isError).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Unexpected error"), "unexpected");
    consoleSpy.mockRestore();
  });
});

describe("get_run_status", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("queries GetRunStatus and returns envelope", async () => {
    deps.query.mockResolvedValue({ jobId: "j1", status: "completed" });

    const result = await invoke(handlers, "get_run_status", { jobId: "j1" });

    expect(deps.query).toHaveBeenCalledWith("GetRunStatus", { jobId: "j1" }, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ jobId: "j1", status: "completed" });
  });

  it("returns NOT_FOUND when null", async () => {
    deps.query.mockResolvedValue(null);

    const result = await invoke(handlers, "get_run_status", { jobId: "j-missing" });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
    expect(result.isError).toBe(true);
  });
});

describe("get_digest", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("queries GetDigest by ID when digestId provided", async () => {
    deps.query.mockResolvedValue({ id: "d1", content: "digest" });

    const result = await invoke(handlers, "get_digest", { digestId: "d1" });

    expect(deps.query).toHaveBeenCalledWith("GetDigest", { digestId: "d1" }, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ id: "d1", content: "digest" });
  });

  it("falls back to latest when no digestId", async () => {
    deps.query.mockResolvedValueOnce({ items: [{ digestId: "d-latest" }], nextCursor: null, hasMore: false });
    deps.query.mockResolvedValueOnce({ digestId: "d-latest", content: "latest digest" });

    const result = await invoke(handlers, "get_digest");

    expect(deps.query).toHaveBeenCalledWith("ListDigests", { limit: 1 }, deps.result.ctx);
    expect(deps.query).toHaveBeenCalledWith("GetDigest", { digestId: "d-latest" }, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ digestId: "d-latest", content: "latest digest" });
  });

  it("returns NOT_FOUND when no digests exist and no digestId", async () => {
    deps.query.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

    const result = await invoke(handlers, "get_digest");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
    expect(result.isError).toBe(true);
  });

  it("returns NOT_FOUND when digest by ID is null", async () => {
    deps.query.mockResolvedValue(null);

    const result = await invoke(handlers, "get_digest", { digestId: "d-missing" });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
  });
});

describe("remove_subreddit", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("looks up subreddit ID by name, then removes", async () => {
    deps.query.mockResolvedValue([
      { id: "s1", name: "typescript" },
      { id: "s2", name: "rust" },
    ]);
    deps.execute.mockResolvedValue({ subredditId: "s1" });

    const result = await invoke(handlers, "remove_subreddit", { name: "typescript" });

    expect(deps.query).toHaveBeenCalledWith("ListSubreddits", {}, deps.result.ctx);
    expect(deps.execute).toHaveBeenCalledWith(
      "RemoveSubreddit",
      { subredditId: "s1" },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
  });

  it("returns NOT_FOUND when subreddit name not found", async () => {
    deps.query.mockResolvedValue([{ id: "s1", name: "typescript" }]);

    const result = await invoke(handlers, "remove_subreddit", { name: "nonexistent" });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
    expect(result.isError).toBe(true);
  });
});

describe("add_subreddit", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("translates name → displayName and includeNsfw → nsfw", async () => {
    deps.execute.mockResolvedValue({ subredditId: "s-new" });

    await invoke(handlers, "add_subreddit", {
      name: "MachineLearning",
      insightPrompt: "AI news",
      maxPosts: 10,
      includeNsfw: true,
    });

    expect(deps.execute).toHaveBeenCalledWith(
      "AddSubreddit",
      {
        name: "MachineLearning",
        displayName: "MachineLearning",
        insightPrompt: "AI news",
        maxPosts: 10,
        nsfw: true,
      },
      deps.result.ctx,
    );
  });

  it("returns success envelope", async () => {
    deps.execute.mockResolvedValue({ subredditId: "s-new" });

    const result = await invoke(handlers, "add_subreddit", { name: "test" });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ subredditId: "s-new" });
  });
});

describe("update_subreddit", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("looks up subreddit ID by name, then updates", async () => {
    deps.query.mockResolvedValue([{ id: "s1", name: "typescript" }]);
    deps.execute.mockResolvedValue({ subredditId: "s1" });

    const result = await invoke(handlers, "update_subreddit", {
      name: "typescript",
      insightPrompt: "new prompt",
      maxPosts: 20,
      active: false,
    });

    expect(deps.query).toHaveBeenCalledWith("ListSubreddits", {}, deps.result.ctx);
    expect(deps.execute).toHaveBeenCalledWith(
      "UpdateSubreddit",
      { subredditId: "s1", insightPrompt: "new prompt", maxPosts: 20, active: false },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
  });

  it("returns NOT_FOUND when subreddit name not found", async () => {
    deps.query.mockResolvedValue([]);

    const result = await invoke(handlers, "update_subreddit", { name: "missing" });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
  });
});

describe("edge cases", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("lookupSubredditId is case-insensitive", async () => {
    deps.query.mockResolvedValue([{ id: "s1", name: "typescript" }]);
    deps.execute.mockResolvedValue({ subredditId: "s1" });

    const result = await invoke(handlers, "remove_subreddit", { name: "TypeScript" });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(deps.execute).toHaveBeenCalledWith(
      "RemoveSubreddit",
      { subredditId: "s1" },
      expect.anything(),
    );
  });

  it("parseLookback supports minutes", async () => {
    deps.execute.mockResolvedValue({ jobId: "j1", status: "pending" });

    await invoke(handlers, "generate_digest", { lookback: "30m" });

    expect(deps.execute).toHaveBeenCalledWith(
      "GenerateDigest",
      { subredditIds: undefined, lookbackHours: 0.5 },
      expect.anything(),
    );
  });

  it("parseLookback supports days", async () => {
    deps.execute.mockResolvedValue({ jobId: "j1", status: "pending" });

    await invoke(handlers, "generate_digest", { lookback: "2d" });

    expect(deps.execute).toHaveBeenCalledWith(
      "GenerateDigest",
      { subredditIds: undefined, lookbackHours: 48 },
      expect.anything(),
    );
  });

  it("parseLookback returns VALIDATION_ERROR for invalid formats", async () => {
    const result = await invoke(handlers, "generate_digest", { lookback: "bad" });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("VALIDATION_ERROR");
    expect(env.error?.message).toContain("Invalid lookback format");
    expect(result.isError).toBe(true);
  });

  it("get_config returns NOT_FOUND when config is null", async () => {
    deps.query.mockResolvedValue(null);

    const result = await invoke(handlers, "get_config");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
  });
});

describe("pass-through tools", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("list_runs queries ListRuns with cursor", async () => {
    deps.query.mockResolvedValue({ items: [{ id: "r1" }], nextCursor: null, hasMore: false });

    const result = await invoke(handlers, "list_runs", { limit: 5, cursor: "r-prev" });

    expect(deps.query).toHaveBeenCalledWith("ListRuns", { limit: 5, cursor: "r-prev" }, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ items: [{ id: "r1" }], nextCursor: null, hasMore: false });
  });

  it("list_digests returns paginated metadata without content fields", async () => {
    deps.query.mockResolvedValue({
      items: [
        {
          digestId: "d1",
          jobId: "j1",
          jobStatus: "COMPLETED",
          startedAt: "2026-03-10T00:00:00Z",
          completedAt: "2026-03-10T00:01:00Z",
          subredditList: ["typescript"],
          postCount: 5,
          contentMarkdown: "# Long markdown content...",
          contentHtml: "<h1>Long HTML content...</h1>",
          createdAt: "2026-03-10T00:01:00Z",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    const result = await invoke(handlers, "list_digests", { limit: 10 });

    expect(deps.query).toHaveBeenCalledWith("ListDigests", { limit: 10, cursor: undefined }, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    const data = env.data as { items: Record<string, unknown>[]; nextCursor: string | null; hasMore: boolean };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toHaveProperty("digestId", "d1");
    expect(data.items[0]).toHaveProperty("postCount", 5);
    expect(data.items[0]).not.toHaveProperty("contentMarkdown");
    expect(data.items[0]).not.toHaveProperty("contentHtml");
    expect(data.hasMore).toBe(false);
    expect(data.nextCursor).toBeNull();
  });

  it("get_post queries GetPost and handles NOT_FOUND", async () => {
    deps.query.mockResolvedValue(null);

    const result = await invoke(handlers, "get_post", { postId: "p-missing" });

    expect(deps.query).toHaveBeenCalledWith("GetPost", { postId: "p-missing" }, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
  });

  it("get_post returns data when found", async () => {
    deps.query.mockResolvedValue({ id: "p1", title: "Test" });

    const result = await invoke(handlers, "get_post", { postId: "p1" });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ id: "p1", title: "Test" });
  });

  it("search_posts queries SearchPosts with cursor", async () => {
    deps.query.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

    const result = await invoke(handlers, "search_posts", { query: "rust", limit: 5, cursor: "p-1" });

    expect(deps.query).toHaveBeenCalledWith(
      "SearchPosts",
      { query: "rust", limit: 5, cursor: "p-1" },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it("search_digests queries SearchDigests with cursor", async () => {
    deps.query.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

    const result = await invoke(handlers, "search_digests", { query: "AI", limit: 3, cursor: "d-1" });

    expect(deps.query).toHaveBeenCalledWith(
      "SearchDigests",
      { query: "AI", limit: 3, cursor: "d-1" },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it("list_subreddits queries ListSubreddits", async () => {
    deps.query.mockResolvedValue([{ id: "s1", name: "test" }]);

    const result = await invoke(handlers, "list_subreddits");

    expect(deps.query).toHaveBeenCalledWith("ListSubreddits", {}, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
  });

  it("get_config queries GetConfig", async () => {
    deps.query.mockResolvedValue({ globalInsightPrompt: "test" });

    const result = await invoke(handlers, "get_config");

    expect(deps.query).toHaveBeenCalledWith("GetConfig", {}, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ globalInsightPrompt: "test" });
  });

  it("update_config executes UpdateConfig", async () => {
    deps.execute.mockResolvedValue({ success: true });

    const result = await invoke(handlers, "update_config", {
      globalInsightPrompt: "new prompt",
      llmProvider: "openai",
    });

    expect(deps.execute).toHaveBeenCalledWith(
      "UpdateConfig",
      {
        globalInsightPrompt: "new prompt",
        defaultLookbackHours: undefined,
        llmProvider: "openai",
        llmModel: undefined,
        defaultDelivery: undefined,
        schedule: undefined,
      },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual({ success: true });
  });

  it("update_config passes defaultDelivery and schedule", async () => {
    deps.execute.mockResolvedValue({ success: true });

    const result = await invoke(handlers, "update_config", {
      defaultDelivery: "EMAIL",
      schedule: "0 7 * * *",
    });

    expect(deps.execute).toHaveBeenCalledWith(
      "UpdateConfig",
      {
        globalInsightPrompt: undefined,
        defaultLookbackHours: undefined,
        llmProvider: undefined,
        llmModel: undefined,
        defaultDelivery: "EMAIL",
        schedule: "0 7 * * *",
      },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
  });
});

describe("check_reddit_connectivity", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("returns connectivity status with rate limiter state", async () => {
    const checkConnectivity = deps.result.checkConnectivity as MockFn;
    checkConnectivity.mockResolvedValue({
      ok: true,
      authType: "oauth",
      latencyMs: 42,
      rateLimiter: {
        availableTokens: 55,
        capacity: 60,
        refillRate: 1,
        pendingRequests: 0,
      },
    });

    const result = await invoke(handlers, "check_reddit_connectivity");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    const data = env.data as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.authType).toBe("oauth");
    expect(data.latencyMs).toBe(42);
    expect(data.rateLimiter).toEqual({
      availableTokens: 55,
      capacity: 60,
      refillRate: 1,
      pendingRequests: 0,
    });
  });

  it("returns error details when connectivity fails", async () => {
    const checkConnectivity = deps.result.checkConnectivity as MockFn;
    checkConnectivity.mockResolvedValue({
      ok: false,
      authType: "public",
      latencyMs: 100,
      error: "Reddit API rate limit exceeded",
      rateLimiter: {
        availableTokens: 0,
        capacity: 10,
        refillRate: 0.167,
        pendingRequests: 3,
      },
    });

    const result = await invoke(handlers, "check_reddit_connectivity");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true); // MCP envelope is ok, the data reports the failure
    const data = env.data as Record<string, unknown>;
    expect(data.ok).toBe(false);
    expect(data.error).toBe("Reddit API rate limit exceeded");
  });

  it("returns INTERNAL_ERROR when checkConnectivity is not configured", async () => {
    deps.result.checkConnectivity = undefined;
    handlers = createToolHandlers(deps.result);

    const result = await invoke(handlers, "check_reddit_connectivity");

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("INTERNAL_ERROR");
  });
});
