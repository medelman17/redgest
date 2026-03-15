import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RedgestError } from "@redgest/core";
import type { BootstrapResult } from "../bootstrap.js";
import type { ToolResult } from "../envelope.js";
import { createToolHandlers, createToolServer, type ToolHandler } from "../tools.js";

// Mock email rendering (preview_digest uses renderDigestHtml + buildFormattedDigest)
vi.mock("@redgest/email", () => ({
  buildDeliveryData: vi.fn().mockReturnValue({
    digestId: "d1",
    createdAt: new Date("2026-03-10"),
    subreddits: [{ name: "test", posts: [{ title: "Post", permalink: "/r/test/1", score: 10, summary: "Sum", keyTakeaways: [], insightNotes: "", commentHighlights: [] }] }],
  }),
  buildFormattedDigest: vi.fn().mockReturnValue({
    createdAt: new Date("2026-03-10"),
    headline: "Test headline.",
    sections: [{ subreddit: "test", body: "Test body.", posts: [{ title: "Post", permalink: "/r/test/1", score: 10 }] }],
  }),
  renderDigestHtml: vi.fn().mockResolvedValue("<html>preview</html>"),
}));

// Mock LLM (preview_digest uses generateDeliveryProse)
vi.mock("@redgest/llm", () => ({
  generateDeliveryProse: vi.fn().mockResolvedValue({
    data: { headline: "Test headline.", sections: [{ subreddit: "test", body: "Test body." }] },
    log: null,
  }),
}));

