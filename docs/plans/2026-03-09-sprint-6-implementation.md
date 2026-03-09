# Sprint 6: MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone MCP server with 15 tools that exposes the full Redgest API (digest generation, content access, configuration) over both HTTP and stdio transports.

**Architecture:** Thin adapter tools call existing CQRS command/query handlers. Event-driven pipeline execution (DigestRequested → runDigestPipeline) mirrors future Trigger.dev flow. Hono + @hono/mcp for HTTP, @modelcontextprotocol/sdk StdioServerTransport for Claude Desktop.

**Tech Stack:** @modelcontextprotocol/sdk ^1.27, @hono/mcp ^0.2, hono ^4, zod ^4 (already installed)

**Design doc:** `docs/plans/2026-03-09-sprint-6-design.md`

---

## Dependency Graph

```
Task 1 (deps install)
  ├── Task 2 (envelope) ─────┐
  ├── Task 3 (auth) ─────────┤
  └── Task 4 (bootstrap) ────┤
                              └── Task 5 (tools) ──┬── Task 6 (http)
                                                    ├── Task 7 (stdio)
                                                    └── Task 8 (exports + Dockerfile)
```

Tasks 2, 3, 4 are independent of each other.

---

## Task 1: Install Dependencies

**Files:**
- Modify: `packages/mcp-server/package.json`

**Step 1: Install production dependencies**

```bash
pnpm --filter @redgest/mcp-server add hono @hono/mcp @modelcontextprotocol/sdk
```

**Step 2: Add workspace dependencies**

```bash
pnpm --filter @redgest/mcp-server add @redgest/core@workspace:* @redgest/db@workspace:* @redgest/reddit@workspace:* @redgest/config@workspace:*
```

**Step 3: Verify package.json has correct deps**

Check `packages/mcp-server/package.json` has all deps listed. Also verify `turbo build` still succeeds:

```bash
turbo build --filter=@redgest/mcp-server
```

**Step 4: Commit**

```bash
git add packages/mcp-server/package.json pnpm-lock.yaml
git commit -m "chore(mcp-server): add hono, MCP SDK, and workspace dependencies"
```

---

## Task 2: Response Envelope Utility

**Files:**
- Create: `packages/mcp-server/src/envelope.ts`
- Create: `packages/mcp-server/src/__tests__/envelope.test.ts`

**Context:** Every MCP tool returns `{ok, data}` on success or `{ok: false, error: {code, message}}` on failure. The MCP SDK wraps tool results in `content: [{type: "text", text: "..."}]`. The `isError` flag tells MCP clients this was a failure.

**Step 1: Write the tests**

```typescript
// packages/mcp-server/src/__tests__/envelope.test.ts
import { describe, it, expect } from "vitest";
import { envelope, envelopeError } from "../envelope.js";

describe("envelope", () => {
  it("wraps data in MCP text content with ok: true", () => {
    const result = envelope({ jobId: "j-1", status: "queued" });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            data: { jobId: "j-1", status: "queued" },
          }),
        },
      ],
    });
  });

  it("handles null data", () => {
    const result = envelope(null);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ ok: true, data: null });
  });

  it("handles array data", () => {
    const result = envelope([1, 2, 3]);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ ok: true, data: [1, 2, 3] });
  });
});

describe("envelopeError", () => {
  it("wraps error in MCP text content with ok: false and isError flag", () => {
    const result = envelopeError("NOT_FOUND", "Job not found");

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: { code: "NOT_FOUND", message: "Job not found" },
          }),
        },
      ],
      isError: true,
    });
  });

  it("serializes correctly", () => {
    const result = envelopeError("INTERNAL_ERROR", "Something broke");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INTERNAL_ERROR");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/envelope.test.ts
```

Expected: FAIL — `envelope` and `envelopeError` not found.

**Step 3: Implement envelope.ts**

```typescript
// packages/mcp-server/src/envelope.ts

/**
 * MCP tool result type — matches @modelcontextprotocol/sdk CallToolResult.
 * Defined locally to avoid importing SDK types in a utility file.
 */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Wrap successful data in the Redgest MCP response envelope.
 * Returns { content: [{ type: "text", text: JSON.stringify({ ok: true, data }) }] }
 */
export function envelope(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: true, data }),
      },
    ],
  };
}

/**
 * Wrap an error in the Redgest MCP response envelope.
 * Sets isError: true to signal failure to MCP clients.
 */
export function envelopeError(code: string, message: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: { code, message } }),
      },
    ],
    isError: true,
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/envelope.test.ts
```

Expected: 5 tests PASS.

**Step 5: Commit**

```bash
git add packages/mcp-server/src/envelope.ts packages/mcp-server/src/__tests__/envelope.test.ts
git commit -m "feat(mcp-server): add response envelope utility"
```

---

## Task 3: Bearer Auth Middleware

**Files:**
- Create: `packages/mcp-server/src/auth.ts`
- Create: `packages/mcp-server/src/__tests__/auth.test.ts`

**Context:** HTTP transport requires bearer token auth. The token is `MCP_SERVER_API_KEY` from `@redgest/config` (≥32 chars). Stdio transport skips auth (local process, trusted). Health check endpoint also bypasses auth.

The middleware is a plain Hono middleware function. It checks the `Authorization: Bearer <token>` header and returns a 401 JSON response on failure using the same `{ok, error}` envelope shape.

**Step 1: Write the tests**

