# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Redgest is a personal Reddit digest engine. It monitors configured subreddits, uses an LLM pipeline to identify and curate relevant posts based on user-defined "insight prompts," generates summaries, and delivers digests. The system is MCP-first — Claude is the primary consumer via 32 MCP tools.

**Current state:** Phase 1–4 complete. Core pipeline, CQRS, MCP server, Trigger.dev integration, email/Slack delivery with LLM-generated editorial prose, Next.js config UI, full-text + vector search, digest profiles, and decoupled crawling are all implemented (627 tests across 60 files, 218 commits). Fully operational for local deployment.

## Architecture

**CQRS without event sourcing.** Commands mutate state and emit domain events to an append-only Postgres event log. Queries read from optimized SQL views. Events trigger async jobs via Trigger.dev but are not used to rebuild state.

**Three-pass LLM pipeline:**
1. **Triage** — Global cross-subreddit triage: post metadata + insight prompts → ranked selection of top N posts across all subreddits (~8K tokens total)
2. **Summarization** — Full post content + top comments → structured summaries (~27.5K tokens/sub)
3. **Delivery Prose** — Per-channel (email/Slack) editorial prose generation from digest summaries → headline + per-subreddit narrative

**Agent-first MCP API:** Tools named as verbs (`generate_digest`, not `digest_generation`). Consistent response envelope: `{ ok, data, error? }`. Composable primitives — `generate_digest` returns a jobId, poll with `get_run_status`, fetch with `get_digest`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | TurboRepo 2.x |
| Language | TypeScript 5.1+ (strict, ESM-only) |
| Runtime | Node.js 20.9+ / Bun-compatible |
| Database | PostgreSQL + Prisma v7 (`@prisma/adapter-pg`, `prisma.config.ts`) |
| Job Queue | Trigger.dev v4 Cloud (conditional dispatch — in-process fallback when `TRIGGER_SECRET_KEY` unset) |
| MCP Server | Hono + `@hono/mcp` (Streamable HTTP transport) |
| LLM | Vercel AI SDK v6 (`generateText()` + `Output.object()`) |
| Web UI | Next.js 16 + React 19 + ShadCN/ui + Tailwind v4 |
| Email | React Email + Resend (`@redgest/email`) |
| Slack | Block Kit + webhook (`@redgest/slack`) |
| Testing | Vitest (unit) + Playwright (E2E) |

## Monorepo Structure

```
redgest/
├── packages/
│   ├── core/           # CQRS commands/queries/events, pipeline orchestration
│   ├── db/             # Prisma schema, client, migrations, SQL views
│   ├── mcp-server/     # Hono MCP server (tools.ts, http.ts, stdio.ts, bootstrap.ts)
│   ├── reddit/         # Reddit API client, token bucket rate limiter, content sanitization
│   ├── llm/            # AI SDK wrapper, prompt templates, token budgets, middleware logging
│   ├── email/          # React Email digest template + Resend integration
│   ├── slack/          # Block Kit digest formatter + webhook delivery
│   └── config/         # Zod-validated env config (shared across all packages)
├── apps/
│   ├── web/            # Next.js config UI
│   └── worker/         # Trigger.dev tasks (generate-digest, deliver-digest, scheduled-digest)
├── tests/
│   └── fixtures/       # FakeContentSource, fake LLM for E2E/integration tests
├── docker-compose.yml  # Postgres (port 5433) + Redis + mcp-server
└── turbo.json
```

**Dependency graph:** `mcp-server` → `core` → `db`, `reddit`, `llm`. `worker` → `core`, `reddit`, `llm`, `email`, `slack`. `email` and `slack` are leaf deps. No circular dependencies.

## Build & Dev Commands

```bash
# Install dependencies
pnpm install

# Generate Prisma client (must run before build/dev)
turbo db:generate

# Development (all packages with watch)
turbo dev

# Build all packages
turbo build

# Run all tests
turbo test

# Run a single package's tests
turbo test --filter=@redgest/core

# Run a specific test file
pnpm --filter @redgest/core exec vitest run src/path/to/test.test.ts

# Database migrations
pnpm --filter @redgest/db exec prisma migrate dev
pnpm --filter @redgest/db exec prisma migrate deploy

# Seed database
pnpm --filter @redgest/db exec tsx prisma/seed.ts

# Lint
turbo lint

# E2E tests (Playwright)
pnpm --filter apps/web exec playwright test
```

## Data Model (15 tables, 6 views)

