# Redgest Backlog

**Last Updated**: 2026-03-09
**Current Phase**: 1 (Core Pipeline + MCP)
**Active Sprint**: None

---

## Status Summary

| Phase | Work Stream | Total | Done | In Progress | Blocked | Todo | % |
|-------|-------------|-------|------|-------------|---------|------|---|
| 1 | WS1: Monorepo & Config | 5 | 5 | 0 | 0 | 0 | 100% |
| 1 | WS2: Database | 7 | 7 | 0 | 0 | 0 | 100% |
| 1 | WS3: CQRS Core | 8 | 8 | 0 | 0 | 0 | 100% |
| 1 | WS4: Reddit Integration | 4 | 4 | 0 | 0 | 0 | 100% |
| 1 | WS5: LLM Abstraction | 7 | 5 | 0 | 0 | 2 | 71% |
| 1 | WS6: Pipeline Orchestration | 4 | 4 | 0 | 0 | 0 | 100% |
| 1 | WS7: MCP Server | 6 | 6 | 0 | 0 | 0 | 100% |
| 2 | WS8: Trigger.dev (deferred) | 4 | 0 | 0 | 0 | 4 | 0% |
| 1 | Testing & Deployment | 4 | 4 | 0 | 0 | 0 | 100% |
| **Total P1** | | **45** | **43** | **0** | **0** | **2** | **96%** |

---

## Phase 1: Core Pipeline + MCP

### WS1: Monorepo & Config (3pt)
**Deps**: None | **Unblocks**: All other streams

- [x] Initialize TurboRepo with pnpm workspaces (0.5pt)
  Done: 2026-03-09 | Ref: c8c6309

- [x] Create package.json for all 10 packages (0.5pt)
  Done: 2026-03-09 | Ref: 1240779

- [x] Setup @redgest/config with Zod validation schema (1pt)
  Done: 2026-03-09 | Ref: 3befe14
  Note: REDIS_URL (vendor-neutral, optional). resetConfig() for test isolation.

- [x] Create .env.example with all required vars (0.5pt)
  Done: 2026-03-09 | Ref: 3c0c421

- [x] Setup shared tsconfig, eslint, prettier (0.5pt)
  Done: 2026-03-09 | Ref: 593c9a6

---

### WS2: Database / Prisma v7 (5pt)
**Deps**: WS1 | **Unblocks**: WS3

- [x] Create Prisma v7 schema — 8 tables (2pt)
  Done: 2026-03-09 | Ref: e23bb6a

- [x] Write prisma.config.ts (0.5pt)
  Done: 2026-03-09 | Ref: eda2e94

- [x] Setup @prisma/adapter-pg (0.5pt)
  Done: 2026-03-09 | Ref: eda2e94

- [x] Create initial migration (0.5pt)
  Done: 2026-03-09 | Ref: 5e6397f

- [x] Write singleton Prisma client (0.5pt)
  Done: 2026-03-09 | Ref: 12408eb

- [x] Create seed script (0.5pt)
  Done: 2026-03-09 | Ref: fdf033b

- [x] Define 4 SQL views + migration (0.5pt)
  Done: 2026-03-09 | Ref: 14049d1

---

### WS3: CQRS Core (8pt)
**Deps**: WS1, WS2 | **Unblocks**: WS6, WS7

- [x] Domain model classes — Command, Query, Event (1pt)
  Done: 2026-03-09 | Ref: Sprint 3
  Note: Typed interfaces with generics. Command/Query types, DomainEvent with correlation support.

- [x] Command bus implementation (1pt)
  Done: 2026-03-09 | Ref: Sprint 3
  Note: createExecute() — transactional dispatch with event persistence.

- [x] Query bus implementation (1pt)
  Done: 2026-03-09 | Ref: Sprint 3
  Note: createQuery() — typed dispatch to registered handlers.

- [x] Event bus — in-process EventEmitter (1pt)
  Done: 2026-03-09 | Ref: Sprint 3
  Note: DomainEventBus with typed emit/on. Extractable to Postgres NOTIFY or Redis.

- [x] Command handlers — GenerateDigest, AddSubreddit, RemoveSubreddit, UpdateSubreddit, UpdateConfig (1.5pt)
  Done: 2026-03-09 | Ref: Sprint 4 (4848d62)
  Note: One file per handler (ADR-005). 5 handlers + registry. 12 tests.

- [x] Query handlers — GetDigest, GetPost, GetRunStatus, ListDigests, ListRuns, ListSubreddits, GetConfig, SearchPosts, SearchDigests (1pt)
  Done: 2026-03-09 | Ref: Sprint 4 (5a8aed1)
  Note: Views for standard reads, tables for search/config (ADR-006). 9 handlers + registry. 20 tests.

- [x] Event projectors — live SQL views (1pt)
  Done: 2026-03-09 | Ref: ADR-006 (Sprint 4 design)
  Note: Decided on live SQL views (created in WS2 Sprint 2) rather than event-driven projectors. Simpler for Phase 1. Decision documented in docs/plans/2026-03-09-sprint-4-design.md.

- [x] Unified error code registry (0.5pt)
  Done: 2026-03-09 | Ref: 8280c6e

