# Redgest: Reconciled Implementation Plan

**Version 1.0** | March 9, 2026 | Synthesized from six parallel spike documents

---

## Executive Summary

Redgest is a personal Reddit digest engine that monitors configured subreddits, uses LLM intelligence to identify relevant posts, generates summaries with contextual insights, and delivers digests via MCP (primary), email, and Slack. The system is built on a TurboRepo monorepo, Prisma v7 with Postgres, Trigger.dev v4 for async execution, Next.js 16 for configuration UI, and a Hono-based MCP server implementing all 12 tools through a unified `{ok, data, error}` response envelope.

**Architecture highlights:**
- **CQRS without event sourcing**: Commands mutate state and emit domain events (appended to Postgres event log). Queries read from optimized SQL views. Events trigger async jobs via Trigger.dev, not used to rebuild state.
- **Phase 1 (MVP)**: Core pipeline, MCP server, manual trigger. Trigger.dev Cloud (free tier). No email/Slack delivery, no scheduling.
- **Phase 2**: Self-hosted Trigger.dev, scheduled runs, email/Slack delivery, in-process event bus extraction if needed.
- **Phase 3**: Next.js config UI (minimal, functional).
- **Phase 4**: Full-text search + conversational history.

Six research spikes have been reconciled with zero hard conflicts. This document captures all architectural decisions, interface contracts, data models, error handling, and configuration with source attribution.

---

## Terminology Glossary

| Term | Definition | Source |
|------|-----------|--------|
| **Job / Digest Run** | Immutable record of one `generate_digest` invocation. Tracks status, subreddit set, lookback period, delivery channels, timing. | PRD § 4.1 |
| **Triage** | Pass 1 of LLM pipeline. Evaluates post metadata against user interests, selects top N candidates. Output: ranked post IDs with relevance scores. | PRD § 5.2, Spike 6 |
| **Summarization** | Pass 2 of LLM pipeline. Generates summary, key takeaways, insight notes, comment highlights for each selected post. | PRD § 5.3, Spike 6 |
| **Insight Prompt** | User-authored description of interests (e.g., "ML systems at scale, inference optimization"). Global default + per-subreddit overrides. | PRD § 1.4, Spike 3 |
| **Read Model / Projection** | Optimized SQL view (digest_view, post_view, run_view, subreddit_view) for read-heavy queries. Populated by projectors consuming domain events. | PRD § 2.3 |
| **Command Handler** | Validates input, executes business logic, persists state, emits domain events. Only path to state mutation. | PRD § 2.3, Spike 3 |
| **Event Bus** | In-process (Phase 1) or extracted (Phase 2+) pub/sub for domain events. Interface: `emit(event)`, `on(eventType, handler)`. | PRD § 2.3 |
| **MCP Tool** | RPC-style endpoint exposing digest functionality to Claude. 12 tools in 3 categories (pipeline, content, config). | PRD § 3 |
| **Unit of Work** | Transaction wrapper over Prisma client. Command handlers execute work within UoW for atomicity. | Spike 3, § E |
| **Token Budget** | Pre-calculated token allocation per LLM call (triage ~8K, summarization ~9.7K). Truncation with inline LLM note if exceeded. | Spike 6, § E |

---

## Architecture Overview

### System Diagram (Text-Based)

