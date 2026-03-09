# Redgest Implementation Phases

Condensed from `docs/synthesis/reconciled-implementation-plan.md` (1515 lines).

---

## Phase 1: Core Pipeline + MCP (Weeks 1–4)

**Goal**: MVP with manual trigger. No scheduling, no email/Slack delivery.

### Week 1
- TurboRepo monorepo scaffolding with all packages
- `@redgest/config`: unified Zod schema for all env vars
- `@redgest/db`: Prisma v7 schema (8 tables, 4 views), migrations, singleton client, seed script
- Docker Compose (Postgres only)
- `@redgest/reddit`: Reddit API client (script-type auth), token bucket rate limiter (60 req/min), content fetcher (hot/top/rising + comments)

### Week 1–2
- `@redgest/core` CQRS infrastructure:
  - Command bus, query bus, event bus (in-process EventEmitter)
  - Domain models (Command, Query, Event classes)
  - Command handlers: GenerateDigestHandler, AddSubredditHandler, UpdateConfigHandler
  - Query handlers: GetDigestHandler, ListSubredditsHandler, GetPostHandler, SearchPostsHandler, GetRunStatusHandler
  - Event projectors: digest_view, post_view, run_view, subreddit_view
  - Unified error code registry

### Week 2
- `@redgest/llm`:
  - Zod schemas for triage (ValidatedTriageResult) and summarization (ValidatedPostSummary)
  - Prompt templates (system + user for each pass)
  - generateTriageResult() with Output.object() (AI SDK 6)
  - generatePostSummary() with Output.object()
  - Provider abstraction (Anthropic Claude Sonnet 4.5 primary, OpenAI GPT-4.1 fallback)
  - Upstash Redis cache layer (TTL: 2h triage, 7d summaries)
  - Middleware logging (tokens, cost, duration, cache hits)

### Week 2–3
- Pipeline orchestration in `@redgest/core`:
  - Triage → Summarize → Assemble flow
  - Token budgeting (~8K triage, ~9.7K summarization)
  - Truncation with inline LLM note if exceeded
  - Deduplication (skip posts from previous digests)
  - Error recovery and partial failure handling

### Week 3
- `@redgest/mcp-server`:
  - tools.ts: Register all 12 tools (3 pipeline, 5 content, 4 config)
  - http.ts: Hono + @hono/mcp with Streamable HTTP transport
  - stdio.ts: StdioServerTransport for Claude Desktop local dev
  - Bearer auth middleware
  - Standard response envelope {ok, data, error}

### Week 3–4
- Trigger.dev integration:
  - apps/worker/trigger.config.ts with Prisma modern mode extension
  - Task definitions: digest.generate, digest.fetch, digest.triage, digest.summarize
  - Event handler: DigestRequested → tasks.trigger("generate-digest", ...)
  - Task result handlers: write completion status back to Postgres

### Week 4
- Testing & deployment:
  - Unit tests: Zod schemas, prompt building, truncation logic
  - Integration tests: mock LLM, real Reddit API
  - E2E: manual trigger via MCP → verify digest in Postgres
  - Docker image for MCP server
  - Local Docker Compose verification

### Phase 1 Deliverables
- Functional MVP: configure subreddits, trigger digest via MCP, retrieve results
- All 12 MCP tools live and working
- Core pipeline with intelligent post selection
- Zero external delivery channels

---

## Phase 2: Scheduling + Delivery + Self-Hosted (Weeks 5–8)

**Goal**: Scheduled runs, email/Slack delivery, optional self-hosted Trigger.dev.

### Week 5
- Scheduled tasks: digest.schedule cron task (e.g., 7 AM daily), per-user custom schedules
- `@redgest/email`: React Email templates + Resend integration
- `@redgest/slack`: Block Kit formatter + webhook client
- Both delivery channels triggered by DigestCompleted event

### Week 6 (optional)
- Event bus extraction: in-process → Postgres LISTEN/NOTIFY or Redis pub/sub
- No domain logic changes; adapter pattern

### Week 6–7
- Self-hosted Trigger.dev: Docker Compose additions (9 containers), configuration, migration playbook

