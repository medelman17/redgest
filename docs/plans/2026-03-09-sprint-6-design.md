# Sprint 6 Design: WS7 MCP Server

## Overview

Build the `@redgest/mcp-server` package — a standalone, independently deployable MCP server that exposes 15 tools for digest generation, content access, configuration management, and usage guidance. Integrates with all existing CQRS handlers, pipeline orchestrator, and event bus from Sprints 1-5.

## Key Design Decisions

### 1. Event-Driven Pipeline Execution (Phase 1)

The `generate_digest` tool dispatches the `GenerateDigest` command (creates a Job record, emits `DigestRequested`), then returns `{jobId, status: 'queued'}` immediately. An in-process event handler on the `DomainEventBus` picks up `DigestRequested` and calls `runDigestPipeline()`. The client polls `get_run_status` for progress.

This mirrors the Trigger.dev flow planned for Phase 2 — replacing the event handler with a Trigger.dev task is a one-line swap.

### 2. 15 Tools (14 Handlers + Guide)

All existing command/query handlers get a corresponding MCP tool. Plus `use_redgest` as a static usage guide. `cancel_run` deferred to Phase 2 (requires Trigger.dev).

| # | Tool | Type | Handler |
|---|------|------|---------|
| 1 | `generate_digest` | command | GenerateDigest |
| 2 | `get_run_status` | query | GetRunStatus |
| 3 | `list_runs` | query | ListRuns |
| 4 | `get_digest` | query | GetDigest |
| 5 | `get_post` | query | GetPost |
| 6 | `list_digests` | query | ListDigests |
| 7 | `search_posts` | query | SearchPosts |
| 8 | `search_digests` | query | SearchDigests |
| 9 | `list_subreddits` | query | ListSubreddits |
| 10 | `add_subreddit` | command | AddSubreddit |
| 11 | `remove_subreddit` | command | RemoveSubreddit |
| 12 | `update_subreddit` | command | UpdateSubreddit |
| 13 | `get_config` | query | GetConfig |
| 14 | `update_config` | command | UpdateConfig |
| 15 | `use_redgest` | guide | (static text) |

### 3. Thin Adapter Tools in One File

Each tool is a small function (~15-25 lines) in `tools.ts`: Zod input validation → translate MCP params to handler params → call command/query → wrap in response envelope. Input translation handles mismatches between MCP contracts and handler types.

### 4. Approach A for Response Envelope

Static guide for `use_redgest` (no input params). Simple `{ok, data}` / `{ok: false, error: {code, message}}` envelope for all tools.

## Architecture

### Package Dependencies

```
@redgest/mcp-server
  ├── hono + @hono/mcp          (HTTP framework + MCP transport)
  ├── @modelcontextprotocol/sdk  (MCP protocol types)
  ├── @redgest/core              (commands, queries, events, pipeline)
  ├── @redgest/db                (Prisma client)
  ├── @redgest/reddit            (RedditContentSource)
  └── @redgest/config            (env var loading)
```

### File Structure

```
packages/mcp-server/src/
├── tools.ts          # McpServer instance + all 15 tool registrations
├── envelope.ts       # {ok, data, error} response wrapper
├── auth.ts           # Bearer token middleware (HTTP only)
├── bootstrap.ts      # Shared startup: Prisma, event bus, context, pipeline wiring
├── http.ts           # Hono app + @hono/mcp + auth → production entry point
├── stdio.ts          # StdioServerTransport → Claude Desktop entry point
└── index.ts          # Barrel exports
```

### Data Flow

```
MCP Client → tool call → tools.ts → Zod validate input → translate params
  → command/query handler(params, ctx) → result → envelope({ok, data}) → MCP response
```

For `generate_digest`:
```
generate_digest → GenerateDigest command → creates Job + emits DigestRequested
  → event handler picks up DigestRequested → runDigestPipeline(jobId, ..., deps)
  → pipeline updates Job status as it progresses
  → client polls get_run_status to track progress
```

## Response Envelope

Two helper functions in `envelope.ts`:

