# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Redgest is a personal Reddit digest engine. It monitors configured subreddits, uses an LLM pipeline to identify and curate relevant posts based on user-defined "insight prompts," generates summaries, and delivers digests. The system is MCP-first — Claude is the primary consumer via 12 MCP tools.

**Current state:** Architecture & design phase. All implementation plans, data models, and interface contracts are defined in `/docs`. No application code exists yet.

## Architecture

**CQRS without event sourcing.** Commands mutate state and emit domain events to an append-only Postgres event log. Queries read from optimized SQL views. Events trigger async jobs via Trigger.dev but are not used to rebuild state.

**Two-pass LLM pipeline:**
1. **Triage** — Post metadata + insight prompts → ranked selection of top N posts (~8K tokens/sub)
2. **Summarization** — Full post content + top comments → structured summaries (~27.5K tokens/sub)

**Agent-first MCP API:** Tools named as verbs (`generate_digest`, not `digest_generation`). Consistent response envelope: `{ ok, data, error? }`. Composable primitives — `generate_digest` returns a jobId, poll with `get_run_status`, fetch with `get_digest`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | TurboRepo 2.x |
| Language | TypeScript 5.1+ (strict, ESM-only) |
| Runtime | Node.js 20.9+ / Bun-compatible |
| Database | PostgreSQL + Prisma v7 (`@prisma/adapter-pg`, `prisma.config.ts`) |
| Job Queue | Trigger.dev v4 (Cloud Phase 1, self-hosted Phase 2+) |
| MCP Server | Hono + `@hono/mcp` (Streamable HTTP transport) |
| LLM | Vercel AI SDK v6 (`generateText()` + `Output.object()`) |
| Web UI | Next.js 16 + React 19 + ShadCN/ui + Tailwind v4 |
| Testing | Vitest (unit) + Playwright (E2E) |

## Monorepo Structure

```
redgest/
├── packages/
│   ├── core/           # CQRS commands/queries/events, pipeline orchestration
│   ├── db/             # Prisma schema, client, migrations, SQL views
│   ├── mcp-server/     # Hono MCP server (tools.ts, http.ts, stdio.ts)
│   ├── reddit/         # Reddit API client, token bucket rate limiter
│   ├── llm/            # AI SDK wrapper, prompt templates, token budgets
│   ├── email/          # React Email templates + Resend
│   ├── slack/          # Block Kit formatting + webhook
│   └── config/         # Shared TS/ESLint/Prettier configs
├── apps/
│   ├── web/            # Next.js config UI (4 screens)
│   └── worker/         # Trigger.dev task definitions
├── docker-compose.yml
└── turbo.json
```

**Dependency graph:** `mcp-server` → `core` → `db`, `reddit`, `llm`. `email` and `slack` are leaf deps of `core`. No circular dependencies.

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

## Data Model (8 tables, 4 views)

**Core tables:** `subreddits`, `config` (singleton), `jobs` (immutable run records), `events` (append-only log), `posts`, `post_comments`, `post_summaries`, `digests`

**Read model views:** `digest_view`, `post_view`, `run_view`, `subreddit_view`

UUID v7 for all IDs (time-sortable). Summaries linked to both post AND job. Jobs are immutable — re-runs create new records.

## Implementation Phases

1. **Phase 1 (MVP):** Core pipeline + MCP server + manual trigger. Trigger.dev Cloud.
2. **Phase 2:** Self-hosted Trigger.dev, scheduling, email/Slack delivery.
3. **Phase 3:** Next.js config UI.
4. **Phase 4:** Full-text search + conversational history.

## Key Design Decisions

- **Prisma v7** over Drizzle — Rust-free engine, ESM-native. Requires `prisma.config.ts` and `@prisma/adapter-pg` explicitly.
- **Hono for MCP** — Scored 29/30 in spike evaluation. Three-file architecture: `tools.ts` (shared), `http.ts` (production), `stdio.ts` (Claude Desktop dev).
- **Standalone MCP server** — Not embedded in Next.js. Independently deployable Docker container.
- **In-process event bus** (Phase 1) — Extractable to Postgres NOTIFY or Redis pub/sub when services split.
- **Quality-first LLM** — Use frontier models (Claude Sonnet 4, GPT-4.1). Cost negligible at personal scale.

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

Use the `/redgest-scrum-master` skill for backlog management, sprint planning, and task prioritization. Invoke it when asking "what should I work on next," checking project status, starting/reviewing sprints, marking tasks done, or viewing dependencies. It manages two files:

- `docs/mgmt/pm/BACKLOG.md` — Task backlog with status, effort, dependencies, and acceptance criteria
- `docs/mgmt/pm/SPRINTS.md` — Sprint commitments and velocity tracking

If these files don't exist yet, the skill will bootstrap them from the implementation plan.

## Key Documentation

- **PRD:** `docs/prd/redgest-prd-v1.3.md` — Complete product requirements
- **Implementation Plan:** `docs/synthesis/reconciled-implementation-plan.md` — Master synthesized plan from 6 research spikes
- **MCP API Design:** `docs/spikes/outputs/mcp-api-design-revision.md` — Tool contracts and response shapes
- **Data Model:** `docs/spikes/outputs/data-model-implementation.md` — Full schema + views + migration plan
- **Next.js Architecture:** `docs/spikes/outputs/nextjs-16-react-19-architecture.md`
- **Prisma v7 Setup:** `docs/spikes/outputs/prisma-v7-monorepo-architecture.md`
- **LLM Pipeline:** `docs/spikes/outputs/llm-pipeline-revision.md`