---

### WS4: Reddit Integration (3pt)
**Deps**: WS1 | **Unblocks**: WS6

- [x] Reddit API client — script-type auth (1pt)
  Done: 2026-03-09 | Ref: 9b197f0
  Note: RedditClient with OAuth2, types (RedditPostData/CommentData), 401 retry, 403/429 error handling

- [x] Token bucket rate limiter — 60 req/min (0.5pt)
  Done: 2026-03-09 | Ref: Sprint 3
  Note: TokenBucket with acquire(). 5 tests.

- [x] Content fetcher — hot/top/rising + comments (1pt)
  Done: 2026-03-09 | Ref: Sprint 4 (3ca3cb1)
  Note: fetchSubredditContent() — pure data orchestrator (ADR-008). Deduplicates across sorts. 5 tests.

- [x] ContentSource interface for swappability (0.5pt)
  Done: 2026-03-09 | Ref: Sprint 5
  Note: ContentSource interface in @redgest/core/pipeline/types.ts. RedditContentSource in @redgest/reddit. Structural typing avoids circular deps.

---

### WS5: LLM Abstraction (5pt)
**Deps**: WS1 | **Unblocks**: WS6

- [x] Zod schemas — ValidatedTriageResult, ValidatedPostSummary (1pt)
  Done: 2026-03-09 | Ref: c3b6221, 69b48de
  Note: TriageResultSchema + PostSummarySchema with .describe() for AI SDK Output.object(). CandidatePost + SummarizationInput types.

- [x] Prompt templates — triage + summarization (1pt)
  Done: 2026-03-09 | Ref: 1ce481e

- [x] generateTriageResult() with Output.object() (1pt)
  Done: 2026-03-09 | Ref: Sprint 4
  Note: Uses AI SDK v6 result.output (not result.object). Accepts posts, insightPrompts string[], targetCount. 3 tests.

- [x] generatePostSummary() with Output.object() (0.5pt)
  Done: 2026-03-09 | Ref: Sprint 4
  Note: Uses AI SDK v6 result.output. Accepts post, comments, insightPrompts. 3 tests.

- [x] Provider abstraction — Anthropic + OpenAI registry (0.5pt)
  Done: 2026-03-09 | Ref: Sprint 4 (8258332)
  Note: getModel(taskName, override?) — AI SDK provider registry. Defaults: anthropic/claude-sonnet-4. 4 tests.

- [ ] Redis cache layer (0.5pt)
  Blocked by: None (config complete, REDIS_URL optional)
  Unblocks: generate functions
  Acceptance:
  - Cache key based on content hash
  - TTL: 2h for triage, 7d for summaries
  - Graceful fallback if Redis unavailable
  - Vendor-neutral (any Redis-compatible provider)