```typescript
// packages/mcp-server/src/__tests__/auth.test.ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { bearerAuthMiddleware } from "../auth.js";

function createTestApp(apiKey: string) {
  const app = new Hono();
  app.use("/mcp/*", bearerAuthMiddleware(apiKey));
  app.post("/mcp/test", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  return app;
}

describe("bearerAuthMiddleware", () => {
  const API_KEY = "a".repeat(32);

  it("allows requests with valid bearer token", async () => {
    const app = createTestApp(API_KEY);
    const res = await app.request("/mcp/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects requests with missing Authorization header", async () => {
    const app = createTestApp(API_KEY);
    const res = await app.request("/mcp/test", { method: "POST" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization" },
    });
  });

  it("rejects requests with wrong token", async () => {
    const app = createTestApp(API_KEY);
    const res = await app.request("/mcp/test", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-Bearer auth schemes", async () => {
    const app = createTestApp(API_KEY);
    const res = await app.request("/mcp/test", {
      method: "POST",
      headers: { Authorization: `Basic ${API_KEY}` },
    });
    expect(res.status).toBe(401);
  });

  it("does not apply to routes outside /mcp/*", async () => {
    const app = createTestApp(API_KEY);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/auth.test.ts
```

Expected: FAIL — `bearerAuthMiddleware` not found.

**Step 3: Implement auth.ts**

```typescript
// packages/mcp-server/src/auth.ts
import { createMiddleware } from "hono/factory";

/**
 * Bearer token auth middleware for MCP HTTP transport.
 * Validates Authorization: Bearer <token> against the provided API key.
 * Returns 401 JSON envelope on failure.
 */
export function bearerAuthMiddleware(apiKey: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("Authorization");

    if (!header || !header.startsWith("Bearer ")) {
      return c.json(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid authorization",
          },
        },
        401,
      );
    }

    const token = header.slice(7);
    if (token !== apiKey) {
      return c.json(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Missing or invalid authorization",
          },
        },
        401,
      );
    }

    await next();
  });
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/auth.test.ts
```

Expected: 5 tests PASS.

**Step 5: Commit**

```bash
git add packages/mcp-server/src/auth.ts packages/mcp-server/src/__tests__/auth.test.ts
git commit -m "feat(mcp-server): add bearer auth middleware"
```

---

## Task 4: Bootstrap — Shared Startup

**Files:**
- Create: `packages/mcp-server/src/bootstrap.ts`
- Create: `packages/mcp-server/src/__tests__/bootstrap.test.ts`

**Context:** Both HTTP and stdio entry points need the same shared state: Prisma client, event bus, handler context, command/query dispatchers, and pipeline deps. `bootstrap()` constructs all of these and wires the `DigestRequested` event handler to `runDigestPipeline()`.

Key imports from existing packages:
- `@redgest/config`: `loadConfig()`, `type RedgestConfig`
- `@redgest/db`: `PrismaClient`
- `@redgest/core`: `DomainEventBus`, `createExecute`, `createQuery`, `commandHandlers`, `queryHandlers`, `runDigestPipeline`, `type PipelineDeps`, `type HandlerContext`
- `@redgest/reddit`: `RedditClient`, `TokenBucket`, `RedditContentSource`

The `execute` function signature is: `execute<K>(type: K, params: CommandMap[K], ctx: ExecuteContext) → Promise<CommandResultMap[K]>`
The `query` function signature is: `query<K>(type: K, params: QueryMap[K], ctx: HandlerContext) → Promise<QueryResultMap[K]>`

**Step 1: Write the tests**

```typescript
// packages/mcp-server/src/__tests__/bootstrap.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external packages before importing bootstrap
vi.mock("@redgest/config", () => ({
  loadConfig: vi.fn().mockReturnValue({
    DATABASE_URL: "postgres://test",
    ANTHROPIC_API_KEY: "sk-test",
    TRIGGER_SECRET_KEY: "tr-test",
    MCP_SERVER_API_KEY: "a".repeat(32),
    MCP_SERVER_PORT: 3100,
    REDDIT_CLIENT_ID: "test-id",
    REDDIT_CLIENT_SECRET: "test-secret",
    LOG_LEVEL: "info",
    NODE_ENV: "test",
  }),
}));

vi.mock("@redgest/db", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $disconnect: vi.fn(),
  })),
}));

vi.mock("@redgest/core", () => ({
  DomainEventBus: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    emitEvent: vi.fn(),
  })),
  createExecute: vi.fn().mockReturnValue(vi.fn()),
  createQuery: vi.fn().mockReturnValue(vi.fn()),
  commandHandlers: {},
  queryHandlers: {},
  runDigestPipeline: vi.fn(),
}));

vi.mock("@redgest/reddit", () => ({
  RedditClient: vi.fn().mockImplementation(() => ({})),
  TokenBucket: vi.fn().mockImplementation(() => ({})),
  RedditContentSource: vi.fn().mockImplementation(() => ({})),
}));

import { bootstrap } from "../bootstrap.js";
import { loadConfig } from "@redgest/config";
import { DomainEventBus, createExecute, createQuery, runDigestPipeline } from "@redgest/core";
import { RedditClient, TokenBucket, RedditContentSource } from "@redgest/reddit";

describe("bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads config", async () => {
    await bootstrap();
    expect(loadConfig).toHaveBeenCalled();
  });

  it("creates event bus and registers DigestRequested handler", async () => {
    const mockOn = vi.fn();
    vi.mocked(DomainEventBus).mockImplementation(
      () => ({ on: mockOn, emitEvent: vi.fn() }) as unknown as InstanceType<typeof DomainEventBus>,
    );

    await bootstrap();

    expect(mockOn).toHaveBeenCalledWith("DigestRequested", expect.any(Function));
  });

  it("creates command and query dispatchers from handler registries", async () => {
    await bootstrap();
    expect(createExecute).toHaveBeenCalled();
    expect(createQuery).toHaveBeenCalled();
  });

  it("creates RedditContentSource with client and rate limiter", async () => {
    await bootstrap();
    expect(RedditClient).toHaveBeenCalledWith({
      clientId: "test-id",
      clientSecret: "test-secret",
      userAgent: expect.stringContaining("redgest"),
    });
    expect(TokenBucket).toHaveBeenCalledWith({ capacity: 60, refillRate: 1 });
    expect(RedditContentSource).toHaveBeenCalled();
  });

  it("returns execute, query, ctx, config, and db", async () => {
    const result = await bootstrap();
    expect(result).toHaveProperty("execute");
    expect(result).toHaveProperty("query");
    expect(result).toHaveProperty("ctx");
    expect(result).toHaveProperty("config");
    expect(result).toHaveProperty("db");
  });

  it("DigestRequested handler calls runDigestPipeline with correct args", async () => {
    let registeredHandler: (event: unknown) => Promise<void> = async () => {};
    const mockOn = vi.fn().mockImplementation((_type: string, handler: (event: unknown) => Promise<void>) => {
      registeredHandler = handler;
    });
    vi.mocked(DomainEventBus).mockImplementation(
      () => ({ on: mockOn, emitEvent: vi.fn() }) as unknown as InstanceType<typeof DomainEventBus>,
    );

    await bootstrap();

    // Simulate the event
    await registeredHandler({
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    expect(runDigestPipeline).toHaveBeenCalledWith(
      "job-1",
      ["sub-1"],
      expect.objectContaining({
        db: expect.anything(),
        eventBus: expect.anything(),
        contentSource: expect.anything(),
      }),
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/bootstrap.test.ts
```