// Mock slack formatting (preview_digest uses formatDigestBlocks)
vi.mock("@redgest/slack", () => ({
  formatDigestBlocks: vi.fn().mockReturnValue([
    { type: "header", text: { type: "plain_text", text: "Digest", emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: "Post content" } },
  ]),
}));

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
    expect(guide).toContain("preview_digest");
    expect(guide).toContain("compare_digests");
    expect(guide).toContain("get_delivery_status");
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
    expect(env.error?.message).toContain("Invalid duration");
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

  it("search_posts queries SearchPosts with filter params", async () => {
    const mockResults = [{ postId: "p-1", title: "Rust Systems" }];
    deps.query.mockResolvedValue(mockResults);

    const result = await invoke(handlers, "search_posts", { query: "rust", limit: 5, subreddit: "rust", since: "7d" });

    expect(deps.query).toHaveBeenCalledWith(
      "SearchPosts",
      { query: "rust", limit: 5, subreddit: "rust", since: "7d", sentiment: undefined, minScore: undefined },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(mockResults);
  });

  it("search_digests queries SearchDigests with filter params", async () => {
    const mockResults = [{ postId: "p-1", title: "AI News" }];
    deps.query.mockResolvedValue(mockResults);

    const result = await invoke(handlers, "search_digests", { query: "AI", limit: 3, subreddit: "MachineLearning" });

    expect(deps.query).toHaveBeenCalledWith(
      "SearchDigests",
      { query: "AI", limit: 3, subreddit: "MachineLearning", since: undefined },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(mockResults);
  });

  it("find_similar queries FindSimilar with postId and options", async () => {
    const mockResults = [{ postId: "p-2", title: "Related Post" }];
    deps.query.mockResolvedValue(mockResults);

    const result = await invoke(handlers, "find_similar", { postId: "p-1", limit: 5, subreddit: "typescript" });

    expect(deps.query).toHaveBeenCalledWith(
      "FindSimilar",
      { postId: "p-1", limit: 5, subreddit: "typescript" },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(mockResults);
  });

  it("ask_history queries AskHistory with question and options", async () => {
    const mockResults = [{ postId: "p-3", title: "Rust Systems Post" }];
    deps.query.mockResolvedValue(mockResults);

    const result = await invoke(handlers, "ask_history", {
      question: "what happened in rust this week",
      limit: 10,
      subreddit: "rust",
      since: "7d",
    });

    expect(deps.query).toHaveBeenCalledWith(
      "AskHistory",
      { question: "what happened in rust this week", limit: 10, subreddit: "rust", since: "7d" },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(mockResults);
  });

  it("list_subreddits queries ListSubreddits", async () => {
    deps.query.mockResolvedValue([{ id: "s1", name: "test" }]);

    const result = await invoke(handlers, "list_subreddits");

    expect(deps.query).toHaveBeenCalledWith("ListSubreddits", {}, deps.result.ctx);
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
  });

  it("get_subreddit_stats queries GetSubredditStats with no name", async () => {
    deps.query.mockResolvedValue([
      { id: "s1", name: "typescript", totalPostsFetched: 50 },
    ]);

    const result = await invoke(handlers, "get_subreddit_stats", {});

    expect(deps.query).toHaveBeenCalledWith(
      "GetSubredditStats",
      { name: undefined },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual([
      { id: "s1", name: "typescript", totalPostsFetched: 50 },
    ]);
  });

  it("get_subreddit_stats filters by name when provided", async () => {
    deps.query.mockResolvedValue([
      { id: "s1", name: "typescript", totalPostsFetched: 50 },
    ]);

    const result = await invoke(handlers, "get_subreddit_stats", {
      name: "typescript",
    });

    expect(deps.query).toHaveBeenCalledWith(
      "GetSubredditStats",
      { name: "typescript" },
      deps.result.ctx,
    );
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

describe("cancel_run", () => {
  it("calls CancelRun command and returns envelope", async () => {
    const { result, execute } = createMockDeps();
    execute.mockResolvedValue({ jobId: "job-1", status: "CANCELED" });
    const handlers = createToolHandlers(result);

    const response = await invoke(handlers, "cancel_run", { jobId: "job-1" });
    const parsed = parseEnvelope(response);

    expect(parsed.ok).toBe(true);
    expect(parsed.data).toEqual({ jobId: "job-1", status: "CANCELED" });
    expect(execute).toHaveBeenCalledWith(
      "CancelRun",
      { jobId: "job-1" },
      expect.any(Object),
    );
  });

  it("returns NOT_FOUND error for unknown job", async () => {
    const { result, execute } = createMockDeps();
    execute.mockRejectedValue(
      new RedgestError("NOT_FOUND", "Job not found"),
    );
    const handlers = createToolHandlers(result);

    const response = await invoke(handlers, "cancel_run", { jobId: "bad-id" });
    const parsed = parseEnvelope(response);

    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("NOT_FOUND");
  });

  it("returns CONFLICT error for terminal job", async () => {
    const { result, execute } = createMockDeps();
    execute.mockRejectedValue(
      new RedgestError("CONFLICT", "Cannot cancel a job with status COMPLETED"),
    );
    const handlers = createToolHandlers(result);

    const response = await invoke(handlers, "cancel_run", { jobId: "done-job" });
    const parsed = parseEnvelope(response);

    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe("CONFLICT");
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

describe("preview_digest", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("returns NOT_FOUND when digest does not exist", async () => {
    Object.assign(deps.result.db, { digestView: { findUnique: vi.fn().mockResolvedValue(null) } });

    const result = await invoke(handlers, "preview_digest", {
      digestId: "nonexistent",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
  });

  it("returns CONFLICT when digest job is still running", async () => {
    Object.assign(deps.result.db, {
      digestView: {
        findUnique: vi.fn().mockResolvedValue({
          digestId: "d1",
          jobStatus: "RUNNING",
          contentMarkdown: "",
        }),
      },
    });

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("CONFLICT");
  });

  it("returns markdown content by default", async () => {
    Object.assign(deps.result.db, {
      digestView: {
        findUnique: vi.fn().mockResolvedValue({
          digestId: "d1",
          jobStatus: "COMPLETED",
          contentMarkdown: "# Digest\n\nSome content",
        }),
      },
    });

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    const data = env.data as {
      channel: string;
      content: string;
      metadata: { sizeBytes: number };
    };
    expect(data.channel).toBe("markdown");
    expect(data.content).toBe("# Digest\n\nSome content");
    expect(data.metadata.sizeBytes).toBeGreaterThan(0);
  });

  it("returns email HTML when channel is email", async () => {
    Object.assign(deps.result.db, {
      digestView: {
        findUnique: vi.fn().mockResolvedValue({
          digestId: "d1",
          jobStatus: "COMPLETED",
        }),
      },
      digest: {
        findUnique: vi.fn().mockResolvedValue({
          id: "d1",
          createdAt: new Date("2026-03-10"),
          digestPosts: [
            {
              rank: 1,
              subreddit: "test",
              post: {
                title: "Post",
                permalink: "/r/test/1",
                score: 10,
                summaries: [
                  {
                    summary: "Sum",
                    keyTakeaways: JSON.stringify([]),
                    insightNotes: "",
                    commentHighlights: JSON.stringify([]),
                  },
                ],
              },
            },
          ],
        }),
      },
    });

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
      channel: "email",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    const data = env.data as { channel: string; content: string };
    expect(data.channel).toBe("email");
    expect(typeof data.content).toBe("string");
  });

  it("returns VALIDATION_ERROR for invalid channel", async () => {
    Object.assign(deps.result.db, {
      digestView: {
        findUnique: vi.fn().mockResolvedValue({
          digestId: "d1",
          jobStatus: "COMPLETED",
          contentMarkdown: "content",
        }),
      },
    });

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
      channel: "sms",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("VALIDATION_ERROR");
  });

  it("returns slack blocks when channel is slack", async () => {
    Object.assign(deps.result.db, {
      digestView: {
        findUnique: vi.fn().mockResolvedValue({
          digestId: "d1",
          jobStatus: "COMPLETED",
        }),
      },
      digest: {
        findUnique: vi.fn().mockResolvedValue({
          id: "d1",
          createdAt: new Date("2026-03-10"),
          digestPosts: [
            {
              rank: 1,
              subreddit: "test",
              post: {
                title: "Post",
                permalink: "/r/test/1",
                score: 10,
                summaries: [
                  {
                    summary: "Sum",
                    keyTakeaways: JSON.stringify([]),
                    insightNotes: "",
                    commentHighlights: JSON.stringify([]),
                  },
                ],
              },
            },
          ],
        }),
      },
    });

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
      channel: "slack",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    const data = env.data as {
      channel: string;
      content: unknown[];
      metadata: { blockCount: number; truncationWarnings: string[] };
    };
    expect(data.channel).toBe("slack");
    expect(Array.isArray(data.content)).toBe(true);
    expect(data.metadata.blockCount).toBeGreaterThan(0);
    expect(Array.isArray(data.metadata.truncationWarnings)).toBe(true);
  });
});

describe("get_delivery_status", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("queries GetDeliveryStatus with specific digestId", async () => {
    const statusResult = {
      digests: [
        {
          digestId: "d-1",
          digestCreatedAt: "2026-03-10T00:00:00.000Z",
          jobId: "j-1",
          channels: [
            { channel: "EMAIL", status: "SENT", error: null, externalId: "ext-1", sentAt: "2026-03-10T00:05:00.000Z" },
          ],
        },
      ],
    };
    deps.query.mockResolvedValue(statusResult);

    const result = await invoke(handlers, "get_delivery_status", { digestId: "d-1" });

    expect(deps.query).toHaveBeenCalledWith(
      "GetDeliveryStatus",
      { digestId: "d-1" },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(statusResult);
  });

  it("queries GetDeliveryStatus without digestId for recent digests", async () => {
    const statusResult = {
      digests: [
        { digestId: "d-2", digestCreatedAt: "2026-03-11T00:00:00.000Z", jobId: "j-2", channels: [] },
        { digestId: "d-1", digestCreatedAt: "2026-03-10T00:00:00.000Z", jobId: "j-1", channels: [] },
      ],
    };
    deps.query.mockResolvedValue(statusResult);

    const result = await invoke(handlers, "get_delivery_status", { limit: 2 });

    expect(deps.query).toHaveBeenCalledWith(
      "GetDeliveryStatus",
      { limit: 2 },
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(statusResult);
  });

  it("passes default params when none provided", async () => {
    deps.query.mockResolvedValue({ digests: [] });

    const result = await invoke(handlers, "get_delivery_status");

    expect(deps.query).toHaveBeenCalledWith(
      "GetDeliveryStatus",
      {},
      deps.result.ctx,
    );
    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
  });
});

describe("compare_digests", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("delegates to CompareDigests query with resolved UUIDs", async () => {
    const comparisonResult = {
      digestA: { id: "d-a", createdAt: "2026-03-10T00:00:00.000Z", postCount: 3, subreddits: ["typescript"] },
      digestB: { id: "d-b", createdAt: "2026-03-11T00:00:00.000Z", postCount: 2, subreddits: ["rust"] },
      overlap: { count: 1, percentage: 33.33, posts: [] },
      added: { count: 1, posts: [] },
      removed: { count: 2, posts: [] },
      subredditDeltas: [],
    };
    deps.query.mockResolvedValue(comparisonResult);

    const result = await invoke(handlers, "compare_digests", {
      digestIdA: "d-a",
      digestIdB: "d-b",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    expect(env.data).toEqual(comparisonResult);
    expect(deps.query).toHaveBeenCalledWith(
      "CompareDigests",
      { digestIdA: "d-a", digestIdB: "d-b", subreddit: undefined },
      deps.result.ctx,
    );
  });

  it("resolves 'latest' and 'previous' shorthand", async () => {
    Object.assign(deps.result.db, {
      digest: {
        findMany: vi.fn().mockResolvedValue([
          { id: "d-latest", createdAt: new Date("2026-03-11") },
          { id: "d-previous", createdAt: new Date("2026-03-10") },
        ]),
      },
    });
    deps.query.mockResolvedValue({
      digestA: { id: "d-previous" },
      digestB: { id: "d-latest" },
      overlap: { count: 0, percentage: 0, posts: [] },
      added: { count: 0, posts: [] },
      removed: { count: 0, posts: [] },
      subredditDeltas: [],
    });

    await invoke(handlers, "compare_digests", {
      digestIdA: "previous",
      digestIdB: "latest",
    });

    expect(deps.query).toHaveBeenCalledWith(
      "CompareDigests",
      { digestIdA: "d-previous", digestIdB: "d-latest", subreddit: undefined },
      deps.result.ctx,
    );
  });

  it("returns NOT_FOUND when fewer than 2 digests exist for shorthand", async () => {
    Object.assign(deps.result.db, {
      digest: {
        findMany: vi.fn().mockResolvedValue([
          { id: "d-only", createdAt: new Date("2026-03-11") },
        ]),
      },
    });

    const result = await invoke(handlers, "compare_digests", {
      digestIdA: "previous",
      digestIdB: "latest",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_ERROR when both IDs resolve to same digest", async () => {
    const result = await invoke(handlers, "compare_digests", {
      digestIdA: "d-same",
      digestIdB: "d-same",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("VALIDATION_ERROR");
  });

  it("passes subreddit filter to query", async () => {
    deps.query.mockResolvedValue({
      digestA: { id: "d-a" },
      digestB: { id: "d-b" },
      overlap: { count: 0, percentage: 0, posts: [] },
      added: { count: 0, posts: [] },
      removed: { count: 0, posts: [] },
      subredditDeltas: [],
    });

    await invoke(handlers, "compare_digests", {
      digestIdA: "d-a",
      digestIdB: "d-b",
      subreddit: "typescript",
    });

    expect(deps.query).toHaveBeenCalledWith(
      "CompareDigests",
      { digestIdA: "d-a", digestIdB: "d-b", subreddit: "typescript" },
      deps.result.ctx,
    );
  });
});