**Core tables:** `subreddits` (with crawl interval/scheduling), `digest_profiles` (named digest configurations), `digest_profile_subreddits` (profile↔subreddit join), `config` (singleton), `jobs` (immutable run records), `events` (append-only log), `posts` (with tsvector FTS + pgvector embeddings), `post_comments`, `post_summaries`, `digests`, `digest_posts` (join table with rank), `llm_calls` (per-call LLM usage logging), `deliveries` (email/Slack delivery tracking), `topics` (extracted trending topics), `post_topics` (post↔topic join)

**Read model views:** `digest_view`, `post_view`, `run_view`, `subreddit_view`, `profile_view`, `delivery_view`

UUID v7 for all IDs (time-sortable). Summaries linked to both post AND job. Jobs are immutable — re-runs create new records. `llm_calls` tracks model, tokens, duration, cost for observability.

## Implementation Phases

1. **Phase 1 (MVP):** Core pipeline + MCP server + manual trigger. Trigger.dev Cloud. **COMPLETE.**
2. **Phase 2:** Scheduling, email/Slack delivery, config UI. **COMPLETE.**
3. **Phase 3:** Full-text + vector search, conversational history, trending topics, delivery tracking, digest comparison, fetch caching. **COMPLETE.**
4. **Phase 4:** Digest profiles, decoupled crawling, global cross-subreddit triage, LLM delivery prose. **COMPLETE.**
5. **Phase 5 (optional):** Self-hosted Trigger.dev, event bus extraction, MCP rate limiting.

## Key Design Decisions

- **Prisma v7** over Drizzle — Rust-free engine, ESM-native. Requires `prisma.config.ts` and `@prisma/adapter-pg` explicitly.
- **Hono for MCP** — Scored 29/30 in spike evaluation. Four-file architecture: `tools.ts` (shared), `http.ts` (production), `stdio.ts` (Claude Desktop dev), `bootstrap.ts` (shared startup + event wiring).
- **Standalone MCP server** — Not embedded in Next.js. Independently deployable Docker container.
- **Conditional Trigger.dev dispatch** — `bootstrap.ts` checks `TRIGGER_SECRET_KEY`: if set, dispatches via `tasks.trigger()` (dynamic import to avoid loading SDK otherwise); if unset, runs pipeline in-process. Fallback on dispatch failure.
- **In-process event bus** — `DomainEventBus` (typed EventEmitter). Extractable to Postgres NOTIFY or Redis pub/sub when services split.
- **Quality-first LLM** — Use frontier models (Claude Sonnet 4, GPT-4.1). Cost negligible at personal scale.
- **GenerateResult\<T\> pattern** — LLM generate functions return `{ data: T; log: LlmCallLog | null }` to surface call metadata for persistence to `llm_calls` table.
- **Content sanitization** — `sanitizeContent()` in `@redgest/reddit` strips XML-like tags, markdown injection, and prompt override patterns from Reddit content before LLM processing.

## Search & Analytics

- **Full-text search** — `tsvector` columns on posts and digests, queried via raw SQL. Exposed as `search_posts` and `search_digests` MCP tools.
- **Vector similarity** — `pgvector` embeddings on post summaries. `find_similar` tool uses cosine distance.
- **Hybrid ranking** — Reciprocal Rank Fusion (RRF) combines text and vector results for `ask_history`.
- **Topic extraction** — Topics extracted from summaries, stored in `topics`/`post_topics`. `get_trending_topics` and `compare_periods` tools.
- **Fetch caching** — Reddit content cached in DB; `force_refresh` flag bypasses cache.

## CQRS Patterns

- **`createExecute()`** — Transactional command dispatch. Wraps handler in `$transaction`, auto-persists events, emits AFTER commit.
- **`createQuery()`** — Pure query dispatch. No transaction, no events.
- **`HandlerContext = { db, eventBus, config }`** — DI for all handlers.
- **Three type maps:** `CommandMap`, `QueryMap`, `DomainEventMap` — all derived unions come from these.
- **One file per handler** in `commands/handlers/` and `queries/handlers/`.
- **Pipeline steps:** `fetchStep` → `triageStep` → `summarizeStep` → `assembleStep` — composed by orchestrator via `runDigestPipeline()`.
- **`PipelineDeps`** — Injectable dependencies for pipeline: `{ db, eventBus, contentSource, config, generateTriage?, generateSummary? }`. Optional LLM overrides enable test doubles.

## Digest Profiles

Profiles group subreddits with their own schedule, lookback, maxPosts, and delivery settings. The Default profile is auto-created from global config during migration.