Expected: FAIL — `bootstrap` not found.

**Step 3: Implement bootstrap.ts**

```typescript
// packages/mcp-server/src/bootstrap.ts
import { loadConfig } from "@redgest/config";
import type { RedgestConfig } from "@redgest/config";
import { PrismaClient } from "@redgest/db";
import {
  DomainEventBus,
  createExecute,
  createQuery,
  commandHandlers,
  queryHandlers,
  runDigestPipeline,
  type HandlerContext,
  type PipelineDeps,
} from "@redgest/core";
import type { ExecuteContext } from "@redgest/core";
import {
  RedditClient,
  TokenBucket,
  RedditContentSource,
} from "@redgest/reddit";

export interface BootstrapResult {
  execute: ReturnType<typeof createExecute>;
  query: ReturnType<typeof createQuery>;
  ctx: HandlerContext;
  config: RedgestConfig;
  db: PrismaClient;
}

/**
 * Initialize all shared dependencies for the MCP server.
 * Called by both http.ts and stdio.ts entry points.
 */
export async function bootstrap(): Promise<BootstrapResult> {
  const config = loadConfig();

  const db = new PrismaClient();
  const eventBus = new DomainEventBus();

  const ctx: HandlerContext = {
    db,
    eventBus,
    config,
  };

  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);

  // Create Reddit content source for pipeline
  const redditClient = new RedditClient({
    clientId: config.REDDIT_CLIENT_ID,
    clientSecret: config.REDDIT_CLIENT_SECRET,
    userAgent: "redgest/1.0.0 (MCP Server)",
  });
  const rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
  const contentSource = new RedditContentSource(redditClient, rateLimiter);

  const pipelineDeps: PipelineDeps = {
    db,
    eventBus,
    contentSource,
    config,
  };

  // Wire DigestRequested → runDigestPipeline (Phase 1 in-process).
  // In Phase 2, this is replaced by Trigger.dev task registration.
  eventBus.on("DigestRequested", async (event) => {
    const { jobId, subredditIds } = event.payload;
    await runDigestPipeline(jobId, subredditIds, pipelineDeps);
  });

  return { execute, query, ctx: ctx as HandlerContext, config, db };
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/bootstrap.test.ts
```

Expected: 6 tests PASS.

**Step 5: Run lint + typecheck**

```bash
turbo lint --filter=@redgest/mcp-server && turbo typecheck --filter=@redgest/mcp-server
```

You may need to adjust types if the `PipelineDeps` interface expects `config` as the full `RedgestConfig` type. Check `packages/core/src/pipeline/types.ts` for the exact shape. The `PipelineDeps.config` field should accept `RedgestConfig` since it was designed that way.

**Step 6: Commit**

```bash
git add packages/mcp-server/src/bootstrap.ts packages/mcp-server/src/__tests__/bootstrap.test.ts
git commit -m "feat(mcp-server): add bootstrap startup with event-driven pipeline wiring"
```

---

## Task 5: Tool Server — Register All 15 MCP Tools

**Files:**
- Create: `packages/mcp-server/src/tools.ts`
- Create: `packages/mcp-server/src/__tests__/tools.test.ts`

**Context:** This is the heart of the MCP server. Each of the 15 tools is a thin adapter:
1. Validate input via Zod raw shape (SDK does this automatically)
2. Translate MCP params → handler params
3. Call `execute()` (commands) or `query()` (queries)
4. Wrap result in `envelope()` or `envelopeError()`

**Key API:** Use `server.tool()` from `@modelcontextprotocol/sdk`. The input schema must be a **Zod raw shape** (plain object of Zod schemas), NOT a `z.object()`.

```typescript
server.tool("name", "description", { param: z.string() }, async (args) => {
  // args is typed: { param: string }
  return { content: [{ type: "text", text: "..." }] };
});
```

**Handler types:**
- `execute("GenerateDigest", params, ctx)` → `{ jobId: string; status: string }`
- `query("GetDigest", params, ctx)` → `DigestView | null`
- `execute("AddSubreddit", params, ctx)` → `{ subredditId: string }`
- etc. (see `packages/core/src/commands/types.ts` and `packages/core/src/queries/types.ts`)

**Important input translations:**
- `generate_digest`: `subreddits` → `subredditIds`, `lookback` string → `lookbackHours` number
- `get_digest`: `jobId?` → must look up digest by job; if omitted query latest
- `remove_subreddit` / `update_subreddit`: `name` → look up `subredditId` via `ListSubreddits` query
- `add_subreddit`: derive `displayName` from `name`, map `includeNsfw` → `nsfw`

**Step 1: Write the tests**

The test file will be large. Test each tool's:
- Input translation (MCP params → handler params)
- Success envelope
- Error handling (RedgestError → envelopeError)
- Edge cases (get_digest latest, remove_subreddit lookup)

