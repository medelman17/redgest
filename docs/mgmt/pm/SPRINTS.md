# Redgest Sprints

## Active Sprint: None

---

## Previous Sprints

### Sprint 7 (Complete)

**Duration**: 2026-03-09 — 2026-03-09
**Capacity**: 5pt
**Sprint Goal**: Validate the Phase 1 MVP end-to-end — E2E test via MCP, integration tests, Docker Compose

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| E2E: manual trigger via MCP → verify digest | Testing | 2.0 | feature | [x] |
| Integration tests: mock LLM, real Postgres | Testing | 2.0 | feature | [x] |
| Docker Compose verification | Testing | 1.0 | feature | [x] |

**Committed**: 5pt | **Completed**: 5pt | **Velocity**: 100%

**Notes**: 6 new tests (2 E2E + 4 integration), 309 total. Environment-driven test doubles (REDGEST_TEST_MODE=1) — no vi.mock() in child process. Injectable LLM function overrides on PipelineDeps. MCP SDK Client + StdioClientTransport for true protocol-level E2E. Docker Compose with postgres health check + mcp-server service.

### Sprint 6 (Complete)

**Duration**: 2026-03-09 — 2026-03-09
**Capacity**: 6pt
**Sprint Goal**: Build the MCP server (WS7) — tools registration, HTTP/stdio transports, auth, and response envelope

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Response envelope {ok, data, error} | WS7 | 0.5 | feature | [x] |
| Bearer auth middleware | WS7 | 0.5 | feature | [x] |
| Bootstrap shared startup | WS7 | 0.5 | feature | [x] |
| tools.ts: Register all 15 tools on McpServer | WS7 | 2.0 | feature | [x] |
| http.ts: Hono + @hono/mcp Streamable HTTP | WS7 | 1.0 | feature | [x] |
| stdio.ts: StdioServerTransport | WS7 | 0.5 | feature | [x] |
| Docker image + barrel exports | WS7 | 0.5 | feature | [x] |

**Committed**: 5.5pt | **Completed**: 5.5pt | **Velocity**: 100%

**Notes**: 65 mcp-server tests (303 total). Three-stage review after each task (spec → quality → simplification). Key quality fixes: timing-safe auth, eager MCP connect (race condition), graceful shutdown on both entry points, error message sanitization, pinned Docker pnpm version.

### Sprint 5 (Complete)

**Duration**: 2026-03-09 — 2026-03-16
**Capacity**: 6pt
**Sprint Goal**: Build the complete digest pipeline (WS6) to unblock WS7 (MCP Server)

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Triage → Summarize → Assemble flow | WS6 | 2.0 | feature | [x] |
| Token budgeting and truncation | WS6 | 1.0 | feature | [x] |
| Deduplication logic | WS6 | 1.0 | feature | [x] |
| Error recovery and partial failure handling | WS6 | 1.0 | feature | [x] |
| ContentSource interface for swappability | WS4 | 0.5 | feature | [x] |

**Committed**: 5.5pt | **Completed**: 5.5pt | **Velocity**: 100%

---

### Sprint 4 (Complete)

**Duration**: 2026-03-09 — 2026-03-16
**Capacity**: 6pt
**Sprint Goal**: Implement command/query handlers and LLM generate functions to fully unblock WS6 (Pipeline)

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Command handlers — GenerateDigest, AddSubreddit, RemoveSubreddit, UpdateSubreddit, UpdateConfig | WS3 | 1.5 | feature | [x] |
| Query handlers — GetDigest, GetPost, GetRunStatus, ListDigests, ListRuns, ListSubreddits, GetConfig, SearchPosts, SearchDigests | WS3 | 1.0 | feature | [x] |
| Provider abstraction — Anthropic + OpenAI registry | WS5 | 0.5 | feature | [x] |
| generateTriageResult() with Output.object() | WS5 | 1.0 | feature | [x] |
| generatePostSummary() with Output.object() | WS5 | 0.5 | feature | [x] |
| Content fetcher — hot/top/rising + comments | WS4 | 1.0 | feature | [x] |

**Committed**: 5.5pt | **Completed**: 5.5pt | **Velocity**: 100%

---

### Sprint 3 (Complete)

**Duration**: 2026-03-09 — 2026-03-16
**Capacity**: 6pt
**Sprint Goal**: Build CQRS infrastructure to unblock the critical path (WS3 → WS6 → WS7 → WS8)

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Domain model classes — Command, Query, Event | WS3 | 1.0 | feature | [x] |
| Command bus implementation | WS3 | 1.0 | feature | [x] |
| Query bus implementation | WS3 | 1.0 | feature | [x] |
| Event bus — in-process EventEmitter | WS3 | 1.0 | feature | [x] |
| Token bucket rate limiter — 60 req/min | WS4 | 0.5 | feature | [x] |
| TD-001: insightNotes Zod/Prisma mismatch | WS5/WS2 | 0.5 | debt | [x] |

**Committed**: 5pt | **Completed**: 5pt | **Velocity**: 100%

---

### Sprint 2 (Complete)

**Duration**: 2026-03-09 — 2026-03-16
**Capacity**: 4.5pt
**Sprint Goal**: Stand up the database layer and unblock parallel work on Reddit integration and LLM structured output

| Task | Stream | Points | Status |
|------|--------|--------|--------|
| Create Prisma v7 schema — 8 tables | WS2 | 2.0 | [x] |
| Write prisma.config.ts | WS2 | 0.5 | [x] |
| Reddit API client — script-type auth | WS4 | 1.0 | [x] |
| Zod schemas — ValidatedTriageResult, ValidatedPostSummary | WS5 | 1.0 | [x] |

**Committed**: 4.5pt | **Completed**: 4.5pt | **Velocity**: 100%

---

### Sprint 1 (Complete)

**Duration**: 2026-03-09 — 2026-03-09
**Capacity**: 4.5pt
**Sprint Goal**: Stand up the monorepo so all downstream work streams can begin

| Task | Stream | Points | Status |
|------|--------|--------|--------|
| TurboRepo + pnpm workspaces | WS1 | 0.5 | [x] |
| package.json for all 10 packages | WS1 | 0.5 | [x] |
| Shared tsconfig/eslint/prettier | WS1 | 0.5 | [x] |
| @redgest/config with Zod schema | WS1 | 1.0 | [x] |
| .env.example | WS1 | 0.5 | [x] |
| Error code registry | WS3 | 0.5 | [x] |
| Prompt templates | WS5 | 1.0 | [x] |

**Committed**: 4.5pt | **Completed**: 4.5pt | **Velocity**: 100%

---

### Sprint 0: Planning & Architecture (Complete)

**Duration**: 2026-03-01 — 2026-03-09
**Goal**: Research, spike reconciliation, project setup

**Delivered**:
- 6 parallel research spikes completed
- Reconciled implementation plan (1515 lines, zero conflicts)
- Data model, LLM pipeline, MCP API, UI architecture designed
- Backlog initialized from reconciled plan
- Project management skill created