- **CQRS:** `CreateProfile`, `UpdateProfile`, `DeleteProfile` commands + `ListProfiles`, `GetProfile` queries
- **MCP tools:** `list_profiles`, `get_profile`, `create_profile`, `update_profile`, `delete_profile`
- **Pipeline integration:** `generate_digest` accepts optional `profile` param; profile's subreddits/settings override defaults

## Trigger.dev Task Architecture

Three tasks in `apps/worker/src/trigger/`:

- **`generate-digest`** — Wraps `runDigestPipeline()`. On completion, triggers `deliver-digest` with idempotency key. Retry: 2 attempts.
- **`deliver-digest`** — Loads digest with relations, builds `DigestDeliveryData`, generates per-channel LLM editorial prose via `generateDeliveryProse()`, merges with `buildFormattedDigest()`, dispatches to configured email/Slack channels via `Promise.allSettled`. Retry: 3 attempts.
- **`scheduled-digest`** — Cron task (`DIGEST_CRON` env, default `0 7 * * *`). Finds active subreddits, creates Job record, triggers `generate-digest`.

**Dispatch flow:** MCP `generate_digest` tool → `GenerateDigestHandler` → `DigestRequested` event → `bootstrap.ts` event handler → `tasks.trigger("generate-digest")` or in-process fallback.

## Delivery Channels

Each channel receives LLM-generated editorial prose tailored to its format (email gets detailed multi-paragraph narratives, Slack gets concise summaries). Prose is generated per-channel via `generateDeliveryProse()` from `@redgest/llm`, then merged with structured data via `buildFormattedDigest()`.

- **Email:** `@redgest/email` — `DigestEmail` React Email component + `sendDigestEmail()` via Resend. Requires `RESEND_API_KEY` + `DELIVERY_EMAIL`.
- **Slack:** `@redgest/slack` — `formatDigestBlocks()` Block Kit formatter + `sendDigestSlack()` via webhook. Requires `SLACK_WEBHOOK_URL`.
- **Shared types:** `DigestDeliveryData` (raw structured data), `FormattedDigest` (data + prose). Both defined in `@redgest/email`, reused by `@redgest/slack`.

## Crawl System

Subreddits have independent crawl intervals (`crawl_interval_minutes`, default 30) and `next_crawl_at` scheduling. The crawl pipeline (`runCrawl()` in `@redgest/core`) is separate from the digest pipeline — crawl populates posts, digest pipeline reads them.

- **`get_crawl_status`** MCP tool — per-subreddit crawl health, last/next crawl times, post counts
- **`score_delta`** on posts — tracks score changes between crawls for trend detection
- **Batch optimized** — bulk `findMany` for existing scores before upsert loop (not N+1)

## TypeScript Standards

**Strict compiler flags** (`tsconfig.base.json`): `strict: true`, `noUncheckedIndexedAccess: true`. All packages inherit these.

**Banned patterns:**
- **No non-null assertions (`!`)** — Use proper null narrowing: `const x = arr[0]; if (!x) return;`
- **No `as unknown as` double-casts** — Find the correct type or restructure the code
- **No `@ts-ignore` or `@ts-expect-error`** — Fix the actual type issue
- **No TypeScript `enum`** — Use const objects: `export const Status = { ACTIVE: "active" } as const; export type Status = (typeof Status)[keyof typeof Status];`
- **No `any`** — Enforced by `@typescript-eslint/no-explicit-any: "error"`

**Allowed:** Single `as` casts at system boundaries (external API responses, `globalThis` singleton pattern). These must be the narrowest possible type.

**Pre-commit hook** runs `pnpm lint && pnpm typecheck && pnpm test`. All three must pass. NEVER use `--no-verify`.

**Quality commands:**
```bash
pnpm check        # lint + typecheck + test (all packages)
pnpm typecheck    # tsc --noEmit across all packages via turbo
```

## Important Gotchas