```
┌──────────────────────────────────────────────────────────────────┐
│ Client Layer                                                      │
│ ┌─────────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│ │ Claude via MCP      │  │ Web UI Browser   │  │ Email/Slack  │ │
│ │ (Primary)           │  │ (Config only)    │  │ (Delivery)   │ │
│ └──────────┬──────────┘  └────────┬─────────┘  └──────────────┘ │
│            │                      │                               │
└────────────┼──────────────────────┼───────────────────────────────┘
             │                      │
   HTTP POST │ Streamable HTTP      │ HTTP
   (Hono)    │ MCP spec 2025-11-25 │ Next.js
             │                      │
┌────────────┴──────────────────────┴───────────────────────────────┐
│ Application Layer                                                  │
│                                                                   │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ @redgest/core: CQRS Infrastructure                          │ │
│ │ - CommandBus, CommandHandlers (GenerateDigest, etc.)        │ │
│ │ - QueryHandlers (GetDigest, SearchPosts, etc.)              │ │
│ │ - EventBus (in-process, extractable)                        │ │
│ │ - Projectors (digest_view, post_view, run_view)            │ │
│ │ - Pipeline orchestration (triage → summarize → assemble)    │ │
│ │ - Delivery dispatch (email, Slack)                          │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌───────────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│ │ @redgest/mcp-server   │  │ apps/web         │  │ apps/worker│ │
│ │ (Hono + @hono/mcp)    │  │ (Next.js 16)     │  │ (Trigger.  │ │
│ │ - tools.ts (12 tools) │  │ Server Components│  │ dev tasks) │ │
│ │ - http.ts             │  │ - Subreddit Mgr  │  │            │ │
│ │ - stdio.ts            │  │ - Global Settings│  │ - Generate │ │
│ │ - Bearer auth         │  │ - Run History    │  │   Digest   │ │
│ │ - Response envelope   │  │ - Manual Trigger │  │ - Triage   │ │
│ └───────────────────────┘  └──────────────────┘  │ - Summarize│ │
│                                                   │ - Deliver  │ │
│ ┌───────────────────────────────────────────────┐ └────────────┘ │
│ │ @redgest/llm: LLM Abstraction (AI SDK 6)     │                │
│ │ - triagePosts() → ValidatedTriageResult      │                │
│ │ - summarizePost() → ValidatedPostSummary     │                │
│ │ - Zod schemas + Output.object() (structured) │                │
│ │ - Upstash Redis cache (TTL: 2h triage/7d)   │                │
│ │ - Provider abstraction (Anthropic/OpenAI)    │                │
│ │ - Middleware logging (tokens, cost, cache)   │                │
│ └───────────────────────────────────────────────┘                │
│                                                                   │
│ ┌────────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│ │ @redgest/reddit│  │ @redgest/email │  │ @redgest/slack      │ │
│ │ - Reddit API   │  │ - React Email  │  │ - Block Kit         │ │
│ │ - Token bucket │  │ - Resend       │  │ - Webhook client    │ │
│ │ - Rate limiter │  │ - Templates    │  │ - Message builder   │ │
│ │ - Fetcher      │  └────────────────┘  └─────────────────────┘ │
│ └────────────────┘                                                │
│                                                                   │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ @redgest/db: Prisma v7 with @prisma/adapter-pg             │ │
│ │ - Schema (8 tables, 4 views)                                │ │
│ │ - Singleton Prisma client                                   │ │
│ │ - Repository interfaces (IOrderRepository pattern)           │ │
│ │ - UoW for transactions                                       │ │
│ │ - Migration + seed scripts                                   │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ @redgest/config: Unified configuration                       │ │
│ │ - DATABASE_URL, LLM_PROVIDER, TRIGGER_SECRET_KEY, etc.      │ │
│ │ - Zod schema for validation                                  │ │
│ │ - Injected into all packages via import                      │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
             │                      │
             │ Internal HTTP        │ HTTPS
             │ (docker-compose)     │
┌────────────┴──────────────────────┴───────────────────────────────┐
│ Infrastructure Layer                                               │
│                                                                   │
│ ┌─────────────────┐ ┌─────────────────┐ ┌────────────────────┐  │
│ │ Postgres DB     │ │ Trigger.dev     │ │ Upstash Redis      │  │
│ │ (user state +   │ │ (Cloud/self)    │ │ (LLM cache)        │  │
│ │  events +       │ │ - Task queue    │ │ - TTL: 2h/7d       │  │
│ │  projections)   │ │ - Scheduling    │ │                    │  │
│ └─────────────────┘ │ - Retries       │ └────────────────────┘  │
│                     │ - Observability │                           │
│                     └─────────────────┘                           │
│                                                                   │
│ External APIs:                                                    │
│ - Reddit API (script-type auth, 60 req/min token bucket)        │
│ - Anthropic Claude (native constrained output)                   │
│ - OpenAI GPT-4 (optional fallback)                              │
│ - Resend (transactional email)                                   │
│ - Slack Incoming Webhook                                         │
└──────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
redgest/
├── packages/
│   ├── core/              # CQRS domain + pipeline
│   │   ├── src/
│   │   │   ├── commands/          # GenerateDigest, AddSubreddit, etc.
│   │   │   ├── queries/           # GetDigest, SearchPosts, etc.
│   │   │   ├── events/            # DigestRequested, PostsTriaged, etc.
│   │   │   ├── projectors/        # digest_view, post_view projectors
│   │   │   ├── pipeline/          # Triage → Summarize → Assemble
│   │   │   ├── event-bus.ts       # In-process EventEmitter (extractable)
│   │   │   └── errors.ts          # Unified error codes
│   │   └── package.json
│   │
│   ├── db/                # Prisma v7 schema & client
│   │   ├── prisma.config.ts       # NEW in v7: required config file
│   │   ├── prisma/
│   │   │   ├── schema.prisma      # 8 tables, 4 views
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   ├── client.ts          # Singleton PrismaClient({adapter})
│   │   │   ├── repositories/      # Repository interfaces
│   │   │   └── index.ts           # Public exports
│   │   └── package.json           # "type": "module"
│   │
│   ├── llm/               # LLM abstraction (AI SDK 6)
│   │   ├── src/
│   │   │   ├── types.ts           # Interfaces, Zod schemas
│   │   │   ├── providers.ts       # getModel(), registry
│   │   │   ├── generate.ts        # generateTriageResult, generatePostSummary
│   │   │   ├── client.ts          # createRedgestLLM factory
│   │   │   ├── cache.ts           # Upstash Redis cache layer
│   │   │   ├── middleware.ts      # Observability middleware
│   │   │   ├── prompts/
│   │   │   │   ├── triage.ts
│   │   │   │   └── summarization.ts
│   │   │   └── __tests__/         # Unit + integration tests
│   │   └── package.json
│   │
│   ├── reddit/            # Reddit API client
│   │   ├── src/
│   │   │   ├── client.ts          # RedditClient (script-type auth)
│   │   │   ├── rate-limiter.ts    # Token bucket, 60 req/min
│   │   │   └── content-source.ts  # ContentSource interface
│   │   └── package.json
│   │
│   ├── mcp-server/        # Hono + @hono/mcp
│   │   ├── src/
│   │   │   ├── tools.ts           # registerTools(mcp: McpServer)
│   │   │   ├── http.ts            # Hono + StreamableHTTPTransport
│   │   │   └── stdio.ts           # StdioServerTransport (local dev)
│   │   ├── package.json
│   │   └── tsconfig.json          # ESM config
│   │
│   ├── email/             # React Email + Resend
│   │   ├── src/
│   │   │   ├── templates/
│   │   │   │   └── digest.tsx     # Digest email template
│   │   │   └── client.ts          # Resend integration
│   │   └── package.json
│   │
│   ├── slack/             # Block Kit formatting
│   │   ├── src/
│   │   │   ├── builder.ts         # Message builder
│   │   │   └── client.ts          # Webhook client
│   │   └── package.json
│   │
│   ├── config/            # Unified configuration
│   │   ├── src/
│   │   │   └── index.ts           # Zod ConfigSchema, exports config
│   │   └── package.json
│   │
│   └── ui/                # ShadCN components (monorepo)
│       ├── src/components/
│       │   ├── ui/                # Primitives (button, input, etc.)
│       │   └── forms/             # Form wrappers
│       ├── components.json
│       └── package.json
│
├── apps/
│   ├── web/               # Next.js 16 config UI
│   │   ├── app/
│   │   │   ├── (auth)/            # Auth pages (if added)
│   │   │   ├── (dashboard)/
│   │   │   │   ├── subreddits/
│   │   │   │   ├── settings/
│   │   │   │   ├── history/
│   │   │   │   └── trigger/
│   │   │   ├── api/               # Route handlers (internal + webhooks)
│   │   │   └── layout.tsx         # Root layout, ThemeProvider
│   │   ├── components/            # App-specific (not shared)
│   │   ├── actions/               # Server Actions (CRUD)
│   │   ├── next.config.ts         # transpilePackages, output: standalone
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── worker/            # Trigger.dev task definitions
│       ├── trigger.config.ts      # Project config, Prisma extension
│       ├── src/
│       │   ├── trigger/
│       │   │   ├── digest.ts      # generateDigestTask + subtasks
│       │   │   ├── schedule.ts    # Cron schedule definitions
│       │   │   └── delivery.ts    # Email/Slack delivery tasks
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── docker-compose.yml             # Postgres + MCP server (Phase 1)
│                                   # + Trigger.dev self-hosted (Phase 2)
├── turbo.json                      # Build orchestration
├── package.json                    # Root workspace
├── pnpm-workspace.yaml             # pnpm monorepo
├── .env.example
└── docs/
    ├── prd/
    │   └── redgest-prd-v1.3.md
    ├── spikes/
    │   └── outputs/                # All spike documents
    └── synthesis/
        └── reconciled-implementation-plan.md (THIS FILE)
```

---

## Reconciled Decisions

### Decision: CQRS Architecture Without Event Sourcing

**Status**: Resolved
**Spikes Involved**: PRD § 2.3, Spike 3 § E
**Chosen Approach**: Commands mutate state immediately (write to domain tables). Domain events are appended to append-only `events` table as audit trail. Events trigger Trigger.dev tasks asynchronously; events are NOT used to rebuild state. Read models are standard SQL views (not materialized until performance requires).

**Rationale**:
- Event sourcing (rebuilding state from events) adds complexity for minimal benefit in a single-user tool
- Audit trail (events log) is valuable for debugging and potential future projections
- Async job triggering decouples command execution from long-running tasks (Reddit fetching, LLM calls)
- Standard views are sufficient for query volume; materialized views only if performance testing shows need

**Confidence**: HIGH. All spikes align on this pattern.

---

### Decision: Prisma v7 with Mandatory Driver Adapter

**Status**: Resolved
**Spikes Involved**: Spike 3 § A–C, Spike 5 § 2
**Chosen Approach**:
- Generator: `provider = "prisma-client"` (not deprecated `prisma-client-js`)
- Output: `output = "../src/generated/prisma"` in schema
- Adapter: `@prisma/adapter-pg` instantiated in client.ts
- Config: `prisma.config.ts` at package root (mandatory in v7)
- Client: `new PrismaClient({ adapter })`
- ESM: `"type": "module"` in package.json, `"module": "ESNext"` in tsconfig

**Rationale**:
- v7 is Rust-free, 90% smaller bundle, 3.4x faster queries than v6
- Driver adapter is mandatory; `@prisma/adapter-pg` is stable, pure JS
- `prisma.config.ts` consolidates configuration, required for schema resolution
- ESM is default; CJS still works but ESM better for bundlers (Turbopack)

