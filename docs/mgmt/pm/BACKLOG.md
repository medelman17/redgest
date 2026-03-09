# Redgest Backlog

**Last Updated**: 2026-03-09
**Current Phase**: 1 (Core Pipeline + MCP)
**Active Sprint**: Sprint 2

---

## Status Summary

| Phase | Work Stream | Total | Done | In Progress | Blocked | Todo | % |
|-------|-------------|-------|------|-------------|---------|------|---|
| 1 | WS1: Monorepo & Config | 5 | 5 | 0 | 0 | 0 | 100% |
| 1 | WS2: Database | 7 | 7 | 0 | 0 | 0 | 100% |
| 1 | WS3: CQRS Core | 8 | 1 | 0 | 0 | 7 | 12% |
| 1 | WS4: Reddit Integration | 4 | 1 | 0 | 0 | 3 | 25% |
| 1 | WS5: LLM Abstraction | 7 | 2 | 0 | 0 | 5 | 29% |
| 1 | WS6: Pipeline Orchestration | 4 | 0 | 0 | 4 | 0 | 0% |
| 1 | WS7: MCP Server | 6 | 0 | 0 | 3 | 3 | 0% |
| 1 | WS8: Trigger.dev | 4 | 0 | 0 | 2 | 2 | 0% |
| 1 | Testing & Deployment | 4 | 0 | 0 | 4 | 0 | 0% |
| **Total P1** | | **49** | **16** | **0** | **13** | **20** | **33%** |

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

- [ ] Domain model classes — Command, Query, Event (1pt)
  Blocked by: WS1
  Unblocks: buses, handlers
  Acceptance:
  - Base classes/interfaces for Command, Query, Event
  - Typed with generics for payload
  - Correlation/causation ID support on events

- [ ] Command bus implementation (1pt)
  Blocked by: domain models
  Unblocks: command handlers
  Acceptance:
  - Register handler for command type
  - Dispatch command → handler executes
  - Error propagation

- [ ] Query bus implementation (1pt)
  Blocked by: domain models
  Unblocks: query handlers
  Acceptance:
  - Register handler for query type
  - Dispatch query → handler returns result
  - Error propagation

- [ ] Event bus — in-process EventEmitter (1pt)
  Blocked by: None (WS1 complete)
  Unblocks: projectors, WS8
  Acceptance:
  - emit(event) publishes to all subscribers
  - on(eventType, handler) registers listener
  - Interface designed for future extraction (Postgres LISTEN/NOTIFY or Redis)

- [!] Command handlers — GenerateDigest, AddSubreddit, UpdateConfig (1.5pt)
  Blocked by: command bus (WS2 done)
  Unblocks: WS7 (MCP tools)
  Acceptance:
  - GenerateDigestHandler: creates Job record, emits DigestRequested
  - AddSubredditHandler: validates, creates Subreddit, emits SubredditAdded
  - UpdateConfigHandler: validates, updates Config singleton
  - All use UoW for transactional safety

- [!] Query handlers — GetDigest, ListSubreddits, GetPost, SearchPosts, GetRunStatus (1pt)
  Blocked by: query bus (WS2 done)
  Unblocks: WS7 (MCP tools)
  Acceptance:
  - Each queries appropriate view
  - Returns typed result
  - Pagination support where needed (limit/offset)

- [!] Event projectors — digest_view, post_view, run_view, subreddit_view (1pt)
  Blocked by: event bus (WS2 done)
  Unblocks: query handlers
  Acceptance:
  - Projectors consume events and update materialized views
  - OR: views are live SQL queries (simpler for Phase 1)
  - Documented decision on which approach

- [x] Unified error code registry (0.5pt)
  Done: 2026-03-09 | Ref: 8280c6e

---

### WS4: Reddit Integration (3pt)
**Deps**: WS1 | **Unblocks**: WS6

- [x] Reddit API client — script-type auth (1pt)
  Done: 2026-03-09 | Ref: 9b197f0
  Note: RedditClient with OAuth2, types (RedditPostData/CommentData), 401 retry, 403/429 error handling

- [ ] Token bucket rate limiter — 60 req/min (0.5pt)
  Blocked by: client
  Unblocks: fetcher
  Acceptance:
  - Token bucket algorithm with 60 req/min capacity
  - Blocks/queues requests when exhausted
  - Respects Reddit's X-Ratelimit headers