```typescript
// Success
envelope(data) → {
  content: [{ type: "text", text: JSON.stringify({ ok: true, data }) }]
}

// Error
envelopeError(code, message) → {
  content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code, message } }) }],
  isError: true
}
```

Error handling per tool:
- `RedgestError` → `envelopeError(err.code, err.message)`
- Unknown errors → `envelopeError("INTERNAL_ERROR", ...)`

## Input Translation

Where MCP tool inputs differ from handler params:

| Tool | MCP Input | Handler Input | Translation |
|------|-----------|---------------|-------------|
| `generate_digest` | `subreddits?: string[]` | `subredditIds?: string[]` | rename field |
| `generate_digest` | `lookback?: string` ("24h") | `lookbackHours?: number` | parse duration |
| `get_digest` | `digestId?: string` (latest if omitted) | `digestId: string` | query ListDigests limit 1 for latest |
| `add_subreddit` | `name, includeNsfw?` | `name, displayName, nsfw?` | rename + derive displayName |
| `remove_subreddit` | `name: string` | `subredditId: string` | lookup subreddit by name |
| `update_subreddit` | `name: string` | `subredditId: string` | lookup subreddit by name |

## Bootstrap

Single async `bootstrap()` function shared by both entry points:

1. Load and validate config via `loadConfig()`
2. Create Prisma client
3. Create `DomainEventBus`
4. Build `HandlerContext` (db, eventBus, config)
5. Create `execute` and `query` dispatchers from handler registries
6. Create `RedditContentSource` from Reddit config
7. Build `PipelineDeps` (db, eventBus, contentSource, config)
8. Wire `DigestRequested` event → `runDigestPipeline()` (Phase 1 in-process)
9. Create McpServer with all tools registered
10. Return `{ server, db, config }`

Graceful shutdown: both entry points handle SIGTERM/SIGINT to disconnect Prisma and close transport.

## HTTP Transport (`http.ts`)

- Hono app with `@hono/mcp` middleware
- `GET /health` → `{ status: "ok" }` (no auth)
- Bearer auth middleware on MCP routes
- `POST /mcp` — Streamable HTTP transport (MCP spec 2025-11-25)
- Listens on `MCP_SERVER_PORT` (default 3100)

## Auth Middleware (`auth.ts`)

- Reads `MCP_SERVER_API_KEY` from config
- Checks `Authorization: Bearer <token>` header
- Returns 401 `{ ok: false, error: { code: "UNAUTHORIZED", message } }` on failure
- Bypassed for health check endpoint
- Not used by stdio transport (local process, trusted)

## Stdio Transport (`stdio.ts`)

- Calls `bootstrap()`
- Creates `StdioServerTransport` from `@modelcontextprotocol/sdk`
- Connects server to transport
- No auth (trusted local process)
- Entry: `node packages/mcp-server/dist/stdio.js`

## Docker

Multi-stage Dockerfile:
- Stage 1: `pnpm install` + `turbo build` (all packages)
- Stage 2: Copy dist + node_modules, run `http.js`
- Expose `MCP_SERVER_PORT`, health check on `/health`

## Testing Strategy

All unit tests in `packages/mcp-server/src/__tests__/`:

- **`envelope.test.ts`** — Correct shapes, JSON serialization, `isError` flag
- **`auth.test.ts`** — Valid token passes, missing/invalid → 401, health bypasses auth
- **`tools.test.ts`** — Per-tool: input translation, envelope wrapping, error handling, edge cases (get_digest latest, remove_subreddit by name lookup, use_redgest returns guide)
- **`bootstrap.test.ts`** — Event wiring: emit DigestRequested → runDigestPipeline called

Estimated: ~40-50 tests. All dependencies mocked (Prisma, event bus, handlers). No integration/E2E tests this sprint.

## MCP Tool Contracts

Tool input/output shapes follow the reconciled implementation plan (docs/synthesis/reconciled-implementation-plan.md lines 535-784) with these additions:

- `list_digests` — wraps ListDigests query, returns `{ digests: DigestView[] }`
- `use_redgest` — no input, returns static markdown usage guide covering tool groups, common workflows, and tips