- [ ] Middleware logging — tokens, cost, duration (0.5pt)
  Blocked by: None
  Unblocks: observability
  Acceptance:
  - Logs per-call: model, input/output tokens, cost estimate, duration, cache hit/miss
  - Structured logging format
  - Optional storage in llm_calls table (Gap #1)

---

### WS6: Pipeline Orchestration (5pt)
**Deps**: WS3, WS4, WS5 | **Unblocks**: WS7

- [x] Triage → Summarize → Assemble flow (2pt)
  Done: 2026-03-09 | Ref: Sprint 5 (be47550, cf4c04d, fb8d217, 8e27039, e064681)
  Note: Decomposed step functions (ADR-009): fetchStep, triageStep, summarizeStep, assembleStep. Orchestrator composes all. 238 tests passing.

- [x] Token budgeting and truncation (1pt)
  Done: 2026-03-09 | Ref: Sprint 5 (da4433f)
  Note: Character-based estimation (ADR-010). Comments-first truncation (ADR-011). Budgets: 8K triage, 9.7K summarization.

- [x] Deduplication logic (1pt)
  Done: 2026-03-09 | Ref: Sprint 5 (2f66496)
  Note: Digest-based dedup (ADR-012). Queries last 3 digests' digestPosts → posts for redditId matches.

- [x] Error recovery and partial failure handling (1pt)
  Done: 2026-03-09 | Ref: Sprint 5 (be47550, f6a9e66)
  Note: Two-level recovery (ADR-013). Per-subreddit + per-post. Status: COMPLETED/PARTIAL/FAILED. 24 orchestrator tests.

---

### WS7: MCP Server (5pt)
**Deps**: WS3, WS6 | **Unblocks**: WS8, E2E testing

- [x] Response envelope {ok, data, error} (0.5pt)
  Done: 2026-03-09 | Ref: 72f14e7
  Note: envelope() and envelopeError() utilities. 15 tests.

- [x] Bearer auth middleware (0.5pt)
  Done: 2026-03-09 | Ref: 1ab94f8, 7321838
  Note: Timing-safe comparison with crypto.timingSafeEqual. 5 tests.

- [x] Bootstrap shared startup (0.5pt)
  Done: 2026-03-09 | Ref: b7ca9a4
  Note: Prisma, event bus, dispatchers, Reddit client, DigestRequested → runDigestPipeline wiring. 11 tests.

- [x] tools.ts: Register all 15 tools on McpServer (2pt)
  Done: 2026-03-09 | Ref: bccb3d6
  Note: 15 tools (14 CQRS adapters + use_redgest guide). createToolHandlers() + createToolServer(). 31 tests.

- [x] http.ts: Hono + @hono/mcp Streamable HTTP (1pt)
  Done: 2026-03-09 | Ref: 9406adb, 6cc0035, 1dcd345
  Note: StreamableHTTPTransport, eager connect, graceful shutdown. 3 tests.

- [x] stdio.ts: StdioServerTransport (0.5pt)
  Done: 2026-03-09 | Ref: 502f9b1, 6cc0035
  Note: Graceful shutdown with re-entrancy guard, server.close() before db disconnect.

- [x] Docker image for MCP server (0.5pt)
  Done: 2026-03-09 | Ref: dadee87, 1dcd345
  Note: Dockerfile.mcp — multi-stage build, health check, pinned pnpm version.

- [x] Barrel exports (index.ts)
  Done: 2026-03-09 | Ref: dadee87

---

### WS8: Trigger.dev Integration (5pt) — DEFERRED TO PHASE 2
**Deps**: WS7 | **Unblocks**: Production job queue
**Decision**: In-process pipeline execution (bootstrap.ts DigestRequested handler) is sufficient for Phase 1 MVP. Trigger.dev swap-in deferred to Phase 2 for production resilience, retry, and observability.

- [ ] trigger.config.ts with Prisma modern mode (1pt)
- [ ] Task definitions — generate, fetch, triage, summarize (2pt)
- [ ] Event handler: DigestRequested → tasks.trigger() (1pt)
- [ ] Task result handlers — write status to Postgres (1pt)

---

### Testing & Deployment (7pt)

- [x] Unit tests: Zod schemas, prompt building, truncation (2pt)
  Done: 2026-03-09 | Ref: Sprints 2-5
  Note: 238 tests across all packages. Schema validation, prompt templates, token truncation boundary tests all covered.
  Acceptance:
  - Schema validation tests (valid/invalid inputs)
  - Prompt template output tests
  - Token truncation boundary tests

- [x] Integration tests: mock LLM, real Postgres (2pt)
  Done: 2026-03-09 | Ref: Sprint 7 (005194f)
  Note: 4 integration tests — pipeline records, SQL views, dedup, partial failure. FakeContentSource + fake LLM via injectable PipelineDeps overrides.

- [x] E2E: manual trigger via MCP → verify digest (2pt)
  Done: 2026-03-09 | Ref: Sprint 7 (2597bb3)
  Note: MCP SDK Client + StdioClientTransport → child process with REDGEST_TEST_MODE=1. 2 E2E tests — tool listing + full pipeline flow.

- [x] Docker Compose verification (1pt)
  Done: 2026-03-09 | Ref: Sprint 7 (1d39972)
  Note: Postgres health check + mcp-server service with Dockerfile.mcp build. Manual smoke test documented.

---

## Phase 2: Scheduling + Delivery (Deferred)

### WS9: Delivery Channels (3pt)
- [ ] @redgest/email: React Email templates (1pt)
- [ ] Resend integration (0.5pt)
- [ ] @redgest/slack: Block Kit formatter (1pt)
- [ ] Slack webhook client (0.5pt)

### WS10: Web UI / Config (8pt)
- [ ] Next.js 16 app scaffold with ShadCN (1pt)
- [ ] Subreddit Manager page (2pt)
- [ ] Global Settings page (1.5pt)
- [ ] Run History page (2pt)
- [ ] Manual Trigger component (1pt)
- [ ] Dark mode + layout (0.5pt)

### Additional Phase 2
- [ ] Scheduled tasks: digest.schedule cron (1pt)
- [ ] Self-hosted Trigger.dev Docker setup (3pt)
- [ ] Event bus extraction — optional (2pt)

---

## Phase 3+: Search + History (Deferred)

- [ ] Full-text search: tsvector + GIN migration
- [ ] search_posts / search_digests with proper FTS
- [ ] Conversational history (past digests as LLM context)
- [ ] Advanced filtering and trending
- [ ] User authentication (if sharing desired)

---

## Gap-Derived Tasks

| Gap # | Task | Phase | Status |
|-------|------|-------|--------|
| 1 | Add llm_calls logging table + middleware writes | 1 | [ ] |
| 2 | Implement LIKE/prefix search for Phase 1 | 1 | [x] (Sprint 4 — SearchPosts uses `contains` mode) |
| 4 | Add MCP rate limiting middleware | 2 | [ ] |
| 5 | Sanitize Reddit content (prompt injection defense) | 1 | [ ] |
| 6 | Test Prisma v7 modern mode in Trigger.dev container | 1 | [ ] |

---

## Risk-Monitoring Tasks

| Risk # | What to Monitor | When |
|--------|----------------|------|
| 1 | Prompt caching token count after prompt finalization | WS5 |
| 3 | Prisma adapter bundling in Docker | WS8 |
| 7 | Reddit API rate limit headers | WS4 |
| 8 | Per-run token costs after first E2E test | Testing |