- [ ] Content fetcher — hot/top/rising + comments (1pt)
  Blocked by: client, rate limiter
  Unblocks: WS6 (pipeline)
  Acceptance:
  - Fetches posts from configured subreddits
  - Supports hot/top/rising sort modes
  - Fetches top N comments per selected post
  - Returns typed Post + PostComment objects

- [ ] ContentSource interface for swappability (0.5pt)
  Blocked by: None
  Unblocks: future content sources
  Acceptance:
  - Interface defining fetchPosts(subreddit, options) and fetchComments(postId)
  - RedditContentSource implements it
  - Documented for future HackerNews, RSS, etc.

---

### WS5: LLM Abstraction (5pt)
**Deps**: WS1 | **Unblocks**: WS6

- [x] Zod schemas — ValidatedTriageResult, ValidatedPostSummary (1pt)
  Done: 2026-03-09 | Ref: c3b6221, 69b48de
  Note: TriageResultSchema + PostSummarySchema with .describe() for AI SDK Output.object(). CandidatePost + SummarizationInput types.

- [x] Prompt templates — triage + summarization (1pt)
  Done: 2026-03-09 | Ref: 1ce481e

- [ ] generateTriageResult() with Output.object() (1pt)
  Blocked by: schemas (prompts done, WS1 config done)
  Unblocks: WS6 pipeline
  Acceptance:
  - Uses AI SDK 6 Output.object() for native structured output
  - Accepts posts array + insight prompt
  - Returns ValidatedTriageResult
  - Handles retries (3 attempts)
  - Logs tokens, cost, duration via middleware

- [ ] generatePostSummary() with Output.object() (0.5pt)
  Blocked by: schemas, prompts
  Unblocks: WS6 pipeline
  Acceptance:
  - Accepts post + comments + insight prompt
  - Returns ValidatedPostSummary
  - Handles retries
  - Cache-aware (check Redis before calling LLM)

- [ ] Provider abstraction — Anthropic + OpenAI registry (0.5pt)
  Blocked by: None
  Unblocks: generate functions
  Acceptance:
  - getModel(provider, model) returns AI SDK model instance
  - Supports anthropic/claude-sonnet-4-5 and openai/gpt-4.1
  - Configured via @redgest/config

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

- [!] Triage → Summarize → Assemble flow (2pt)
  Blocked by: WS3 (CQRS), WS4 (Reddit fetcher), WS5 (LLM functions)
  Unblocks: WS7 (MCP tools)
  Acceptance:
  - Fetches posts from all configured subreddits
  - Runs triage to select top N posts per subreddit
  - Fetches comments for selected posts
  - Runs summarization per post
  - Assembles Digest markdown from summaries
  - Stores all artifacts (Post, PostSummary, Digest, JobPost records)

- [!] Token budgeting and truncation (1pt)
  Blocked by: WS5 (LLM schemas)
  Unblocks: pipeline reliability
  Acceptance:
  - Pre-calculates token allocation (~8K triage, ~9.7K summarization)
  - Truncates post body/comments if exceeding budget
  - Adds inline "[truncated]" note for LLM awareness

- [!] Deduplication logic (1pt)
  Blocked by: WS2 (Job/Post tables)
  Unblocks: digest quality
  Acceptance:
  - Checks Post.redditId against posts from last N digests
  - Skips already-summarized posts
  - Configurable lookback window

- [!] Error recovery and partial failure handling (1pt)
  Blocked by: WS3 (error codes)
  Unblocks: pipeline reliability
  Acceptance:
  - If one subreddit fetch fails, continue with others
  - If one post summarization fails, skip it and note in digest
  - Job status set to "partial" if some steps fail
  - All errors logged with correlation IDs

---

### WS7: MCP Server (5pt)
**Deps**: WS3, WS6 | **Unblocks**: WS8, E2E testing

- [!] tools.ts: Register all 12 tools on McpServer (2pt)
  Blocked by: WS3 (handlers), WS6 (pipeline)
  Unblocks: http/stdio transports
  Acceptance:
  - Pipeline tools: generate_digest, get_run_status, cancel_run
  - Content tools: get_digest, get_post, list_digests, search_posts, search_digests
  - Config tools: list_subreddits, add_subreddit, remove_subreddit, update_config
  - Each tool has Zod input schema and calls appropriate command/query handler