- `turbo db:generate` must run before `build` or `dev` (Prisma client generation)
- `transpilePackages: ['@redgest/core', '@redgest/db', ...]` required in `next.config.ts` for Turbopack monorepo
- Never use `NEXT_PUBLIC_*` for environment-specific config in Docker — read from `process.env` server-side
- Server Actions are public endpoints — always validate inputs with Zod
- Async Server Components cannot be unit tested — use Playwright E2E
- Prisma `Decimal`/`BigInt`/`Date` fields aren't JSON-serializable — use `select` in DAL to return only serializable fields
- `useActionState` (from `react`) replaces the old `useFormState` (from `react-dom`)
- Reddit API rate limit: 60 req/min, enforced via token bucket in `@redgest/reddit`
- **Docker Compose Postgres runs on port 5433** (not 5432) — local port conflict avoidance
- **Prisma schema drift drops raw-SQL indexes** — Prisma detects manually-created indexes (BRIN, partial, multi-column) as drift and generates DROP statements in migrations. Always check `prisma migrate diff` output and restore dropped indexes in a follow-up migration if needed.
- **`CREATE OR REPLACE VIEW` cannot reorder columns** — Postgres requires `DROP VIEW` + `CREATE VIEW` when inserting columns into an existing view's column order. Migrations that change view column order must drop first.
- **Worker needs `"jsx": "react-jsx"`** in tsconfig.json — transitive imports from `@redgest/email` include `.tsx` files (React Email templates)
- **Trigger.dev task cross-package triggering** — Use string-based `tasks.trigger("generate-digest", payload)` with `import type` for type safety. Don't directly import task objects from `apps/worker` into `packages/mcp-server`.
- **Dynamic SDK import** — `bootstrap.ts` uses `await import("@trigger.dev/sdk/v3")` to avoid loading Trigger.dev SDK when `TRIGGER_SECRET_KEY` is not configured.
- **AI SDK v6** — `generateText()` + `Output.object()` returns `result.output` (NOT `result.object`). This is a common gotcha.
- **Test mode** — `REDGEST_TEST_MODE=1` enables `FakeContentSource` and fake LLM functions via dynamic imports from `tests/fixtures/`. Used for E2E and integration tests.

## Development Workflow (Superpowers Skills)

Always invoke the relevant superpowers skill **before** taking action. The workflow for any task follows this chain:

1. **`/redgest-scrum-master`** — Pick the next task, check status, manage sprints
2. **`superpowers:brainstorming`** — Before any creative work (new features, components, modifications). Explores intent and design before code.
3. **`superpowers:writing-plans`** — Before multi-step tasks. Produces an implementation plan from specs/requirements.
4. **`superpowers:test-driven-development`** — Before writing implementation code. Red-green-refactor.
5. **`superpowers:subagent-driven-development`** — When executing plans with independent tasks in the current session.
6. **`superpowers:systematic-debugging`** — Before proposing fixes for any bug, test failure, or unexpected behavior.
7. **`superpowers:requesting-code-review`** — After completing a feature or before merging.
8. **`superpowers:verification-before-completion`** — Before claiming work is done. Run verification commands and confirm output.
9. **`superpowers:finishing-a-development-branch`** — When implementation is complete and tests pass; guides merge/integration.

**The rule:** If there's even a 1% chance a skill applies, invoke it first. Skills determine HOW to approach work — user instructions determine WHAT to build. Process skills (brainstorming, debugging) before implementation skills (react-dev, mcp-builder).

## Project Management

Use the `/redgest-scrum-master` skill for backlog management, sprint planning, task prioritization, and tech debt tracking. Invoke it when asking "what should I work on next," checking project status, starting/reviewing sprints, marking tasks done, viewing dependencies, or logging tech debt. It manages three files:

- `docs/mgmt/pm/BACKLOG.md` — Task backlog with status, effort, dependencies, and acceptance criteria
- `docs/mgmt/pm/SPRINTS.md` — Sprint commitments and velocity tracking
- `docs/mgmt/pm/TECH_DEBT.md` — Tech debt register with severity, affected areas, and resolution criteria

If these files don't exist yet, the skill will bootstrap them from the implementation plan.

## Key Documentation

- **PRD:** `docs/prd/redgest-prd-v1.3.md` — Complete product requirements
- **Implementation Plan:** `docs/synthesis/reconciled-implementation-plan.md` — Master synthesized plan from 6 research spikes
- **MCP API Design:** `docs/spikes/outputs/mcp-api-design-revision.md` — Tool contracts and response shapes
- **Data Model:** `docs/spikes/outputs/data-model-implementation.md` — Full schema + views + migration plan
- **Next.js Architecture:** `docs/spikes/outputs/nextjs-16-react-19-architecture.md`
- **Prisma v7 Setup:** `docs/spikes/outputs/prisma-v7-monorepo-architecture.md`
- **LLM Pipeline:** `docs/spikes/outputs/llm-pipeline-revision.md`

<!-- Full Trigger.dev SDK reference lives in apps/worker/CLAUDE.md.
     Also available via Trigger.dev MCP server (configured in .mcp.json). -->