### Week 7–8
- Config UI (`apps/web`, Next.js 16):
  - Subreddit Manager: add/remove/edit with insight prompts
  - Global Settings: insight prompt, lookback, LLM model, delivery, schedule
  - Run History: table of past runs with status/timing/errors
  - Manual Trigger: button with optional parameter overrides
  - Dark mode default, ShadCN components

### Phase 2 Deliverables
- Scheduled digest runs
- Email and Slack delivery working
- Optional self-hosted Trigger.dev
- Web config panel (minimal, functional)

---

## Phase 3+: Search + History + Polish (Weeks 9+)

Deferred. Prioritize based on usage:
- Full-text search (tsvector + GIN)
- Conversational history (past digests as context for Claude)
- Advanced filtering and trending
- User authentication (if sharing desired)

---

## Key Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CQRS variant | Without event sourcing | Solo dev; events for audit/async, not state rebuild |
| ORM | Prisma v7 + @prisma/adapter-pg | TypedSQL, views (preview), modern mode for bundling |
| LLM primary | Claude Sonnet 4.5 | Native constrained output via Output.object() |
| LLM fallback | GPT-4.1 | 1M context, cheaper than GPT-4o |
| MCP framework | Hono + @hono/mcp | Streamable HTTP, lightweight, familiar |
| MCP response format | JSON in content text blocks | structuredContent has client bugs; no LLM benefit |
| Job orchestration | Trigger.dev v4 Cloud | Free tier sufficient (~30 runs/month); self-host Phase 2 |
| LLM cache | Upstash Redis | HTTP-based (no connection pooling issues), generous free tier |
| Config UI | Next.js 16 + ShadCN | Server Components + Server Actions, monorepo-friendly |
| Elicitation | Optional, not required | Claude Desktop doesn't support it |

---

## Gap Register

| # | Gap | Solution | Phase |
|---|-----|----------|-------|
| 1 | Metrics/observability dashboard | Store LLM call logs in llm_calls table (P1); dashboard optional P2 | 1/2 |
| 2 | Full-text search | LIKE/prefix in P1; tsvector + GIN in P4 | 1/4 |
| 3 | Conversation context persistence | Vectorized digest embeddings | 4 |
| 4 | Rate limiting on MCP tools | Middleware rate limit (100 calls/min per key) | 2 |
| 5 | Prompt injection defense | Sanitize XML-like tags from Reddit content | 1 |
| 6 | Trigger.dev Prisma v7 bundling | Test modern mode + adapter before P2 migration | 1 |

---

## Risk Register

| # | Risk | L/I | Mitigation |
|---|------|-----|-----------|
| 1 | Prompt caching <1024 tokens | M/M | Combine system + insight prompts into single block |
| 2 | Trigger.dev self-hosted resources | M/M | Cloud free tier first; restructure to fire-and-forget if needed |
| 3 | Prisma v7 adapter bundling | M/M | Pin versions; test thoroughly before Phase 2 |
| 4 | No elicitation in Claude Desktop | L/L | Document in tool descriptions; rely on client-side approval |
| 5 | Redis connection pooling | L/L | Upstash HTTP (no pooling needed) |
| 6 | structuredContent client bugs | L/L | Committed to JSON-in-text |
| 7 | Reddit API changes | L/M | ContentSource interface for swappability |
| 8 | Token cost overruns | L/M | Middleware logging; per-run budget cap; cheaper model fallback |

---

## Open Questions (Decisions Needed)

1. **Prompt caching**: Combine system + insight prompts into single cached block? → Recommended: Yes
2. **Trigger.dev Cloud vs self-hosted**: Start with Cloud (30K compute sec/month free) → Recommended: Cloud first
3. **OpenAI fallback model**: GPT-4.1 vs GPT-4o → Recommended: GPT-4.1 (test structured output)
4. **Observability**: Store LLM logs in P1? → Recommended: Yes (essential for debugging)
5. **Event bus extraction**: When? → Recommended: Only if processes split
6. **Search in P1**: Empty results or LIKE? → Recommended: LIKE/prefix matching
