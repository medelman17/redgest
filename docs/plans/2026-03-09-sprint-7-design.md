# Sprint 7 Design: Phase 1 MVP Validation

## Overview

Validate the Phase 1 MVP end-to-end: E2E test via MCP stdio protocol, pipeline integration tests against real Postgres, and Docker Compose with MCP server service. All external APIs (Reddit, LLM) are replaced with environment-driven test doubles. WS8 (Trigger.dev) deferred to Phase 2 — in-process pipeline execution is sufficient.

## Key Design Decisions

### 1. All External APIs Mocked

Reddit API and LLM calls are replaced with deterministic test doubles. Real Postgres is used for both E2E and integration tests. This validates the full system wiring (MCP protocol → CQRS → pipeline → DB) without external flakiness, cost, or credential requirements.

### 2. MCP SDK Client via Stdio

The E2E test spawns the MCP server as a child process and uses `@modelcontextprotocol/sdk` Client + `StdioClientTransport` to send real JSON-RPC calls. This tests the actual protocol wire format, transport, and serialization — the most realistic approach.

### 3. Top-Level Test Directory

E2E and integration tests live in `tests/` at the repo root, separate from package unit tests. They have their own vitest config and run via a dedicated `pnpm test:e2e` script. This avoids slowing down `turbo test` and makes the distinction clear.

### 4. Environment-Driven Test Doubles

Bootstrap checks `REDGEST_TEST_MODE=1` and swaps in fake implementations:
- `FakeContentSource` — returns fixture Reddit data
- Fake LLM generate functions — return canned triage results and post summaries

No `vi.mock()` needed in the child process. The server runs real code with the real MCP protocol path, just with controlled data sources.

### 5. Docker Compose — Manual Smoke Test

Add MCP server service to `docker-compose.yml`. Manual verification via curl. No automated Docker test — the E2E test already validates server logic.

## Architecture

### Test Directory Structure

```
tests/
├── e2e/
│   └── mcp-e2e.test.ts         # MCP SDK client → stdio server → full pipeline
├── integration/
│   └── pipeline.test.ts         # runDigestPipeline() → real Postgres
├── fixtures/
│   ├── fake-content-source.ts   # ContentSource implementation with fixture data
│   ├── fake-llm.ts              # Replacement generate functions
│   └── reddit-data.ts           # Static post/comment fixtures
├── helpers/
│   └── db.ts                    # Test DB setup/teardown (truncate tables)
└── vitest.config.ts             # Separate vitest config for E2E/integration
```

### E2E Test Flow

```
Test process                          Child process (MCP server)
─────────────                         ──────────────────────────
StdioClientTransport ──stdin──►       StdioServerTransport
                                      bootstrap(REDGEST_TEST_MODE=1)
                                        → FakeContentSource
                                        → Fake LLM functions
                                        → Real PrismaClient (test DB)
                                        → DomainEventBus
                                        → DigestRequested → runDigestPipeline

client.callTool("add_subreddit")  →   AddSubreddit command → DB write
client.callTool("generate_digest") →  GenerateDigest → event → pipeline
client.callTool("get_run_status")  →  GetRunStatus query → DB read
client.callTool("get_digest")     →   GetDigest query → DB read
```

### Test Doubles

**FakeContentSource** — Implements `ContentSource` interface. Returns 3 fixture posts with 2 comments each for any subreddit. Posts have deterministic redditIds, titles, and content.

**Fake LLM functions** — Replace `generateTriageResult()` and `generatePostSummary()`:
- Triage: returns all input posts as selected (no filtering)
- Summary: returns a deterministic summary with title, keyPoints, and relevanceScore based on input post ID

Both are shared between E2E and integration tests.

### Bootstrap Test Mode

Small change to `packages/mcp-server/src/bootstrap.ts`:

```typescript
if (process.env.REDGEST_TEST_MODE === "1") {
  // Use fake content source and LLM
  contentSource = new FakeContentSource();
  // Override generate functions in pipeline deps
} else {
  // Real Reddit client + LLM (existing code)
}
```

The exact wiring depends on how `PipelineDeps` consumes the content source and LLM functions. The fake implementations live in `tests/fixtures/` and are imported dynamically.

### Integration Test Cases

1. **Pipeline writes correct DB records** — Run pipeline for one subreddit. Verify Job status "completed", Posts written, PostSummaries linked, Digest created with markdown.

2. **SQL views return correct shapes** — After pipeline run, query digest_view, post_view, run_view, subreddit_view. Verify expected fields.

3. **Deduplication across runs** — Run pipeline twice for same subreddit. Second run skips posts from first digest.

4. **Partial failure handling** — Two subreddits, one fails. Verify Job status "partial", successful subreddit in digest.

### Docker Compose

Add to existing `docker-compose.yml`:

```yaml
mcp-server:
  build:
    context: .
    dockerfile: Dockerfile.mcp
  depends_on:
    postgres:
      condition: service_healthy
  ports:
    - "3100:3100"
  environment:
    DATABASE_URL: postgresql://redgest:redgest@postgres:5432/redgest
    MCP_SERVER_API_KEY: ${MCP_SERVER_API_KEY}
    MCP_SERVER_PORT: 3100
    ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    REDDIT_CLIENT_ID: ${REDDIT_CLIENT_ID}
    REDDIT_CLIENT_SECRET: ${REDDIT_CLIENT_SECRET}
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://localhost:3100/health').then(r => process.exit(r.ok ? 0 : 1))"]
    interval: 30s
    timeout: 3s
    start_period: 5s
```

**Manual smoke test:**
1. `docker compose up -d`
2. `curl http://localhost:3100/health` → `{"status":"ok"}`
3. `curl -X POST http://localhost:3100/mcp -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'` → 15 tools
4. `docker compose down`

### Test Database Strategy

- Use the existing docker-compose Postgres instance
- E2E and integration tests use `DATABASE_URL` pointing to a test database (e.g., `redgest_test`)
- `tests/helpers/db.ts` provides:
  - `setupTestDb()` — run Prisma migrations against test DB
  - `truncateAll()` — truncate all tables between test files
  - `teardownTestDb()` — disconnect Prisma

## Testing Summary

| Test Type | Location | Invokes | DB | Reddit | LLM |
|-----------|----------|---------|-----|--------|-----|
| Unit (existing) | `packages/*/src/__tests__/` | Handlers directly | Mock | Mock | Mock |
| Integration (new) | `tests/integration/` | `runDigestPipeline()` | Real Postgres | Fake fixture | Fake canned |
| E2E (new) | `tests/e2e/` | MCP SDK Client → stdio | Real Postgres | Fake fixture | Fake canned |

## Deliverables

1. Test fixtures and helpers (`tests/fixtures/`, `tests/helpers/`)
2. Bootstrap test mode (`REDGEST_TEST_MODE=1` support)
3. Integration tests (`tests/integration/pipeline.test.ts`)
4. E2E test (`tests/e2e/mcp-e2e.test.ts`)
5. Docker Compose update (`docker-compose.yml` + manual smoke test docs)