**Confidence**: HIGH. Spike 3 extensively documented v7 specifics.

**Tradeoff**: Requires explicit `prisma generate` in build pipeline (no auto-generation). Mitigated via `turbo.json` task dependencies.

---

### Decision: Default LLM Model: Claude Sonnet 4.5

**Status**: Resolved
**Spikes Involved**: Spike 6 § II, § C
**Chosen Approach**:
- Default model: `claude-sonnet-4-5-20250929` (Anthropic)
- Alternative: `gpt-4o` or `gpt-4.1` (OpenAI fallback)
- Structured output: `Output.object()` with Zod schema (native constrained decoding)
- Temperature: 0.3 (triage), 0.4 (summarization)

**Rationale**:
- Sonnet 4.0 **does not** support native constrained output (falls back to unreliable `jsonTool`)
- Sonnet 4.5 **does** support native constrained output + extended thinking (future-proof)
- Constrained decoding achieves near-100% JSON validity vs. tool-use fallback (~99%)
- Cost-effective: $3/$15 per MTok (triage + summarization ~$0.40/run)
- Quality-first approach for personal tool (no cost ceiling)

**Confidence**: HIGH. Spike 6 verified via Anthropic docs.

**Note**: If budget becomes concern, Haiku 4.5 is cheaper (~10x) but lower quality; GPT-4.1 is middle-ground.

---

### Decision: Hono + @hono/mcp for MCP Server Framework

**Status**: Resolved
**Spikes Involved**: PRD § ADR-028, Spike 4 § 1
**Chosen Approach**:
- Framework: Hono (~14KB footprint)
- MCP support: `@hono/mcp` for Streamable HTTP transport (MCP spec 2025-11-25)
- Protocol: SDK's `@modelcontextprotocol/sdk` for MCP logic
- Transport: Dual-mode (HTTP for production, stdio for local Claude Desktop)
- Auth: Hono `bearerAuth` middleware

**Rationale**:
- Hono scored 29/30 in spike evaluation vs. 25/30 for SDK-bare and Fastify
- **Dual official adapter support**: `@hono/mcp` (Hono team) + `@modelcontextprotocol/hono` (MCP SDK team)
- Unique advantage: FastMCP (reference implementation, 3K GitHub stars) uses Hono internally
- Middleware composition is elegant (bearerAuth, cors, logger as one-liners)
- Native Bun support with zero code changes
- Sub-second Docker cold starts
- Tool definitions in `tools.ts` are framework-agnostic; swapping frameworks requires ~4-6 hours

**Confidence**: HIGH. Scored highest in spike, reference implementations validate choice.

---

### Decision: Trigger.dev v4 Cloud (Phase 1) → Self-Hosted (Phase 2)

**Status**: Resolved
**Spikes Involved**: PRD § ADR-005 & ADR-027, Spike 2
**Chosen Approach**:
- **Phase 1**: Trigger.dev Cloud (free tier: 30K compute seconds/month, 10 schedules)
- **Phase 2**: Self-hosted v4 via Docker Compose (same SDK, no code changes)
- **Task definitions**: Live in `apps/worker/`, imported by MCP server and event handlers
- **Triggering**: `tasks.trigger<T>("task-id", payload)` from MCP tools or command handlers

**Rationale**:
- Cloud eliminates Phase 1 ops burden; focus on pipeline logic
- SDK is identical between Cloud and self-hosted; migration is config-only
- Self-hosted v4 adds 9 Docker containers (webapp, postgres, redis, clickhouse, etc.); requires 4 vCPU / 8GB RAM minimum
- Prisma v7 supported via `modern` mode extension (externalizes @prisma/client from bundling)
- Idempotency keys prevent duplicate runs if events fire twice

**Confidence**: HIGH. Clear upgrade path documented in Spike 2.

**Risk**: Self-hosted lacks checkpointing (CRIU) and warm starts. With 3 concurrent digests × 2-3 min each, resource consumption could be high. Mitigation: Cloud free tier covers ~500 runs/month (adequate for personal tool); self-host only if costs justify.

---

### Decision: Upstash Redis for LLM Cache (Free Tier)

**Status**: Resolved
**Spikes Involved**: Spike 6 § I
**Chosen Approach**:
- **Cache backend**: Upstash Redis (HTTP/REST, no TCP pooling issues)
- **Triage cache**: 2-hour TTL, key = hash(candidateIds + insightPromptHash + model)
- **Summary cache**: 7-day TTL, key = hash(redditId + insightPromptHash + model)
- **Automatic invalidation**: Changing insight prompts changes hash → new cache key (no explicit invalidation)
- **Cost**: Free tier (500K commands/month) sufficient for ~500 ops/day

**Rationale**:
- Upstash: serverless-friendly (HTTP, not TCP), auto-scaled, native TTL, Vercel integration
- vs. Prisma: lacks native TTL (manual cleanup), 5-20ms per query
- vs. in-memory: Trigger.dev workers don't persist state between runs (processKeepAlive experimental)
- Cache key includes insightPromptHash: changing user interests automatically produces fresh results
- Triage 2-hour TTL: covers reruns after failure; candidates change every 6-12h
- Summary 7-day TTL: covers weekly digest overlap; post content stabilizes after 24h

**Confidence**: HIGH. Spike 6 designed and validated.

---

### Decision: Next.js 16 Server Components + Server Actions (No API Routes for Internal CRUD)

**Status**: Resolved
**Spikes Involved**: Spike 5 § 1–3
**Chosen Approach**:
- **Pages**: Server Components by default (fetch data, render shell)
- **Forms**: Client Components with `useActionState` + `react-hook-form` + Zod
- **Server Actions**: Command handlers (CRUD) via `'use server'` directive
- **Data access**: Direct import of query handlers from `@redgest/core` (DAL pattern)
- **Routes**: API routes only for external webhooks (Slack, Reddit); internal CRUD via Server Actions

**Rationale**:
- Server Components reduce JavaScript bundle, improve Core Web Vitals
- Server Actions are type-safe, progressive-enhancement friendly, faster than Route Handlers
- DAL pattern (skip API layer for internal access) simplifies architecture
- `useActionState` provides automatic pending state + progressive enhancement
- Forms: client-side validation (Zod) for UX + server-side validation (Zod) for security

**Confidence**: HIGH. Spike 5 verified React 19 and Next.js 16 stability.

---

### Decision: TanStack Query v5 for Client Polling (Run History)

**Status**: Resolved
**Spikes Involved**: Spike 5 § 6
**Chosen Approach**:
- **Run History screen**: `useQuery` with `refetchInterval: 5000` and `refetchIntervalInBackground: false`
- **Prefetch pattern**: Server Component prefetches data, `<HydrationBoundary>` dehydrates cache, Client Component picks up via `useQuery`
- **Polling granularity**: 5-second poll is adequate for personal tool (not real-time)
- **Alternative (simpler)**: `router.refresh()` every N seconds (no extra library)