```typescript
// packages/mcp-server/src/__tests__/tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createToolServer } from "../tools.js";
import type { BootstrapResult } from "../bootstrap.js";
import { RedgestError, ErrorCode } from "@redgest/core";

// Create mock bootstrap result
function createMockDeps(): BootstrapResult {
  return {
    execute: vi.fn(),
    query: vi.fn(),
    ctx: {
      db: {} as BootstrapResult["ctx"]["db"],
      eventBus: { on: vi.fn(), emitEvent: vi.fn() } as unknown as BootstrapResult["ctx"]["eventBus"],
      config: {} as BootstrapResult["ctx"]["config"],
    },
    config: { MCP_SERVER_PORT: 3100 } as BootstrapResult["config"],
    db: { $disconnect: vi.fn() } as unknown as BootstrapResult["db"],
  };
}

describe("createToolServer", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it("returns an McpServer instance", () => {
    const server = createToolServer(deps);
    expect(server).toBeDefined();
  });
});

describe("tool: use_redgest", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    // We test tools by extracting the registered callbacks.
    // Since McpServer doesn't expose a simple call API, we test
    // the handler functions directly via createToolHandlers().
    const { handlers } = await import("../tools.js").then((m) => ({
      handlers: m.createToolHandlers(deps),
    }));
    callTool = async (name, args = {}) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    };
  });

  it("returns a usage guide", async () => {
    const result = (await callTool("use_redgest")) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.data).toContain("generate_digest");
    expect(parsed.data).toContain("get_run_status");
  });
});

describe("tool: generate_digest", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    vi.mocked(deps.execute).mockResolvedValue({ jobId: "job-1", status: "QUEUED" });
    const { handlers } = await import("../tools.js").then((m) => ({
      handlers: m.createToolHandlers(deps),
    }));
    callTool = async (name, args = {}) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    };
  });

  it("dispatches GenerateDigest command with translated params", async () => {
    await callTool("generate_digest", {
      subreddits: ["typescript", "rust"],
      lookback: "48h",
    });

    expect(deps.execute).toHaveBeenCalledWith(
      "GenerateDigest",
      { subredditIds: ["typescript", "rust"], lookbackHours: 48 },
      expect.anything(),
    );
  });

  it("defaults lookbackHours when not provided", async () => {
    await callTool("generate_digest", {});

    expect(deps.execute).toHaveBeenCalledWith(
      "GenerateDigest",
      { subredditIds: undefined, lookbackHours: undefined },
      expect.anything(),
    );
  });

  it("returns envelope with jobId and status", async () => {
    const result = (await callTool("generate_digest", {})) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ ok: true, data: { jobId: "job-1", status: "QUEUED" } });
  });

  it("returns envelopeError on failure", async () => {
    vi.mocked(deps.execute).mockRejectedValue(
      new RedgestError(ErrorCode.VALIDATION_ERROR, "No subreddits configured"),
    );

    const result = (await callTool("generate_digest", {})) as { content: Array<{ text: string }>; isError: boolean };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("VALIDATION_ERROR");
    expect(result.isError).toBe(true);
  });
});

describe("tool: get_run_status", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    const { handlers } = await import("../tools.js").then((m) => ({
      handlers: m.createToolHandlers(deps),
    }));
    callTool = async (name, args = {}) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    };
  });

  it("queries GetRunStatus with jobId", async () => {
    vi.mocked(deps.query).mockResolvedValue({
      id: "job-1",
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    });

    const result = (await callTool("get_run_status", { jobId: "job-1" })) as { content: Array<{ text: string }> };
    expect(deps.query).toHaveBeenCalledWith("GetRunStatus", { jobId: "job-1" }, expect.anything());
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
  });

  it("returns NOT_FOUND when job doesn't exist", async () => {
    vi.mocked(deps.query).mockResolvedValue(null);

    const result = (await callTool("get_run_status", { jobId: "bad" })) as {
      content: Array<{ text: string }>;
      isError: boolean;
    };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("NOT_FOUND");
  });
});

describe("tool: get_digest", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    const { handlers } = await import("../tools.js").then((m) => ({
      handlers: m.createToolHandlers(deps),
    }));
    callTool = async (name, args = {}) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    };
  });

  it("queries by digestId when provided", async () => {
    vi.mocked(deps.query).mockResolvedValue({ id: "d-1", contentMarkdown: "# Digest" });

    await callTool("get_digest", { digestId: "d-1" });
    expect(deps.query).toHaveBeenCalledWith("GetDigest", { digestId: "d-1" }, expect.anything());
  });

  it("queries latest digest when no digestId provided", async () => {
    vi.mocked(deps.query)
      .mockResolvedValueOnce([{ id: "d-latest" }]) // ListDigests
      .mockResolvedValueOnce({ id: "d-latest", contentMarkdown: "# Latest" }); // GetDigest

    await callTool("get_digest", {});
    expect(deps.query).toHaveBeenCalledWith("ListDigests", { limit: 1 }, expect.anything());
    expect(deps.query).toHaveBeenCalledWith("GetDigest", { digestId: "d-latest" }, expect.anything());
  });

  it("returns NOT_FOUND when no digests exist", async () => {
    vi.mocked(deps.query).mockResolvedValueOnce([]); // ListDigests returns empty

    const result = (await callTool("get_digest", {})) as { content: Array<{ text: string }>; isError: boolean };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("NOT_FOUND");
  });
});

describe("tool: remove_subreddit", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    const { handlers } = await import("../tools.js").then((m) => ({
      handlers: m.createToolHandlers(deps),
    }));
    callTool = async (name, args = {}) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    };
  });

  it("looks up subreddit by name then calls RemoveSubreddit with ID", async () => {
    vi.mocked(deps.query).mockResolvedValueOnce([
      { id: "sub-1", name: "typescript" },
      { id: "sub-2", name: "rust" },
    ]);
    vi.mocked(deps.execute).mockResolvedValue({ subredditId: "sub-1" });

    await callTool("remove_subreddit", { name: "typescript" });

    expect(deps.query).toHaveBeenCalledWith("ListSubreddits", {}, expect.anything());
    expect(deps.execute).toHaveBeenCalledWith(
      "RemoveSubreddit",
      { subredditId: "sub-1" },
      expect.anything(),
    );
  });

  it("returns NOT_FOUND when subreddit name not found", async () => {
    vi.mocked(deps.query).mockResolvedValueOnce([]);

    const result = (await callTool("remove_subreddit", { name: "nonexistent" })) as {
      content: Array<{ text: string }>;
      isError: boolean;
    };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("NOT_FOUND");
  });
});

describe("tool: add_subreddit", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    vi.mocked(deps.execute).mockResolvedValue({ subredditId: "sub-new" });
    const { handlers } = await import("../tools.js").then((m) => ({
      handlers: m.createToolHandlers(deps),
    }));
    callTool = async (name, args = {}) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    };
  });

  it("translates name to displayName and includeNsfw to nsfw", async () => {
    await callTool("add_subreddit", {
      name: "typescript",
      insightPrompt: "Focus on type-level programming",
      maxPosts: 10,
      includeNsfw: true,
    });

    expect(deps.execute).toHaveBeenCalledWith(
      "AddSubreddit",
      {
        name: "typescript",
        displayName: "typescript",
        insightPrompt: "Focus on type-level programming",
        maxPosts: 10,
        nsfw: true,
      },
      expect.anything(),
    );
  });
});

// Additional tools can use simpler tests since the pattern is established.
// The key variations are: query tools with null-check, command tools with translation.

describe("simple query tools", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    deps = createMockDeps();
    const { handlers } = await import("../tools.js").then((m) => ({
      handlers: m.createToolHandlers(deps),
    }));
    callTool = async (name, args = {}) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      return handler(args);
    };
  });

  it("list_runs queries ListRuns", async () => {
    vi.mocked(deps.query).mockResolvedValue([]);
    await callTool("list_runs", { limit: 10 });
    expect(deps.query).toHaveBeenCalledWith("ListRuns", { limit: 10 }, expect.anything());
  });

  it("list_digests queries ListDigests", async () => {
    vi.mocked(deps.query).mockResolvedValue([]);
    await callTool("list_digests", { limit: 5 });
    expect(deps.query).toHaveBeenCalledWith("ListDigests", { limit: 5 }, expect.anything());
  });

  it("get_post queries GetPost and returns NOT_FOUND for null", async () => {
    vi.mocked(deps.query).mockResolvedValue(null);
    const result = (await callTool("get_post", { postId: "bad" })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("NOT_FOUND");
  });

  it("search_posts queries SearchPosts", async () => {
    vi.mocked(deps.query).mockResolvedValue([]);
    await callTool("search_posts", { query: "typescript", limit: 10 });
    expect(deps.query).toHaveBeenCalledWith("SearchPosts", { query: "typescript", limit: 10 }, expect.anything());
  });

  it("search_digests queries SearchDigests", async () => {
    vi.mocked(deps.query).mockResolvedValue([]);
    await callTool("search_digests", { query: "ai", limit: 5 });
    expect(deps.query).toHaveBeenCalledWith("SearchDigests", { query: "ai", limit: 5 }, expect.anything());
  });

  it("list_subreddits queries ListSubreddits", async () => {
    vi.mocked(deps.query).mockResolvedValue([]);
    await callTool("list_subreddits");
    expect(deps.query).toHaveBeenCalledWith("ListSubreddits", {}, expect.anything());
  });

  it("get_config queries GetConfig", async () => {
    vi.mocked(deps.query).mockResolvedValue({ id: "cfg-1", globalInsightPrompt: "AI" });
    await callTool("get_config");
    expect(deps.query).toHaveBeenCalledWith("GetConfig", {}, expect.anything());
  });

  it("update_config dispatches UpdateConfig", async () => {
    vi.mocked(deps.execute).mockResolvedValue({ success: true });
    await callTool("update_config", { globalInsightPrompt: "Focus on AI" });
    expect(deps.execute).toHaveBeenCalledWith(
      "UpdateConfig",
      { globalInsightPrompt: "Focus on AI" },
      expect.anything(),
    );
  });

  it("update_subreddit looks up by name then dispatches UpdateSubreddit", async () => {
    vi.mocked(deps.query).mockResolvedValueOnce([
      { id: "sub-1", name: "typescript" },
    ]);
    vi.mocked(deps.execute).mockResolvedValue({ subredditId: "sub-1" });

    await callTool("update_subreddit", { name: "typescript", maxPosts: 10 });

    expect(deps.execute).toHaveBeenCalledWith(
      "UpdateSubreddit",
      { subredditId: "sub-1", maxPosts: 10 },
      expect.anything(),
    );
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts
```