- [!] http.ts: Hono + @hono/mcp Streamable HTTP (1pt)
  Blocked by: tools.ts
  Unblocks: deployment
  Acceptance:
  - Hono app with @hono/mcp middleware
  - Streamable HTTP transport (MCP spec 2025-11-25)
  - CORS configured for web UI

- [ ] stdio.ts: StdioServerTransport (0.5pt)
  Blocked by: tools.ts
  Unblocks: local dev with Claude Desktop
  Acceptance:
  - StdioServerTransport setup
  - Can be launched via `npx` or direct node execution
  - Claude Desktop MCP config example documented

- [ ] Bearer auth middleware (0.5pt)
  Blocked by: None
  Unblocks: security
  Acceptance:
  - Validates MCP_SERVER_API_KEY from Authorization header
  - Returns 401 for invalid/missing keys
  - Bypassed for stdio transport

- [!] Response envelope {ok, data, error} (0.5pt)
  Blocked by: WS3 (error codes)
  Unblocks: all tool responses
  Acceptance:
  - All tool responses wrapped in {ok: boolean, data?: T, error?: {code, message, details?}}
  - JSON serialized in content text block
  - Consistent across all 12 tools

- [ ] Docker image for MCP server (0.5pt)
  Blocked by: http.ts
  Unblocks: deployment
  Acceptance:
  - Dockerfile with multi-stage build
  - Runs Hono HTTP server
  - Accepts env vars for config
  - Health check endpoint

---

### WS8: Trigger.dev Integration (5pt)
**Deps**: WS7 | **Unblocks**: Phase 1 completion

- [ ] trigger.config.ts with Prisma modern mode (1pt)
  Blocked by: None (WS2 done)
  Unblocks: task definitions
  Acceptance:
  - Trigger.dev v4 config
  - Prisma extension with modern mode
  - Environment variables configured

- [!] Task definitions — generate, fetch, triage, summarize (2pt)
  Blocked by: WS6 (pipeline), WS7 (MCP)
  Unblocks: event handler
  Acceptance:
  - digest.generate: orchestrator task
  - digest.fetch: fetches posts from Reddit
  - digest.triage: runs LLM triage
  - digest.summarize: runs LLM summarization per post
  - Idempotency keys on all tasks

- [!] Event handler: DigestRequested → tasks.trigger() (1pt)
  Blocked by: WS3 (event bus)
  Unblocks: async pipeline
  Acceptance:
  - Listens for DigestRequested event
  - Calls tasks.trigger("digest.generate", {jobId, ...})
  - Logs trigger confirmation

- [ ] Task result handlers — write status to Postgres (1pt)
  Blocked by: task definitions, WS2
  Unblocks: job tracking, get_run_status
  Acceptance:
  - On task success: update Job.status = "completed", set completedAt
  - On task failure: update Job.status = "failed", store error
  - Emit DigestCompleted or DigestFailed events

---

### Testing & Deployment (7pt)

- [!] Unit tests: Zod schemas, prompt building, truncation (2pt)
  Blocked by: WS5, WS6
  Acceptance:
  - Schema validation tests (valid/invalid inputs)
  - Prompt template output tests
  - Token truncation boundary tests

- [!] Integration tests: mock LLM, real Reddit API (2pt)
  Blocked by: WS4, WS5, WS6
  Acceptance:
  - Mock AI SDK responses for triage/summarization
  - Live Reddit API test (with rate limiting)
  - Database integration with test Postgres

- [!] E2E: manual trigger via MCP → verify digest (2pt)
  Blocked by: WS7, WS8
  Acceptance:
  - Call generate_digest via MCP client
  - Poll get_run_status until complete
  - Call get_digest and verify content
  - Full pipeline from trigger to storage

- [!] Docker Compose verification (1pt)
  Blocked by: all WS1-8
  Acceptance:
  - `docker compose up` starts Postgres + MCP server + worker
  - Health checks pass
  - MCP tools accessible via HTTP

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
| 2 | Implement LIKE/prefix search for Phase 1 | 1 | [ ] |
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