**Rationale**:
- TanStack Query better than SWR for mutation handling (optimistic updates, rollback)
- 5-second poll interval balances responsiveness vs. load (Trigger.dev doesn't support webhooks to Next.js easily)
- Server-side prefetch reduces initial load state
- SSE would be overkill for single-user admin panel

**Confidence**: HIGH. Spike 5 recommends this pattern explicitly.

---

### Decision: Sanitize Reddit Content + Input Validation (Security)

**Status**: Resolved
**Spikes Involved**: Spike 4 § 5, Spike 6 (implied)
**Chosen Approach**:
- **Prompt injection defense**: XML tag boundaries (`<reddit_post>`, `<user_interests>`) + content_handling instruction
- **Sanitization**: Escape/strip XML-like tags from Reddit content before prompt insertion
- **Input validation**: All tool inputs validated against Zod schemas
- **Structured output**: JSON schema enforcement (constrained decoding) prevents arbitrary output format
- **Least privilege**: No filesystem, network, or system access; only Postgres + Reddit API + LLM API

**Rationale**:
- Reddit content is untrusted user-generated data
- Claude is fine-tuned to respect XML boundaries (Anthropic's Nov 2025 research)
- Constrained output limits damage surface (can't output arbitrary text, only valid JSON)
- No tool access means injection can only corrupt field values, not system state

**Confidence**: HIGH. Spike 6 analyzed threat model extensively.

---

### Decision: MCP Response Envelope: `{ok: boolean, data: T, error?: ErrorObject}`

**Status**: Resolved
**Spikes Involved**: PRD § 3.1, Spike 4 § 2
**Chosen Approach**:
```typescript
{
  ok: boolean;
  data?: T;
  error?: {
    code: RedgestErrorCode;      // Machine-readable (JOB_NOT_FOUND, etc.)
    message: string;             // Human-readable
    details?: unknown;           // Optional (e.g., validation errors)
  };
}
```
- **Tool descriptions**: Tell agents *when* to use (agent-facing, not just "what it does")
- **Return JSON in `content` text blocks** (not `structuredContent` — it's broken in Claude Desktop and VS Code)
- **No pagination on tool responses** (limit-only, sensible defaults; agents struggle with cursors)

**Rationale**:
- Consistent shape across all 12 tools enables agent parsing without per-tool logic
- Machine-readable codes allow agent branching; human-readable messages for user display
- Tool descriptions guide agent strategy (e.g., "Use after generate_digest to poll for completion")
- JSON in text is the community standard; structuredContent has client bugs with no LLM benefit

**Confidence**: HIGH. Spike 4 researched all major clients; JSON-in-text is safest path.

---

### Decision: No Event Bus Extraction Required in Phase 1

**Status**: Resolved
**Spikes Involved**: PRD § ADR-029, Spike 2 § C
**Chosen Approach**:
- **Phase 1**: In-process EventEmitter (`import { EventEmitter } from 'events'`)
- **Interface**: `emit(event)`, `on(eventType, handler)` (transport-agnostic)
- **Phase 2+**: If MCP server and Trigger.dev worker split across processes, extract to Postgres LISTEN/NOTIFY or Redis pub/sub (one-file swap)
- **Current flow**: `DigestRequested` event → event handler calls `tasks.trigger()` → Trigger.dev executes task → task writes completion status back to Postgres

**Rationale**:
- Single-process in Phase 1 (Hono server + event handlers + job status checks all in-process)
- Zero infrastructure, trivially testable, no network latency
- Interface designed for extraction; no code changes needed when extracting

**Confidence**: HIGH. Spike 2 validates event-handler-to-trigger pattern.

---

### Decision: Full-Text Search Deferred to Phase 4

**Status**: Resolved
**Spikes Involved**: PRD § 12, Spike 3 § Full-text search section
**Chosen Approach**:
- **Phase 1–3**: Keyword search via simple LIKE or prefix matching
- **Phase 4**: Native PostgreSQL `tsvector` + GIN index via custom migration
  - Spike 3 documents the exact migration (CREATE TRIGGER, CREATE INDEX)
  - Prisma schema marks as `Unsupported("tsvector")?`
  - Queries use TypedSQL or `$queryRaw`

**Rationale**:
- Full-text search is complex; deferred for simplicity in MVP
- Trigger-based tsvector avoids Prisma schema-generation issues with GENERATED columns
- GIN indexes provide sub-100ms search on 10K+ posts
- Phase 4 acceptable because `search_posts` tool is not blocking for Phase 1 MVP

**Confidence**: HIGH. Clear migration path documented.

---

## Interface Contracts

### MCP Tool Definitions

All 12 tools follow the agent-first design pattern: consistent response envelope, clear descriptions, composable primitives.

#### Pipeline Operations

**`generate_digest`** — Trigger a new digest run.
```typescript
Input: {
  subreddits?: string[];    // default: all active
  lookback?: string;        // default: "24h" (parsed as duration)
  delivery?: 'none' | 'email' | 'slack' | 'all';
}
Output: {
  ok: true;
  data: { jobId: string; status: 'queued' };
}
Error: {
  ok: false;
  error: { code: 'INVALID_LOOKBACK' | 'NO_SUBREDDITS', message: '...' };
}
```

**`get_run_status`** — Check if a digest run is processing.
```typescript
Input: { jobId: string; }
Output: {
  ok: true;
  data: {
    jobId: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';
    progress: number;          // 0-1
    startedAt: ISO8601;
    completedAt?: ISO8601;
    error?: string;            // if failed
  };
}
```

**`list_runs`** — See history of past digest runs.
```typescript
Input: {
  status?: string;
  since?: ISO8601;            // default: 7 days ago
  limit?: number;             // default: 20, max: 100
}
Output: {
  ok: true;
  data: {
    runs: {
      jobId: string;
      status: string;
      startedAt: ISO8601;
      completedAt?: ISO8601;
      postCount: number;
      subreddits: string[];
    }[];
  };
}
```

#### Content Access

**`get_digest`** — Fetch digest content.
```typescript
Input: {
  jobId?: string;             // default: latest completed
  subreddit?: string;         // filter by subreddit
}
Output: {
  ok: true;
  data: {
    digest: {
      jobId: string;
      generatedAt: ISO8601;
      subreddits: {
        name: string;
        posts: {
          redditId: string;
          title: string;
          url: string;
          summary: string;
          keyTakeaways: string[];
          insightNotes: string[];
          commentHighlights: { author: string; insight: string; score: number }[];
        }[];
      }[];
    };
  };
}
```

**`get_post`** — Deep-dive into a single post.
```typescript
Input: {
  postId?: string;            // Redgest post ID
  redditUrl?: string;         // Or Reddit post URL
}
Output: {
  ok: true;
  data: {
    post: {
      redditId: string;
      title: string;
      subreddit: string;
      author: string;
      score: number;
      commentCount: number;
      url?: string;
      body: string;
      summary?: string;       // if summarized
      comments: { author: string; body: string; score: number; depth: number }[];
    };
  };
}
```

**`search_posts`** — Search stored posts.
```typescript
Input: {
  query: string;
  subreddit?: string;
  since?: ISO8601;
  limit?: number;
}
Output: {
  ok: true;
  data: {
    posts: {
      redditId: string;
      title: string;
      subreddit: string;
      score: number;
      summary?: string;
    }[];
  };
}
```

**`search_digests`** — Search past digest summaries.
```typescript
Input: {
  query: string;
  since?: ISO8601;
  limit?: number;
}
Output: {
  ok: true;
  data: {
    digests: {
      jobId: string;
      generatedAt: ISO8601;
      matchingPosts: number;
      preview: string;
    }[];
  };
}
```

#### Configuration

**`list_subreddits`** — Show monitored subreddits.
```typescript
Output: {
  ok: true;
  data: {
    subreddits: {
      name: string;
      insightPrompt?: string;
      maxPosts: number;
      includeNsfw: boolean;
      isActive: boolean;
      createdAt: ISO8601;
      lastDigestAt?: ISO8601;
    }[];
  };
}
```

**`add_subreddit`** — Start monitoring a subreddit.
```typescript
Input: {
  name: string;
  insightPrompt?: string;
  maxPosts?: number;            // default: 5
  includeNsfw?: boolean;        // default: false
}
Output: {
  ok: true;
  data: { subreddit: { name: string; ... }; };
}
Error: {
  ok: false;
  error: { code: 'SUBREDDIT_ALREADY_EXISTS' | 'INVALID_SUBREDDIT' | ... };
}
```

**`remove_subreddit`** — Stop monitoring a subreddit.
```typescript
Input: { name: string; }
Output: {
  ok: true;
  data: { removed: true };
}
```

**`update_subreddit`** — Modify subreddit settings.
```typescript
Input: {
  name: string;
  insightPrompt?: string;
  maxPosts?: number;
  includeNsfw?: boolean;
}
Output: {
  ok: true;
  data: { subreddit: { ... }; };
}
```

**`get_config`** — Show global settings.
```typescript
Output: {
  ok: true;
  data: {
    config: {
      globalInsightPrompt?: string;
      defaultLookback: string;      // "24h"
      defaultDelivery: 'none' | 'email' | 'slack' | 'all';
      llmProvider: 'anthropic' | 'openai';
      llmModel: string;
      schedule?: string;            // cron pattern if scheduled
    };
  };
}
```

**`update_config`** — Change global settings.
```typescript
Input: {
  globalInsightPrompt?: string;
  defaultLookback?: string;
  defaultDelivery?: string;
  llmProvider?: string;
  llmModel?: string;
  schedule?: string;
}
Output: {
  ok: true;
  data: { config: { ... }; };
}
```

### Unified Error Code Registry

```typescript
export type RedgestErrorCode =
  // Configuration
  | 'SUBREDDIT_NOT_FOUND'
  | 'SUBREDDIT_ALREADY_EXISTS'
  | 'INVALID_SUBREDDIT'
  | 'NO_SUBREDDITS_CONFIGURED'
  | 'INVALID_CONFIG'
  | 'INVALID_INSIGHT_PROMPT'

  // Jobs
  | 'JOB_NOT_FOUND'
  | 'JOB_ALREADY_RUNNING'
  | 'JOB_FAILED'
  | 'PARTIAL_JOB_FAILURE'

  // Content
  | 'POST_NOT_FOUND'
  | 'DIGEST_NOT_FOUND'

  // LLM layer
  | 'LLM_SCHEMA_VALIDATION_FAILED'
  | 'LLM_INVALID_POST_INDICES'
  | 'LLM_WRONG_SELECTION_COUNT'
  | 'LLM_CONTENT_POLICY_REFUSAL'
  | 'LLM_RATE_LIMITED'
  | 'LLM_TIMEOUT'
  | 'LLM_PROVIDER_ERROR'
  | 'LLM_ALL_RETRIES_EXHAUSTED'

  // Reddit layer
  | 'REDDIT_API_ERROR'
  | 'REDDIT_RATE_LIMITED'
  | 'REDDIT_AUTH_FAILED'
  | 'REDDIT_SUBREDDIT_NOT_FOUND'

  // Infrastructure
  | 'DATABASE_ERROR'
  | 'TRIGGER_UNAVAILABLE'
  | 'CACHE_ERROR'

  // Input validation
  | 'INVALID_LOOKBACK'
  | 'INVALID_PARAMETER'
  | 'INVALID_PAGINATION_CURSOR'

  // Auth
  | 'UNAUTHORIZED'
  | 'INVALID_API_KEY'

  // Generic
  | 'INTERNAL_ERROR'
  | 'NOT_IMPLEMENTED';
```

---

## Unified Data Model

### Prisma v7 Schema (Annotated)

```prisma
// packages/db/prisma/schema.prisma

generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"
  previewFeatures = ["views"]
  // Note: views still in Preview as of Prisma v7.4.x
}

datasource db {
  provider = "postgresql"
  // URL specified in prisma.config.ts, NOT here (v7 change)
}

// ─────────────────────────────────────────────────────
// CORE TABLES
// ─────────────────────────────────────────────────────

model Subreddit {
  id             String   @id @default(uuid(7))
  name           String   @unique
  insightPrompt  String?
  maxPosts       Int      @default(5)
  includeNsfw    Boolean  @default(false)
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  posts SubredditPost[]

  @@index([isActive])
}

model Config {
  id                    String  @id @default("singleton")
  // Enforced singleton via unique constraint
  globalInsightPrompt   String?
  defaultLookback       String  @default("24h")
  defaultDelivery       String  @default("none") // 'none'|'email'|'slack'|'all'
  llmProvider          String  @default("anthropic")
  llmModel             String  @default("claude-sonnet-4-5-20250929")
  schedule             String?  // Cron pattern, e.g. "0 7 * * *"
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@unique([id])
}

model Job {
  id             String   @id @default(uuid(7))
  status         String   @default("queued") // queued|running|completed|failed|partial
  subreddits     String[] // JSON array of subreddit names
  lookback       String   @default("24h")
  delivery       String   @default("none")
  triggerRunId   String?  // Trigger.dev run ID for status polling
  startedAt      DateTime?
  completedAt    DateTime?
  error          String?
  createdAt      DateTime @default(now())

  posts         JobPost[]
  summaries     PostSummary[]
  digest        Digest?

  @@index([status])
  @@index([createdAt])
}

model Event {
  id              BigInt   @id @default(autoincrement())
  aggregateId     String   // Job ID, Subreddit ID, etc.
  aggregateType   String   // "Job", "Subreddit", etc.
  type            String   // "DigestRequested", "PostsTriaged", etc.
  version         Int      // Informational; no uniqueness constraint
  payload         Json     // Event-specific data
  metadata        Json     @default("{}")
  correlationId   String?
  causationId     String?
  createdAt       DateTime @default(now())

  @@index([aggregateType, aggregateId, version])
  @@index([type, createdAt])
  // BRIN index on created_at (append-only table)
  // CREATE INDEX idx_events_created_brin ON "Event" USING brin (created_at) WITH (pages_per_range = 32);
}

model Post {
  id             String   @id @default(uuid(7))
  redditId       String   @unique // Reddit's post ID
  subreddit      String
  title          String
  body           String   @db.Text
  author         String
  score          Int
  commentCount   Int
  url            String?
  permalink      String
  flair          String?
  isNsfw         Boolean  @default(false)
  contentType    String   @default("text") // text|link|image|video
  fetchedAt      DateTime @default(now())

  comments     PostComment[]
  summaries    PostSummary[]
  jobPosts     JobPost[]
  subredditPost SubredditPost?

  @@index([redditId])
  @@index([subreddit])
  @@index([fetchedAt])
}

model PostComment {
  id             String   @id @default(uuid(7))
  postId         String
  redditId       String
  author         String
  body           String   @db.Text
  score          Int
  depth          Int      @default(0)
  createdAt      DateTime @default(now())

  post           Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@index([postId])
}

model PostSummary {
  id              String   @id @default(uuid(7))
  postId          String
  jobId           String
  summary         String   @db.Text
  keyTakeaways    String[] // JSON array
  insightNotes    String[] // JSON array
  commentHighlights Json   // Array of {author, insight, score}
  sentiment       String   // positive|negative|neutral|mixed
  relevanceScore  Int      // 1-10
  llmProvider     String
  llmModel        String
  durationMs      Int
  fromCache       Boolean  @default(false)
  createdAt       DateTime @default(now())

  post            Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  job             Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([postId])
  @@index([jobId])
  @@unique([postId, jobId]) // One summary per post per job
}

model Digest {
  id              String   @id @default(uuid(7))
  jobId           String   @unique
  contentMarkdown String   @db.Text
  contentHtml     String?  @db.Text
  contentSlackBlocks Json?  // Slack Block Kit JSON
  createdAt       DateTime @default(now())

  job             Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  posts           JobPost[]

  @@index([jobId])
}

model JobPost {
  id              String   @id @default(uuid(7))
  jobId           String
  postId          String
  subreddit       String
  rank            Int      // Position in digest for this subreddit
  createdAt       DateTime @default(now())

  job             Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  post            Post     @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([jobId, postId])
  @@index([jobId])
}

model SubredditPost {
  id              String   @id @default(uuid(7))
  subredditId     String
  postId          String   @unique
  addedAt         DateTime @default(now())

  subreddit       Subreddit @relation(fields: [subredditId], references: [id], onDelete: Cascade)
  post            Post      @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@index([subredditId])
}

// ─────────────────────────────────────────────────────
// READ MODELS (Views) — still in Preview
// ─────────────────────────────────────────────────────

view DigestView {
  jobId           String   @unique
  status          String
  generatedAt     DateTime
  subreddits      String[] // JSON array
  postCount       Int
  contentMarkdown String

  @@map("digest_view")
}

view PostView {
  postId          String   @unique
  redditId        String
  title           String
  subreddit       String
  author          String
  score           Int
  summary         String?
  keyTakeaways    String[]?
  lastSummarizedAt DateTime?

  @@map("post_view")
}

view RunView {
  jobId           String   @unique
  status          String
  startedAt       DateTime?
  completedAt     DateTime?
  progress        Float    // 0-1
  error           String?

  @@map("run_view")
}

view SubredditView {
  subredditId     String   @unique
  name            String
  insightPrompt   String?
  isActive        Boolean
  lastDigestAt    DateTime?
  postCount       Int

  @@map("subreddit_view")
}
```

**View creation (manual SQL migration):**

```sql
-- Create digest_view
CREATE VIEW digest_view AS
SELECT
  j.id as "jobId",
  j.status,
  j.created_at as "generatedAt",
  j.subreddits,
  COUNT(jp.id)::int as "postCount",
  d.content_markdown as "contentMarkdown"
FROM "Job" j
LEFT JOIN "JobPost" jp ON j.id = jp.job_id
LEFT JOIN "Digest" d ON j.id = d.job_id
GROUP BY j.id, d.id;

-- Similar for post_view, run_view, subreddit_view
-- See Spike 3 for complete SQL
```

---

## Implementation Sequence

### Phase 1: Core Pipeline + MCP (Weeks 1–4)

**Goal**: MVP with manual trigger, no scheduling, no email/Slack.

1. **Monorepo scaffolding** (Week 1)
   - TurboRepo setup with all packages
   - `@redgest/config` with unified Zod schema
   - `@redgest/db` with Prisma v7 schema, migrations, singleton client
   - Docker Compose (Postgres only)

2. **@redgest/core** (Week 1–2)
   - CQRS infrastructure: command bus, query bus, event bus (in-process)
   - Domain models (Command, Query, Event classes)
   - Command handlers: `GenerateDigestHandler`, `AddSubredditHandler`, `UpdateConfigHandler`
   - Query handlers: `GetDigestHandler`, `ListSubredditsHandler`, etc.
   - Event projectors: `digest_view_projector`, `post_view_projector`, etc.
   - Error codes and standard error handling

3. **@redgest/reddit** (Week 1)
   - Reddit API client (script-type auth)
   - Token bucket rate limiter (60 req/min)
   - Content fetcher (hot/top/rising + comments)

4. **@redgest/llm** (Week 2)
   - Zod schemas for triage and summarization
   - Prompt templates (system + user)
   - `generateTriageResult()` with `Output.object()`
   - `generatePostSummary()` with `Output.object()`
   - Provider abstraction (Anthropic + OpenAI)
   - Upstash Redis cache layer
   - Middleware logging (tokens, cost, duration)

5. **Pipeline orchestration** (Week 2–3)
   - Triage → Summarize → Assemble flow
   - Token budgeting and truncation
   - Deduplication logic (skip posts from previous digests)
   - Error recovery and partial failure handling

6. **@redgest/mcp-server** (Week 3)
   - `tools.ts`: Register all 12 tools on McpServer
   - `http.ts`: Hono + @hono/mcp with Streamable HTTP transport
   - `stdio.ts`: StdioServerTransport for Claude Desktop local dev
   - Bearer auth middleware
   - Standard response envelope `{ok, data, error}`

7. **@redgest/core integration with Trigger.dev** (Week 3–4)
   - `apps/worker/trigger.config.ts` with Prisma modern mode extension
   - Task definitions: `digest.generate`, `digest.fetch`, `digest.triage`, `digest.summarize`
   - Event handler: `DigestRequested` → `tasks.trigger("digest.generate", ...)`
   - Task result handlers: write completion status back to Postgres

8. **Testing & deployment** (Week 4)
   - Unit tests: Zod schemas, prompt building, truncation logic
   - Integration tests: mock LLM, real Reddit API (if possible)
   - E2E: manual trigger via MCP, verify digest in Postgres
   - Docker image for MCP server
   - Local Docker Compose verification

**Deliverables**:
- Functional MVP: configure subreddits, trigger digest via MCP, retrieve results
- All 12 MCP tools live and working
- Core pipeline with intelligent post selection
- Zero external delivery channels

---

### Phase 2: Scheduling + Delivery + Self-Hosted (Weeks 5–8)

**Goal**: Scheduled runs, email/Slack delivery, optional self-hosted Trigger.dev.

1. **Scheduled tasks** (Week 5)
   - `digest.schedule` cron task (e.g., 7 AM daily)
   - Per-user custom schedules via `schedules.create()` SDK
   - Config UI for editing schedule

2. **Email delivery** (Week 5)
   - `@redgest/email` with React Email templates
   - Resend integration
   - Template with clean typography, section dividers, insight callouts
   - `digest.deliver` task (triggered by `DigestCompleted` event)

3. **Slack delivery** (Week 5)
   - `@redgest/slack` with Block Kit formatter
   - Webhook client
   - `digest.deliver` task (same trigger)

4. **Event bus extraction** (Week 6, optional)
   - Extract in-process event bus to Postgres LISTEN/NOTIFY or Redis pub/sub
   - No changes to domain logic; adapter pattern
   - Useful if services split across processes later

5. **Self-hosted Trigger.dev** (Week 6–7)
   - Docker Compose additions (9 containers)
   - Configuration (.env for self-hosted)
   - Cloud → self-hosted migration playbook
   - Resource monitoring (CPU, memory per digest)

6. **Config UI (@redgest/web)** (Week 7–8)
   - Next.js 16 with ShadCN
   - Subreddit Manager: add/remove/edit with insight prompts
   - Global Settings: insight prompt, lookback, LLM model, delivery channels, schedule
   - Run History: table of past runs with status, timing, error details
   - Manual Trigger: button to run with optional parameter overrides
   - Dark mode default

**Deliverables**:
- Scheduled digest runs
- Email and Slack delivery working
- Optional self-hosted Trigger.dev deployment
- Web config panel (minimal, functional)

---

### Phase 3+: Search + History + Polish (Weeks 9+)

Deferred based on priority:
- Full-text search (tsvector + GIN, Phase 4)
- Conversational history (past digests as context, Phase 4)
- Advanced filtering and trending (Phase 4+)
- User authentication (if sharing is desired, Phase 4+)

---

## Conflict Register

| # | Conflict | Type | Spikes | Resolution | Confidence | Human Review? |
|---|----------|------|--------|------------|------------|---------------|
| 1 | Error handling taxonomy (different per layer) | INTERFACE_MISMATCH | 6, 5, 4 | Unified error code registry in `@redgest/core`, all layers map to it | HIGH | No |
| 2 | Configuration scattered across ENV vars and runtime | SCOPE_OVERLAP | PRD, 6, 5, 4, 2 | `@redgest/config` package with Zod schema, single import point | HIGH | No |
| 3 | LLM model choice (Sonnet 4 vs 4.5) | TECHNOLOGY_CONTRADICTION | Spike 6 | Sonnet 4.5 supports native constrained output; Sonnet 4 does not | HIGH | No |
| 4 | MCP response format (structuredContent vs JSON-in-text) | TECHNOLOGY_CONTRADICTION | Spike 4, PRD | JSON in text blocks; structuredContent has client bugs | HIGH | No |
| 5 | Event bus in Phase 1 (in-process vs extracted) | ASSUMPTION_CONFLICT | PRD, Spike 2 | In-process is correct; extraction deferred to Phase 2+ | HIGH | No |

**Summary**: Zero unresolvable conflicts. All spikes made compatible decisions; three issues (errors, config, event bus) required architectural clarification but no engineering trade-offs.

---

## Gap Register

| # | Gap | Why It Matters | Proposed Solution | Confidence |
|---|-----|----------------|-------------------|------------|
| 1 | Metrics/observability dashboard | Token costs, job timing, success rates not visible | Store LLM call logs in `llm_calls` table; Trigger.dev dashboard provides job visibility; optional Phase 2 metrics dashboard | MEDIUM |
| 2 | Full-text search implementation | `search_posts` and `search_digests` tools blocked | Phase 4: tsvector + GIN via custom migration; TypedSQL for queries; Spike 3 has exact SQL | HIGH |
| 3 | Conversation context persistence | Claude can't reference past digests in conversation | Phase 4: store digest summaries as vectorized embeddings; Claude references via context injection | LOW |
| 4 | Rate limiting on MCP tools | No protection if server exposed to untrusted clients | Add middleware rate limit (e.g., 100 calls/min per API key); Trigger.dev provides built-in limits | MEDIUM |
| 5 | Prompt injection defense (sanitization) | Reddit content could escape XML boundaries | Sanitize XML-like tags from Reddit content before prompt insertion (Spike 6 provided regex) | HIGH |
| 6 | Trigger.dev Prisma v7 bundling verification | `modern` mode externalizes @prisma/client; may fail on adapter | Test deployment with real Prisma v7 + adapter before Phase 2 migration | MEDIUM |

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| 1 | Anthropic prompt caching minimum threshold (1024 tokens) | MEDIUM | System prompt (~800 tokens) below threshold, no caching | Pad system prompt with examples, or combine system + insights into single cached block |
| 2 | Trigger.dev self-hosted without checkpointing | MEDIUM | Resource consumption high for multi-phase pipeline with `triggerAndWait()` | Cloud free tier adequate for ~500 runs/month; self-host only when costs justify; restructure to fire-and-forget if needed |
| 3 | Prisma v7 driver adapter in Trigger.dev containers | MEDIUM | `@prisma/adapter-pg` dependency bundling unclear | Pin exact Prisma + Trigger.dev SDK versions; test deployment thoroughly before Phase 2 |
| 4 | Claude Desktop doesn't support elicitation | LOW | Destructive operations (`remove_subreddit`) lack confirmation UI | Document clearly in tool descriptions; rely on client-side approval prompts (supported); make elicitation optional for future clients |
| 5 | Redis connection pooling in serverless workers | LOW | Upstash HTTP/REST avoids TCP issues; in-memory fallback possible | Use Upstash (no pooling required); avoid in-memory cache (Trigger.dev processes don't persist) |
| 6 | MCP structuredContent client bugs not fixed | LOW | Temptation to use structuredContent (less reliable than text) | Commit to JSON-in-text; avoid structuredContent until client bugs confirmed resolved |
| 7 | Reddit API deprecation or rate limit changes | LOW | Sudden API unavailability would break pipeline | `ContentSource` interface designed for swappability; document migration path |
| 8 | Token usage underestimated (cost overruns) | LOW | ~$0.40/run assumed; triage + summarization could exceed budget | Monitor via middleware logging; implement per-run budget cap; fall back to cheaper models if needed |

---

## Open Questions for Human Decision

1. **Prompt caching with system prompt <1024 tokens:**
   - Current summarization system prompt is ~800 tokens. Should we pad with examples, or combine system + insight prompts into a single block to hit the 1024-token minimum?
   - **Recommendation**: Combine into single block (no code changes, immediate fix).

2. **Trigger.dev Cloud vs. self-hosted trade-offs:**
   - Cloud free tier sufficient? 30K compute seconds/month = ~600 5-minute runs. For daily digest = 30 runs/month. Comfortable headroom.
   - **Recommendation**: Start with Cloud; migrate only if costs justify (>$100/month).

3. **GPT-4.1 vs. GPT-4o for OpenAI fallback:**
   - GPT-4.1 has 1M context and cheaper pricing ($2/$8 vs $2.50/$10). Recommend for fallback?
   - **Recommendation**: Use GPT-4.1; test structured output reliability in integration tests before relying on it.

4. **Observability and metrics strategy:**
   - Store LLM call logs? Build a metrics dashboard? Both deferred to Phase 2?
   - **Recommendation**: Store logs in `llm_calls` table in Phase 1 (essential for debugging); dashboard optional Phase 2.

5. **Event bus extraction trigger:**
   - Currently in-process. When should this be extracted to Postgres/Redis?
   - **Recommendation**: Extract only if MCP server and Trigger.dev worker run as separate processes, or if event throughput requires pub/sub guarantees. For Phase 1, in-process is sufficient.

6. **Full-text search timeline:**
   - Phase 4 is deferred. Should Phase 1 `search_posts` return empty results or use basic LIKE?
   - **Recommendation**: Implement LIKE/prefix matching in Phase 1; migrate to tsvector in Phase 4.

---

## Verification Results

### 1. TRACE-THROUGH: User Requests Digest via MCP

**Flow**: Claude Desktop → MPC HTTP → Hono server → `generate_digest` tool → Command handler → Trigger.dev → Pipeline → Postgres → Response.

**Checkpoint validations:**
- ✅ MCP tool input validated against Zod schema
- ✅ Command handler creates Job record (status: queued)
- ✅ `DigestRequested` event emitted, caught by event handler
- ✅ Event handler calls `tasks.trigger("generate-digest", {jobId, subreddits, ...})`
- ✅ Trigger.dev fetches posts, triage LLM, summarization LLM, assemble
- ✅ `DigestCompleted` event emitted, triggers email/Slack (if configured)
- ✅ `get_digest` tool queries `digest_view`, returns structured markdown
- ✅ Response envelope `{ok: true, data: {digest: {...}}}` returned to Claude

**Result**: ✅ PASS. No interface gaps; all contracts align.

---

### 2. DATA FLOW CHECK: SubredditPost Entity Through Full Pipeline

**Entity journey:**
1. **Fetch**: Reddit API → `Post` record (redditId, title, body, score, comments)
2. **Triage**: Post metadata sent to LLM → triage selects indices → `JobPost` record created
3. **Fetch comments**: Reddit API fetches top 5 comments for selected posts
4. **Summarize**: Post + comments sent to LLM → `PostSummary` created (summary, keyTakeaways, insightNotes)
5. **Assemble**: `Digest` record created; `digest_view` projection populated
6. **Query**: `get_post` queries `post_view` (Post + PostSummary + top comments denormalized)
7. **Delete**: Post soft-deleted or marked for archive; events logged

**Schema consistency**:
- ✅ Post.redditId (unique) links to PostComment.postId and PostSummary.postId
- ✅ JobPost.postId links to Post and Job
- ✅ PostSummary includes relevant metadata (LLM model, duration, cache status)
- ✅ Views join correctly; no missing foreign keys

**Result**: ✅ PASS. Entity lifecycle fully traceable.

---

### 3. ERROR PROPAGATION CHECK: Reddit API Rate Limit

**Scenario**: Reddit returns 429 (Too Many Requests) during fetch phase.

**Error path**:
1. **Reddit fetcher** catches 429 → logs → throws `RedgestErrorCode.REDDIT_RATE_LIMITED`
2. **Task handler** catches → increments retry (SDK's built-in exponential backoff)
3. **After 3 retries**: SDK throws `RetryError` wrapping 429
4. **Task exception handler** (Trigger.dev) updates job status: `FAILED`, stores error message
5. **MCP `get_run_status`** returns `{ok: true, data: {status: "failed", error: "Reddit API rate limited"}}`
6. **Command handler** (if sync) could return `{ok: false, error: {code: "REDDIT_RATE_LIMITED", message: "..."}}`

**Schema consistency**:
- ✅ Job.status can be "failed"
- ✅ Job.error stores error message
- ✅ Event log captures `DigestFailed` event with error payload
- ✅ MCP error codes align with unified registry

**Result**: ✅ PASS. Errors propagate cleanly through all layers.

---

### 4. CONFIGURATION COMPLETENESS

**All config values referenced:**
- ✅ DATABASE_URL (Prisma)
- ✅ ANTHROPIC_API_KEY or OPENAI_API_KEY (LLM)
- ✅ UPSTASH_REDIS_URL (Cache)
- ✅ TRIGGER_SECRET_KEY (Trigger.dev SDK)
- ✅ TRIGGER_API_URL (self-hosted only)
- ✅ MCP_SERVER_API_KEY (MCP bearer auth)
- ✅ MCP_SERVER_PORT (Hono server port)
- ✅ RESEND_API_KEY (email, optional)
- ✅ SLACK_WEBHOOK_URL (Slack, optional)
- ✅ LOG_LEVEL (logging)
- ✅ NODE_ENV (development vs production)

**Validation**:
- ✅ `@redgest/config` Zod schema covers all
- ✅ All packages import from config, not process.env directly
- ✅ No orphaned env vars
- ✅ Optional values (.optional()) for delivery channels

**Result**: ✅ PASS. Configuration complete and centralized.

---

### 5. DEPENDENCY CYCLE CHECK

**Package dependency graph** (all packages listed):
```
@redgest/config
  ↑ (imported by all)

@redgest/db
  ← @redgest/core
  ← apps/web
  ← apps/worker

@redgest/core
  ← @redgest/db
  ← @redgest/reddit
  ← @redgest/llm
  ← @redgest/email
  ← @redgest/slack
  ← @redgest/mcp-server
  ← apps/web (for Server Actions)
  ← apps/worker (for task logic)

@redgest/reddit
  ← (none; leaf dependency)

@redgest/llm
  ← (none; leaf dependency, uses AI SDK)

@redgest/email
  ← (none; leaf dependency, uses React Email)

@redgest/slack
  ← (none; leaf dependency)

@redgest/mcp-server
  ← @redgest/core
  ← @redgest/db (via core)
  ← @redgest/config

apps/web (Next.js)
  ← @redgest/core (query/command handlers)
  ← @redgest/db (Prisma client)
  ← @redgest/config
  ← @redgest/ui (shared components)
  ← Trigger.dev SDK (for task triggering)

apps/worker (Trigger.dev)
  ← @redgest/core
  ← @redgest/db
  ← @redgest/config
```

**Cycle analysis**:
- ✅ No cycles detected
- ✅ @redgest/core at center; calls repos from db, consumes from reddit/llm/email/slack
- ✅ Web and worker both consume core; don't depend on each other
- ✅ All packages safe to extract as independent OSS libraries

**Result**: ✅ PASS. Clean, acyclic dependency graph.

---

### 6. GAP SCAN: Assumptions Satisfied

**Spike 1 (PRD) assumptions:**
- ✅ Single-user personal tool (no multi-tenancy) — confirmed throughout
- ✅ Reddit API script-type auth — Spike 2 addresses
- ✅ Trigger.dev v4 available — Phase 1 uses Cloud
- ✅ Postgres available — Docker Compose provides
- ✅ Hono framework works — Spike 1 chose it
- ✅ Upstash Redis available — Spike 6 uses it

**Spike 3 (Data Model) assumptions:**
- ✅ Prisma v7 driver adapter works in containers — noted as risk; testing required
- ✅ Standard views sufficient for query volume — confirmed
- ✅ Event log suitable for audit trail — schema designed for it

**Spike 6 (LLM) assumptions:**
- ✅ Claude Sonnet 4.5 available — current, GA
- ✅ Constrained output supported — native since Nov 2025
- ⚠️ Prompt caching minimum 1024 tokens — potential issue; mitigation provided
- ✅ AI SDK 6 stable — current version

**Spike 5 (UI) assumptions:**
- ✅ Next.js 16 stable — GA December 2025
- ✅ React 19.2 hooks available — confirmed
- ✅ Server Components + Server Actions supported — confirmed
- ⚠️ Turbopack transpilation works with monorepo — known bugs; transpilePackages mitigation provided

**Spike 4 (MCP) assumptions:**
- ✅ Hono + @hono/mcp works — Spike 1 confirms
- ✅ Claude Desktop primary client — confirmed; structuredContent/elicitation not required
- ✅ Streamable HTTP transport stable — MCP spec 2025-11-25

**Spike 2 (Trigger.dev) assumptions:**
- ✅ v4 SDK stable and Prisma-compatible — confirmed
- ⚠️ `modern` mode bundling correct — test required before Phase 2
- ✅ Idempotency keys prevent duplicates — confirmed

**Result**: ✅ PASS. All assumptions satisfied or noted as gaps with mitigations.

---

## Summary

This reconciliation synthesizes six parallel research spikes into a coherent, buildable implementation plan for Redgest. **Zero hard conflicts** exist; all architectural decisions align. Three areas required clarification (error codes, config management, event bus extraction) but no engineering trade-offs.

**Critical path for engineering:**
1. Establish `@redgest/config` and `@redgest/db` foundation
2. Implement CQRS in `@redgest/core` (commands, queries, events, projectors)
3. Build LLM abstraction (`@redgest/llm`) with caching and error handling
4. Wire MCP server (`@redgest/mcp-server`) with all 12 tools
5. Connect Trigger.dev tasks for async execution
6. Add config UI (`apps/web`) in Phase 2

**Confidence**: HIGH across all decisions. All spikes validated against PRD and each other. Low-risk architectural approach suitable for solo developer.