Expected: FAIL — `createToolServer` and `createToolHandlers` not found.

**Step 3: Implement tools.ts**

```typescript
// packages/mcp-server/src/tools.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RedgestError } from "@redgest/core";
import { envelope, envelopeError, type ToolResult } from "./envelope.js";
import type { BootstrapResult } from "./bootstrap.js";

// ── Usage guide ──────────────────────────────────────────────

const USAGE_GUIDE = `# Redgest — Reddit Digest Engine

## Quick Start
1. **See what's monitored:** \`list_subreddits\`
2. **Generate a digest:** \`generate_digest\`
3. **Check progress:** \`get_run_status\` with the returned jobId
4. **Read the digest:** \`get_digest\` (returns latest by default)

## Tool Groups

### Pipeline
- \`generate_digest\` — Trigger a new digest run (returns jobId for polling)
- \`get_run_status\` — Check digest run progress (poll until completed/failed)
- \`list_runs\` — View history of past runs

### Content
- \`get_digest\` — Read digest content (latest by default, or by digestId)
- \`get_post\` — Deep-dive into a single post with full summary
- \`list_digests\` — Browse all past digests
- \`search_posts\` — Search stored posts by keyword
- \`search_digests\` — Search past digest summaries

### Configuration
- \`list_subreddits\` — Show monitored subreddits with insight prompts
- \`add_subreddit\` — Start monitoring a subreddit
- \`remove_subreddit\` — Stop monitoring a subreddit
- \`update_subreddit\` — Change subreddit settings (insight prompt, max posts)
- \`get_config\` — Show global settings
- \`update_config\` — Change global insight prompt or LLM settings

## Tips
- After \`generate_digest\`, poll \`get_run_status\` every few seconds until status is "COMPLETED" or "FAILED"
- Use \`add_subreddit\` with an \`insightPrompt\` to personalize what gets selected
- The global insight prompt (via \`update_config\`) applies to ALL subreddits
`;

