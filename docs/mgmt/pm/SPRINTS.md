# Redgest Sprints

## Previous Sprints

### Sprint 11 (Complete)

**Duration**: 2026-03-14 — 2026-03-14
**Capacity**: 13pt (feature: 10pt, debt: 3pt)
**Sprint Goal**: Complete Phase 4 — Search UI, Analytics Dashboard, E2E tests, and worker test debt

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Wire DAL for search operations | WS16 | 1.0 | feature | [x] |
| Search page — full-text search with filters | WS16 | 2.0 | feature | [x] |
| Wire DAL for analytics operations | WS17 | 1.0 | feature | [x] |
| Enhanced subreddits page — crawl status + stats | WS17 | 1.0 | feature | [x] |
| Dashboard page — trending topics, stats, LLM metrics | WS17 | 3.0 | feature | [x] |
| E2E tests for Phase 4 pages | WS18 | 1.0 | feature | [x] |
| TD-005: Worker task unit tests | debt | 2.5 | debt | [x] |

**Committed**: 11.5pt | **Completed**: 11.5pt | **Velocity**: 100%

**Notes**: Phase 4 completion sprint. Search page with full-text search + 4 filters (subreddit, sentiment, time range, min score). Dashboard with 4 stat cards + trending topics, LLM usage table, crawl health, recent runs. Enhanced subreddit table with 3 new columns (Posts, Digests, Next Crawl with tooltip). 36 new worker unit tests (generate-digest 17, deliver-digest 13, scheduled-digest 6). Playwright smoke + interaction tests for Search and Dashboard pages. 5 commits. TD-005 resolved.

---

### Sprint 10 (Complete)

**Duration**: 2026-03-14 — 2026-03-14
**Capacity**: 13pt (feature: 10.5pt, debt: 2.5pt)
**Sprint Goal**: Ship Profiles UI and Digest Browsing — the two highest-impact missing feature areas in the web UI

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Wire DAL for profile operations | WS14 | 1.0 | feature | [x] |
| Profiles page — list, create, edit, delete | WS14 | 3.0 | feature | [x] |
| Update trigger page — profile selection | WS14 | 1.0 | feature | [x] |
| Wire DAL for digest operations | WS15 | 1.0 | feature | [x] |
| Digests page — list, view content, delivery status | WS15 | 3.0 | feature | [x] |
| Enhanced history page — run detail + cancel | WS15 | 1.5 | feature | [x] |
| TD-005: Worker task unit tests | debt | 2.5 | debt | [ ] |

**Committed**: 13pt | **Completed**: 10.5pt | **Velocity**: 81%

**Notes**: Phase 4 kickoff. All 6 feature tasks completed (WS14 + WS15). Profiles CRUD page, digest browsing with expandable content, delivery status badges, cancel button on history page, profile selection on trigger page. Simplify review consolidated 3 duplicated subreddit parsers into shared helpers, fixed Fragment key bug, extracted CancelForm component. 8 commits, 37 Playwright tests. TD-005 (worker unit tests) carried over — not started.

---

### Sprint 9 (Complete)

**Duration**: 2026-03-10 — 2026-03-10
**Capacity**: 10pt
**Sprint Goal**: Ship the complete Redgest config UI — all 4 pages functional with dark theme, closing out Phase 2

**Design Direction**: "Terminal-Luxe" — JetBrains Mono headings + IBM Plex Sans body, slate dark palette (#0F172A bg, #1E293B surface, #22C55E accent), ShadCN Sidebar + DataTable, dark mode default via next-themes.

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Next.js 16 scaffold + ShadCN + Sidebar layout | WS10 | 1.0 | feature | [x] |
| Subreddit Manager page | WS10 | 2.0 | feature | [x] |
| Global Settings page | WS10 | 1.5 | feature | [x] |
| Run History page | WS10 | 2.0 | feature | [x] |
| Manual Trigger component | WS10 | 1.0 | feature | [x] |
| Dark mode + layout polish | WS10 | 0.5 | feature | [x] |
| Test Prisma v7 modern mode in Trigger.dev container | Gap #6 | 1.0 | feature | [x] |
| TD-006: Extract trigger.config.ts project ID to env | debt | 0.5 | debt | [x] |
| TD-007: Add security JSDoc to sanitizeContent() | debt | 0.5 | debt | [x] |

**Committed**: 10pt | **Completed**: 10pt | **Velocity**: 100%

**Notes**: Phase 2 completion sprint. 4 UI pages (Subreddits, Settings, Run History, Manual Trigger) with Terminal-Luxe design system. Dark/light theme toggle via next-themes. Prisma v7 modern mode verified for Trigger.dev deployment (stale Yarn PnP manifest was root cause of initial failures). 2 debt items resolved. 11 commits.

---

## Previous Sprints

### Sprint 8 (Complete)

**Duration**: 2026-03-10 — 2026-03-10
**Capacity**: 12pt
**Sprint Goal**: Launch Phase 2 — Trigger.dev job queue, email/Slack delivery, scheduled digests, observability, and content sanitization

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| trigger.config.ts with Prisma modern mode | WS8 | 1.0 | feature | [x] |
| Task definitions — generate, deliver, scheduled | WS8 | 2.0 | feature | [x] |
| Event handler: DigestRequested → tasks.trigger() | WS8 | 1.0 | feature | [x] |
| Task result handlers — write status to Postgres | WS8 | 1.0 | feature | [x] |
| Scheduled digest cron | WS8 | 1.0 | feature | [x] |
| @redgest/email: React Email templates | WS9 | 1.0 | feature | [x] |
| Resend integration | WS9 | 0.5 | feature | [x] |
| @redgest/slack: Block Kit formatter | WS9 | 1.0 | feature | [x] |
| Slack webhook client | WS9 | 0.5 | feature | [x] |
| llm_calls logging table + middleware writes | Gap | 1.5 | feature | [x] |
| Sanitize Reddit content (prompt injection defense) | Gap | 1.0 | feature | [x] |
| TD-002: Document Postgres port 5433 | infra | 0.5 | debt | [x] |

**Committed**: 12pt | **Completed**: 12pt | **Velocity**: 100%

**Notes**: Phase 2 kickoff. 12 commits, 68 tests (up from 65). Trigger.dev v4 with generate-digest, deliver-digest, scheduled-digest tasks. Conditional dispatch in bootstrap.ts (Trigger.dev if TRIGGER_SECRET_KEY set, in-process fallback). React Email + Resend for email delivery. Slack Block Kit + webhook. llm_calls table with GenerateResult<T> wrapper. sanitizeContent() for prompt injection defense. Fixed Prisma schema drift (3 dropped indexes restored).

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