// ── Helper: parse "48h" → 48 ────────────────────────────────

function parseLookbackHours(lookback?: string): number | undefined {
  if (!lookback) return undefined;
  const match = lookback.match(/^(\d+)h$/);
  return match ? Number(match[1]) : undefined;
}

// ── Helper: find subreddit by name ──────────────────────────

async function findSubredditByName(
  name: string,
  query: BootstrapResult["query"],
  ctx: BootstrapResult["ctx"],
): Promise<{ id: string } | null> {
  const subs = (await query("ListSubreddits", {}, ctx)) as Array<{ id: string; name: string }>;
  return subs.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;
}

// ── Error wrapper ───────────────────────────────────────────

function handleError(err: unknown): ToolResult {
  if (err instanceof RedgestError) {
    return envelopeError(err.code, err.message);
  }
  const message = err instanceof Error ? err.message : String(err);
  return envelopeError("INTERNAL_ERROR", message);
}

// ── Tool handler type ───────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// ── Exported for testing: raw handler map ───────────────────

export function createToolHandlers(
  deps: BootstrapResult,
): Record<string, ToolHandler> {
  const { execute, query, ctx } = deps;

  return {
    // ── Meta ──
    use_redgest: async () => envelope(USAGE_GUIDE),

    // ── Pipeline ──
    generate_digest: async (args) => {
      try {
        const result = await execute(
          "GenerateDigest",
          {
            subredditIds: args.subreddits as string[] | undefined,
            lookbackHours: parseLookbackHours(args.lookback as string | undefined),
          },
          ctx,
        );
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    get_run_status: async (args) => {
      try {
        const result = await query("GetRunStatus", { jobId: args.jobId as string }, ctx);
        if (!result) return envelopeError("NOT_FOUND", `Job ${args.jobId} not found`);
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    list_runs: async (args) => {
      try {
        const result = await query("ListRuns", { limit: args.limit as number | undefined }, ctx);
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    // ── Content ──
    get_digest: async (args) => {
      try {
        let digestId = args.digestId as string | undefined;

        if (!digestId) {
          // Look up latest digest
          const digests = (await query("ListDigests", { limit: 1 }, ctx)) as Array<{ id: string }>;
          if (digests.length === 0) {
            return envelopeError("NOT_FOUND", "No digests found");
          }
          digestId = digests[0].id;
        }

        const result = await query("GetDigest", { digestId }, ctx);
        if (!result) return envelopeError("NOT_FOUND", `Digest ${digestId} not found`);
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    get_post: async (args) => {
      try {
        const result = await query("GetPost", { postId: args.postId as string }, ctx);
        if (!result) return envelopeError("NOT_FOUND", `Post ${args.postId} not found`);
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    list_digests: async (args) => {
      try {
        const result = await query("ListDigests", { limit: args.limit as number | undefined }, ctx);
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    search_posts: async (args) => {
      try {
        const result = await query(
          "SearchPosts",
          { query: args.query as string, limit: args.limit as number | undefined },
          ctx,
        );
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    search_digests: async (args) => {
      try {
        const result = await query(
          "SearchDigests",
          { query: args.query as string, limit: args.limit as number | undefined },
          ctx,
        );
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    list_subreddits: async () => {
      try {
        const result = await query("ListSubreddits", {}, ctx);
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    // ── Configuration ──
    add_subreddit: async (args) => {
      try {
        const result = await execute(
          "AddSubreddit",
          {
            name: args.name as string,
            displayName: args.name as string,
            insightPrompt: args.insightPrompt as string | undefined,
            maxPosts: args.maxPosts as number | undefined,
            nsfw: args.includeNsfw as boolean | undefined,
          },
          ctx,
        );
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    remove_subreddit: async (args) => {
      try {
        const sub = await findSubredditByName(args.name as string, query, ctx);
        if (!sub) return envelopeError("NOT_FOUND", `Subreddit r/${args.name} not found`);
        const result = await execute("RemoveSubreddit", { subredditId: sub.id }, ctx);
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    update_subreddit: async (args) => {
      try {
        const sub = await findSubredditByName(args.name as string, query, ctx);
        if (!sub) return envelopeError("NOT_FOUND", `Subreddit r/${args.name} not found`);
        const result = await execute(
          "UpdateSubreddit",
          {
            subredditId: sub.id,
            insightPrompt: args.insightPrompt as string | undefined,
            maxPosts: args.maxPosts as number | undefined,
            active: args.active as boolean | undefined,
          },
          ctx,
        );
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    get_config: async () => {
      try {
        const result = await query("GetConfig", {}, ctx);
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },

    update_config: async (args) => {
      try {
        const result = await execute(
          "UpdateConfig",
          {
            globalInsightPrompt: args.globalInsightPrompt as string | undefined,
            defaultLookbackHours: args.defaultLookbackHours as number | undefined,
            llmProvider: args.llmProvider as string | undefined,
            llmModel: args.llmModel as string | undefined,
          },
          ctx,
        );
        return envelope(result);
      } catch (err) {
        return handleError(err);
      }
    },
  };
}

// ── McpServer registration ──────────────────────────────────

export function createToolServer(deps: BootstrapResult): McpServer {
  const server = new McpServer({
    name: "redgest",
    version: "1.0.0",
  });

  const handlers = createToolHandlers(deps);

  // ── Meta ──
  server.tool("use_redgest", "Get a usage guide for all Redgest tools", async () => handlers.use_redgest({}));

  // ── Pipeline ──
  server.tool(
    "generate_digest",
    "Trigger a new digest run. Returns a jobId — poll get_run_status for progress.",
    {
      subreddits: z.array(z.string()).optional().describe("Subreddit names to include (default: all active)"),
      lookback: z.string().optional().describe('Lookback period, e.g. "24h", "48h" (default: "24h")'),
    },
    async (args) => handlers.generate_digest(args),
  );

  server.tool(
    "get_run_status",
    "Check the status of a digest run. Use after generate_digest to poll for completion.",
    {
      jobId: z.string().describe("The job ID returned by generate_digest"),
    },
    async (args) => handlers.get_run_status(args),
  );

  server.tool(
    "list_runs",
    "View history of past digest runs with status and timing.",
    {
      limit: z.number().optional().describe("Max results to return (default: 20)"),
    },
    async (args) => handlers.list_runs(args),
  );

  // ── Content ──
  server.tool(
    "get_digest",
    "Fetch digest content. Returns the latest completed digest by default.",
    {
      digestId: z.string().optional().describe("Specific digest ID (default: latest completed)"),
    },
    async (args) => handlers.get_digest(args),
  );

  server.tool(
    "get_post",
    "Deep-dive into a single post with full summary, takeaways, and comments.",
    {
      postId: z.string().describe("The Redgest post ID"),
    },
    async (args) => handlers.get_post(args),
  );

  server.tool(
    "list_digests",
    "Browse all past digests.",
    {
      limit: z.number().optional().describe("Max results to return (default: 20)"),
    },
    async (args) => handlers.list_digests(args),
  );

  server.tool(
    "search_posts",
    "Search stored posts by keyword.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async (args) => handlers.search_posts(args),
  );

  server.tool(
    "search_digests",
    "Search past digest summaries by keyword.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
    async (args) => handlers.search_digests(args),
  );

  server.tool(
    "list_subreddits",
    "Show all monitored subreddits with their insight prompts and settings.",
    async () => handlers.list_subreddits({}),
  );

  // ── Configuration ──
  server.tool(
    "add_subreddit",
    "Start monitoring a subreddit. Optionally set an insight prompt for personalized curation.",
    {
      name: z.string().describe("Subreddit name without r/ prefix"),
      insightPrompt: z.string().optional().describe("What to look for in this subreddit"),
      maxPosts: z.number().optional().describe("Max posts per digest (default: 5)"),
      includeNsfw: z.boolean().optional().describe("Include NSFW posts (default: false)"),
    },
    async (args) => handlers.add_subreddit(args),
  );

  server.tool(
    "remove_subreddit",
    "Stop monitoring a subreddit.",
    {
      name: z.string().describe("Subreddit name to remove"),
    },
    async (args) => handlers.remove_subreddit(args),
  );

  server.tool(
    "update_subreddit",
    "Modify a subreddit's settings (insight prompt, max posts, active status).",
    {
      name: z.string().describe("Subreddit name to update"),
      insightPrompt: z.string().optional().describe("New insight prompt"),
      maxPosts: z.number().optional().describe("New max posts per digest"),
      active: z.boolean().optional().describe("Enable/disable this subreddit"),
    },
    async (args) => handlers.update_subreddit(args),
  );

  server.tool(
    "get_config",
    "Show global settings including insight prompt and LLM configuration.",
    async () => handlers.get_config({}),
  );

  server.tool(
    "update_config",
    "Change global settings. The global insight prompt applies to all subreddits.",
    {
      globalInsightPrompt: z.string().optional().describe("Global insight prompt for all subreddits"),
      defaultLookbackHours: z.number().optional().describe("Default lookback period in hours"),
      llmProvider: z.string().optional().describe('LLM provider: "anthropic" or "openai"'),
      llmModel: z.string().optional().describe("LLM model name"),
    },
    async (args) => handlers.update_config(args),
  );

  return server;
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts
```

Expected: ~20+ tests PASS.

**Step 5: Run lint + typecheck**

```bash
turbo lint --filter=@redgest/mcp-server && turbo typecheck --filter=@redgest/mcp-server
```

Fix any type issues. Common issues:
- The `execute` and `query` functions have specific generic signatures. The `as` casts on args may need adjustment.
- The `ctx` passed to `execute` needs to satisfy `ExecuteContext` (which requires `TransactableClient`). The bootstrap `ctx` uses `PrismaClient` as `db` which satisfies this.

**Step 6: Commit**

```bash
git add packages/mcp-server/src/tools.ts packages/mcp-server/src/__tests__/tools.test.ts
git commit -m "feat(mcp-server): register all 15 MCP tools with thin adapter handlers"
```

---

## Task 6: HTTP Entry Point

**Files:**
- Create: `packages/mcp-server/src/http.ts`
- Create: `packages/mcp-server/src/__tests__/http.test.ts`

**Context:** Hono app with `@hono/mcp`'s `StreamableHTTPTransport` for production deployment. Uses bearer auth middleware. Health check on `GET /health`. MCP endpoint on `POST /mcp` (and `GET /mcp`, `DELETE /mcp` for SSE/session management per MCP spec).

**Key import:** `StreamableHTTPTransport` from `@hono/mcp` handles the MCP protocol details. We just mount it on a Hono route and pass the Hono context.

**Step 1: Write the tests**

```typescript
// packages/mcp-server/src/__tests__/http.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock bootstrap to avoid real DB/Reddit connections
vi.mock("../bootstrap.js", () => ({
  bootstrap: vi.fn().mockResolvedValue({
    execute: vi.fn(),
    query: vi.fn(),
    ctx: {
      db: {},
      eventBus: { on: vi.fn(), emitEvent: vi.fn() },
      config: {},
    },
    config: {
      MCP_SERVER_PORT: 3100,
      MCP_SERVER_API_KEY: "a".repeat(32),
    },
    db: { $disconnect: vi.fn() },
  }),
}));

// Mock tools to avoid McpServer creation issues in test
vi.mock("../tools.js", () => ({
  createToolServer: vi.fn().mockReturnValue({
    connect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  }),
}));

import { createApp } from "../http.js";

describe("HTTP server", () => {
  it("GET /health returns 200 without auth", async () => {
    const app = await createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("POST /mcp without auth returns 401", async () => {
    const app = await createApp();
    const res = await app.request("/mcp", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /mcp with valid auth does not return 401", async () => {
    const app = await createApp();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"a".repeat(32)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: {} }),
    });
    // May not be 200 (MCP protocol handling), but should NOT be 401
    expect(res.status).not.toBe(401);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/http.test.ts
```

**Step 3: Implement http.ts**

```typescript
// packages/mcp-server/src/http.ts
import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { bootstrap } from "./bootstrap.js";
import { createToolServer } from "./tools.js";
import { bearerAuthMiddleware } from "./auth.js";

/**
 * Create the Hono app with MCP server mounted.
 * Exported for testing; the `if (import.meta.url ...)` block at the bottom
 * starts the server only when run directly.
 */
export async function createApp() {
  const deps = await bootstrap();
  const mcpServer = createToolServer(deps);
  const transport = new StreamableHTTPTransport();

  const app = new Hono();

  // Health check — no auth
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Auth on MCP routes
  app.use("/mcp", bearerAuthMiddleware(deps.config.MCP_SERVER_API_KEY));

  // MCP endpoint (Streamable HTTP transport handles POST/GET/DELETE)
  app.all("/mcp", async (c) => {
    if (!mcpServer.isConnected()) {
      await mcpServer.connect(transport);
    }
    return transport.handleRequest(c);
  });

  return app;
}

// Start server when run directly
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMainModule) {
  const { serve } = await import("@hono/node-server");
  const app = await createApp();
  const port = Number(process.env.MCP_SERVER_PORT ?? 3100);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Redgest MCP server listening on port ${port}`);
  });
}
```

> **Note:** The exact `@hono/mcp` and `@hono/node-server` APIs may differ slightly. Check the installed versions if you get import errors. The core pattern is: create `StreamableHTTPTransport`, connect McpServer, call `transport.handleRequest(c)` in the route handler.

> **Note:** You may need to install `@hono/node-server` as well: `pnpm --filter @redgest/mcp-server add @hono/node-server`

**Step 4: Run tests to verify they pass**

```bash
pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/http.test.ts
```

Expected: 3 tests PASS. If the MCP transport throws on malformed input, adjust the third test expectation.

**Step 5: Commit**

```bash
git add packages/mcp-server/src/http.ts packages/mcp-server/src/__tests__/http.test.ts
git commit -m "feat(mcp-server): add Hono HTTP entry point with auth and health check"
```

---

## Task 7: Stdio Entry Point

**Files:**
- Create: `packages/mcp-server/src/stdio.ts`

**Context:** The stdio transport is for Claude Desktop / CLI integration. It reads JSON-RPC from stdin, writes to stdout. No auth needed (local process). Uses `StdioServerTransport` from `@modelcontextprotocol/sdk`.

This is a thin entry point — no tests needed beyond build verification, since it's a 15-line glue file.

**Step 1: Implement stdio.ts**

```typescript
// packages/mcp-server/src/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bootstrap } from "./bootstrap.js";
import { createToolServer } from "./tools.js";

async function main() {
  const deps = await bootstrap();
  const server = createToolServer(deps);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await deps.db.$disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await deps.db.$disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start MCP stdio server:", err);
  process.exit(1);
});
```

**Step 2: Verify build**

```bash
turbo build --filter=@redgest/mcp-server && turbo typecheck --filter=@redgest/mcp-server
```

**Step 3: Commit**

```bash
git add packages/mcp-server/src/stdio.ts
git commit -m "feat(mcp-server): add stdio entry point for Claude Desktop"
```

---

## Task 8: Barrel Exports + Dockerfile

**Files:**
- Modify: `packages/mcp-server/src/index.ts`
- Create: `Dockerfile.mcp` (project root)

**Step 1: Update barrel exports**

```typescript
// packages/mcp-server/src/index.ts
export { createToolServer, createToolHandlers } from "./tools.js";
export { createApp } from "./http.js";
export { bootstrap, type BootstrapResult } from "./bootstrap.js";
export { envelope, envelopeError, type ToolResult } from "./envelope.js";
export { bearerAuthMiddleware } from "./auth.js";
```

**Step 2: Create Dockerfile**

```dockerfile
# Dockerfile.mcp
# Multi-stage build for Redgest MCP Server

# ── Stage 1: Build ──
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ packages/
COPY apps/ apps/

RUN pnpm install --frozen-lockfile
RUN pnpm turbo db:generate
RUN pnpm turbo build --filter=@redgest/mcp-server...

# ── Stage 2: Runtime ──
FROM node:20-slim AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/node_modules/ node_modules/

ENV NODE_ENV=production
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:3100/health').then(r => process.exit(r.ok ? 0 : 1))"

CMD ["node", "packages/mcp-server/dist/http.js"]
```

**Step 3: Verify all tests pass**

```bash
turbo test
```

Expected: All existing tests + new mcp-server tests pass (~280+ total).

**Step 4: Commit**

```bash
git add packages/mcp-server/src/index.ts Dockerfile.mcp
git commit -m "feat(mcp-server): add barrel exports and Dockerfile"
```

---

## Summary

| Task | Files | Tests | Deps |
|------|-------|-------|------|
| 1. Install deps | package.json | 0 | none |
| 2. Envelope | envelope.ts | ~5 | none |
| 3. Auth | auth.ts | ~5 | hono |
| 4. Bootstrap | bootstrap.ts | ~6 | core, db, reddit, config |
| 5. Tools (15) | tools.ts | ~20 | envelope, bootstrap |
| 6. HTTP | http.ts | ~3 | auth, tools, hono, @hono/mcp |
| 7. Stdio | stdio.ts | 0 (build verify) | tools, MCP SDK |
| 8. Exports + Docker | index.ts, Dockerfile | 0 | all |
| **Total** | **8 files + Dockerfile** | **~39** | |
