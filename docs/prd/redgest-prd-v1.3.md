# REDGEST — Product Requirements Document

**Reddit Digest Engine** | Version 1.3 | March 2026 | Status: Ready for Implementation

---

## 1. Overview

Redgest is a personal Reddit digest engine that monitors configured subreddits, uses LLM intelligence to identify and curate the most relevant posts based on user-defined interests, generates summaries with contextual insights, and delivers digests via multiple channels. The system is MCP-first, enabling conversational interaction with Reddit content through Claude.

### 1.1 Problem Statement

Reddit contains high-signal content buried under volume and noise. Manually checking multiple subreddits is time-consuming and easy to neglect. Existing aggregation tools use crude heuristics (upvote thresholds, keyword matching) that miss nuanced relevance. There is no good way to say "show me what matters to me" across subreddits and get an intelligent, personalized answer.

### 1.2 Solution

Redgest fetches candidate posts from Reddit, uses an LLM pipeline (guided by user-defined insight prompts) to select the most interesting posts, summarizes each with top comments, and delivers a structured digest. The entire system is queryable via MCP, enabling Claude to trigger runs, fetch content, and answer questions about past digests conversationally.

### 1.3 Target User

Single user (personal tool). No multi-tenancy, no auth system, no billing.

### 1.4 Design Principles

- **Local-first, vendor-agnostic:** No platform lock-in. Docker Compose for local development, deploy targets are a runtime decision. Every component runs on any infrastructure that supports Node.js and Postgres.
- **Agent-first API design:** The MCP server treats agents as developers. Tool naming, descriptions, parameter schemas, and response shapes are DX. An agent reading the tool list should immediately understand what's available and how to compose calls — the same way a developer reads good API docs.
- **CQRS throughout:** Commands mutate state and emit domain events. Queries read from optimized views. The entire system is async by default.
- **Extractable packages:** Every domain concern lives in its own package. Any package can be extracted as a standalone OSS library with zero refactoring.

---

## 2. Architecture

### 2.1 Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Monorepo | TurboRepo | Shared TypeScript config, package-level builds |
| Runtime | Node.js / Bun | ESM throughout. Bun-native via Hono, zero code changes to switch. |
| Language | TypeScript (strict) | |
| Database | Postgres + Prisma v7 | Rust-free client, ESM-native, `prisma.config.ts` |
| LLM | Configurable (Claude + OpenAI) | Vercel AI SDK provider pattern |
| Job Orchestration | Trigger.dev v4 | Cloud in Phase 1, self-hosted Docker in Phase 2 |
| MCP Server | Hono + `@hono/mcp` + `@modelcontextprotocol/sdk` | Standalone service. Streamable HTTP transport (MCP spec 2025-11-25). |
| Web UI | Next.js 16 + React 19 | Config panel only. ShadCN components. |
| Email | Resend + React Email | Clean typography template |
| Slack | Incoming webhook | Block Kit formatted messages |
| Reddit | Script-type app (client credentials) | 60 req/min rate limit |
| Containerization | Docker / Docker Compose | Local dev parity, deploy-anywhere |
| Event Bus | In-process (Phase 1), extractable to Postgres NOTIFY or Redis (Phase 2+) | Typed EventEmitter pattern |

### 2.2 Monorepo Structure

```
redgest/
├── packages/
│   ├── core/           # Domain logic, CQRS commands/queries/events, pipeline orchestration
│   ├── db/             # Prisma schema, client, migrations, read model projections
│   ├── mcp-server/     # Hono app, MCP tool definitions, Streamable HTTP + stdio transports
│   │   ├── src/
│   │   │   ├── tools.ts    # Shared tool definitions (framework-agnostic)
│   │   │   ├── http.ts     # Hono entry point (Streamable HTTP transport)
│   │   │   └── stdio.ts    # Stdio entry point (Claude Desktop local dev)
│   ├── reddit/         # Reddit API client, rate limiter, content fetcher
│   ├── llm/            # LLM provider abstraction (AI SDK wrapper, prompt templates)
│   ├── email/          # React Email templates + Resend integration
│   ├── slack/          # Slack webhook formatting (Block Kit)
│   └── config/         # Shared TypeScript, ESLint, Prettier configs
├── apps/
│   ├── web/            # Next.js config UI (ShadCN, dark mode)
│   └── worker/         # Trigger.dev worker definitions
├── docker-compose.yml  # Postgres, MCP server (Phase 2 adds Trigger.dev self-hosted)
├── turbo.json
└── package.json
```

Each package has a clean dependency graph: `mcp-server` → `core` → `db`, `reddit`, `llm`. `email` and `slack` are leaf dependencies consumed by `core` for delivery. No circular dependencies. Any package can be published independently.

### 2.3 CQRS Architecture

The system follows Command Query Responsibility Segregation throughout. This is CQRS *without* full event sourcing — commands emit domain events stored in Postgres, consumed by projectors that update read models. State is not rebuilt from events.

**Command Side (Write Path)**

Commands are the only way to mutate state. Each command is a typed object processed by a handler that validates input, executes business logic, persists state changes, and emits domain events.

Commands include: `GenerateDigest`, `AddSubreddit`, `RemoveSubreddit`, `UpdateSubreddit`, `UpdateConfig`, `CompleteJob`, `FailJob`.

Domain events include: `DigestRequested`, `DigestCompleted`, `DigestFailed`, `SubredditAdded`, `SubredditRemoved`, `ConfigUpdated`, `PostsFetched`, `PostsTriaged`, `PostsSummarized`.

Events are stored in an `events` table (append-only log) and dispatched to handlers/projectors via an in-process event bus (typed EventEmitter pattern in Phase 1). The bus interface (`emit(event)`, `on(eventType, handler)`) is transport-agnostic — extraction to Postgres LISTEN/NOTIFY or Redis pub/sub is a one-file swap when services split across processes in Phase 2+.

**Query Side (Read Path)**

Queries read from standard Postgres views optimized for their access patterns. The MCP server's content access tools (`get_digest`, `search_posts`, `get_post`) hit read models directly — no command processing, no locks, fast. Views are promoted to materialized views only if performance requires it.

Read models include: `digest_view` (pre-rendered digest content), `post_view` (post + summary + comments denormalized), `run_view` (job status + progress), `subreddit_view` (config + last activity).

**Event Flow Example: `generate_digest`**

1. MCP tool call → `GenerateDigest` command created
2. Command handler validates, creates job record, emits `DigestRequested` event, returns `{ jobId }`
3. `DigestRequested` event triggers Trigger.dev task
4. Task fetches Reddit posts → emits `PostsFetched`
5. Task runs LLM triage → emits `PostsTriaged`
6. Task runs LLM summarization → emits `PostsSummarized`
7. Task assembles digest → emits `DigestCompleted`
8. Projectors update read model views
9. Delivery handlers (email, Slack) fire on `DigestCompleted` if configured

### 2.4 System Components

**`@redgest/core`** — Domain logic and CQRS infrastructure. Command bus, event bus (in-process, extractable interface), command handlers, event projectors. Pipeline orchestration logic. Delivery dispatch. No framework dependencies — pure TypeScript.

**`@redgest/db`** — Prisma v7 schema, generated client, migrations. Read model views and projection queries. Event store persistence. Exposes typed repository interfaces consumed by `core`.

**`@redgest/reddit`** — Reddit API client behind a `ContentSource` interface (enabling future source swaps if the Reddit API changes). Handles auth (script-type app), rate limiting (token bucket, 60 req/min), and content fetching (hot/top/rising + comments). Returns typed domain objects, not raw Reddit JSON.

**`@redgest/llm`** — LLM provider abstraction built on Vercel AI SDK. Prompt templates for triage and summarization. Configurable provider/model. Structured output parsing. Token budgeting: 3K tokens per post body, 500 tokens per comment × 5 comments = ~5.5K per post. Truncation with LLM instruction note when limits hit.

**`@redgest/mcp-server`** — Standalone MCP server built on Hono + `@hono/mcp`. Three-file architecture: `tools.ts` registers all 12 tools on an `McpServer` instance (framework-agnostic, shared across transports), `http.ts` wires Hono with `@hono/mcp`'s `StreamableHTTPTransport` for remote/production use, `stdio.ts` uses the SDK's `StdioServerTransport` for local Claude Desktop integration. Hono middleware handles bearer auth, CORS, and logging in ~5 lines. The HTTP layer is under 50 lines total. Independently deployable as a Docker container — runs on Node.js or Bun with zero code changes.

**`@redgest/email`** — React Email templates for digest delivery. Resend client wrapper. Clean typography, max-width layout, section dividers, insight callouts.

**`@redgest/slack`** — Block Kit message builder. Webhook client. Sections per subreddit, mrkdwn formatting, insight quote blocks.

**`apps/web`** — Next.js 16 config UI. Server components by default. ShadCN component library, dark mode. Minimal: subreddit manager, global settings, run history, manual trigger. Talks to `@redgest/core` directly (shared Prisma client) or via internal API routes.

**`apps/worker`** — Trigger.dev task definitions. Imports `@redgest/core` pipeline logic. Handles the actual execution of digest generation, retries, timeouts, and scheduling.

### 2.5 Data Pipeline Flow

1. Trigger fires: Trigger.dev scheduled task, MCP `generate_digest` tool call, or web UI button.
2. `GenerateDigest` command → handler creates job record (status: `queued`), emits `DigestRequested`, returns `{ jobId }`.
3. `DigestRequested` triggers Trigger.dev task (cloud in Phase 1, self-hosted in Phase 2+).
4. Reddit Fetcher pulls candidate posts (25–50 per sub) for each configured subreddit using the specified lookback period. Token bucket rate limiter at 60 req/min. For 10 subs × 3 endpoints + ~50 comment fetches, total ~80 requests, ~80 seconds at rate limit.
5. **LLM Pass 1 (Triage):** Post metadata + insight prompts sent to the LLM (~8K tokens per sub). Returns ranked list of interesting posts per sub (default: top 5).
6. Reddit Fetcher retrieves full content + top 5 comments for selected posts only.
7. **LLM Pass 2 (Summarization):** Full post content (3K token budget) + comments (500 tokens × 5) + insight prompts. ~27.5K tokens per sub for 5 posts. Returns structured summary, key takeaways, and insight notes for each post.
8. Digest Composer assembles the digest. Emits `DigestCompleted`. Projectors update read models.
9. **Delivery:** `DigestCompleted` handlers push to configured channels (email via Resend, Slack via webhook). Content also available via MCP `get_digest` and `get_post`.
10. Deduplication: posts with matching `redditId` from recent digests are skipped during triage unless explicitly re-requested.

---

## 3. MCP Server Specification

The MCP server is the primary interface. It must be comprehensive enough that all Redgest functionality is accessible conversationally through Claude, without needing the web UI.

### 3.1 Design Philosophy: Agents as Developers

The MCP API surface is designed with the same care as a public developer API. Agents are the primary consumers — their experience matters.

**Naming:** Tool names are verbs that read naturally in an agent's planning chain. `generate_digest`, not `digest_generation`. `search_posts`, not `post_search_query`.

**Descriptions:** Each tool description tells the agent *when* to use it, not just what it does. Example: `"Trigger a new digest pipeline run. Use this when the user asks for a fresh digest, wants to check new Reddit content, or says something like 'what's new on Reddit.' Returns a job ID for polling — follow up with get_run_status."` The description is part of the API contract.

**Response envelopes:** Every tool returns a consistent shape: `{ ok: boolean, data: T, error?: string }`. Agents can rely on this without per-tool parsing logic.

**Error shapes:** Errors include a machine-readable `code` (e.g., `JOB_NOT_FOUND`, `SUBREDDIT_ALREADY_EXISTS`), a human-readable `message`, and optional `details`. Agents can branch on the code; humans can read the message.

**Composability:** Tools are primitives, not god-endpoints. `generate_digest` doesn't return content — it returns a job ID. `get_digest` fetches content. `get_post` drills into a single post. The agent composes these naturally.

### 3.2 Hosting & Transport Model

**Protocol:** MCP spec version 2025-11-25. Uses **Streamable HTTP** transport — a single endpoint (`/mcp`) supporting POST, GET, and DELETE with content negotiation between `application/json` and `text/event-stream` responses. This replaced the older deprecated HTTP+SSE dual-endpoint transport.

**Production:** Standalone Hono server with `@hono/mcp`'s `StreamableHTTPTransport`. Deployed as a Docker container — runs on Node.js or Bun on any host (VPS, Fly.io, Railway, AWS/GCP/DO, bare metal). Independent of the Next.js web app. Session management via `Mcp-Session-Id` header, handled by the SDK.

**Development:** Two entry points sharing the same `tools.ts` module. `http.ts` for remote connections (same as production). `stdio.ts` for direct Claude Desktop integration via stdin/stdout — configure in Claude Desktop's MCP settings as a local subprocess.

**Auth:** Hono `bearerAuth` middleware on the `/mcp` route. Single API key in env var. `@hono/mcp` also bundles OAuth routers (`simpleMcpAuthRouter()`) for a future upgrade path if needed.

**Architecture:**

```
@redgest/mcp-server/
├── src/
│   ├── tools.ts    # registerTools(mcp: McpServer) — all 12 tools, framework-agnostic
│   ├── http.ts     # Hono app + @hono/mcp StreamableHTTPTransport + middleware
│   └── stdio.ts    # StdioServerTransport entry point for local dev
```

Tool definitions are registered once on an `McpServer` instance and shared across any transport. The HTTP framework is a swappable shell (~50 lines) around invariant business logic.

### 3.3 Tool Surface

#### Pipeline Operations

| Tool | Description (agent-facing) | Key Parameters | Returns |
|------|---------------------------|----------------|---------|
| `generate_digest` | Trigger a new digest run. Use when user wants fresh Reddit content. Returns job ID for polling. | `subreddits?` (string[], default all), `lookback?` (duration, default `24h`), `delivery?` (`none` \| `email` \| `slack` \| `all`) | `{ jobId, status: "queued" }` |
| `get_run_status` | Check if a digest run is still processing. Use after generate_digest to poll for completion. | `jobId` (required) | `{ jobId, status, progress, startedAt, completedAt?, error? }` |
| `list_runs` | See history of past digest runs. Use to find a previous digest or check what's been generated. | `status?`, `since?`, `limit?` | `{ runs: RunSummary[] }` |

#### Content Access

| Tool | Description (agent-facing) | Key Parameters | Returns |
|------|---------------------------|----------------|---------|
| `get_digest` | Fetch digest content. Use after a run completes to get the actual summaries and insights. | `jobId?` (default latest), `subreddit?` (filter) | `{ digest: DigestContent }` |
| `get_post` | Deep-dive into a specific post. Use when user wants more detail about a particular post mentioned in a digest. | `postId` or `redditUrl` | `{ post: PostDetail }` |
| `search_posts` | Search across all stored posts by keyword. Use for questions like "what did r/X say about Y." | `query`, `subreddit?`, `since?` | `{ posts: PostSummary[] }` |
| `search_digests` | Search across past digest summaries. Use for trend questions or "what happened last week." | `query`, `since?` | `{ digests: DigestSummary[] }` |

#### Configuration

| Tool | Description (agent-facing) | Key Parameters | Returns |
|------|---------------------------|----------------|---------|
| `list_subreddits` | Show all monitored subreddits and their settings. Use to see current configuration. | none | `{ subreddits: SubredditConfig[] }` |
| `add_subreddit` | Start monitoring a new subreddit. Use when user wants to add a sub to their digest. | `name`, `insightPrompt?`, `maxPosts?`, `includeNsfw?` | `{ subreddit: SubredditConfig }` |
| `remove_subreddit` | Stop monitoring a subreddit. | `name` | `{ removed: true }` |
| `update_subreddit` | Change a sub's insight prompt or settings. | `name`, fields to update | `{ subreddit: SubredditConfig }` |
| `get_config` | Show current global settings. | none | `{ config: GlobalConfig }` |
| `update_config` | Change global settings (insight prompt, lookback, LLM model, delivery defaults). | fields to update | `{ config: GlobalConfig }` |

### 3.4 Interaction Patterns

**Standard digest flow:** User asks Claude for their Reddit digest. Claude calls `generate_digest` → receives `{ jobId }` → polls `get_run_status` until `status: "completed"` → calls `get_digest` to fetch content → presents summary to user. User can then drill into specific posts via `get_post`.

**Conversational Q&A:** User asks "what did r/LocalLLaMA talk about last week regarding quantization?" Claude calls `search_posts` with keyword and subreddit filters → retrieves matching posts → synthesizes an answer from stored summaries and content.

**Configuration:** User says "add r/machinelearning and focus on reinforcement learning papers." Claude calls `add_subreddit` with the name and insight prompt → confirms addition.

---

## 4. Data Model

### 4.1 Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `subreddits` | Monitored subreddit configuration | `name`, `insightPrompt`, `maxPosts`, `includeNsfw`, `isActive`, `createdAt` |
| `config` | Global configuration (singleton) | `globalInsightPrompt`, `defaultLookback`, `defaultDelivery`, `llmProvider`, `llmModel`, `schedule` |
| `jobs` | Pipeline run records (immutable) | `id`, `status` (queued\|running\|completed\|failed\|partial), `subreddits` (JSON), `lookback`, `delivery`, `startedAt`, `completedAt`, `error` |
| `events` | Domain event log (append-only) | `id`, `type`, `payload` (JSON), `aggregateId`, `aggregateType`, `createdAt` |
| `posts` | Reddit posts with content and metadata | `id`, `redditId`, `subreddit`, `title`, `body`, `author`, `score`, `commentCount`, `url`, `permalink`, `flair`, `isNsfw`, `fetchedAt` |
| `post_comments` | Top comments per post | `id`, `postId`, `redditId`, `author`, `body`, `score`, `depth` |
| `post_summaries` | LLM-generated summaries and insights | `id`, `postId`, `jobId`, `summary`, `keyTakeaways` (JSON), `insightNotes`, `llmProvider`, `llmModel` |
| `digests` | Assembled digest content per job | `id`, `jobId`, `contentMarkdown`, `contentHtml`, `contentSlackBlocks` (JSON), `createdAt` |
| `digest_posts` | Join table: which posts are in which digest | `digestId`, `postId`, `subreddit`, `rank` |

### 4.2 Read Models (Projections)

| View | Projected From | Purpose |
|------|---------------|---------|
| `digest_view` | `digests` + `jobs` + `digest_posts` | Pre-joined digest content with run metadata. Primary read model for `get_digest`. |
| `post_view` | `posts` + `post_summaries` + `post_comments` | Denormalized post with latest summary and top comments. Primary read model for `get_post` and `search_posts`. |
| `run_view` | `jobs` + `events` (filtered) | Job status with progress info derived from event stream. Primary read model for `get_run_status`. |
| `subreddit_view` | `subreddits` + latest digest stats | Config plus last activity and post counts. Primary read model for `list_subreddits`. |

Read models are standard Postgres views. Promoted to materialized views with projector-triggered refresh only if query performance requires it.

### 4.3 Key Design Decisions

- Posts are stored independently of digests. A post can appear in multiple digests (if re-analyzed) or be queried directly.
- Summaries are linked to both a post and a job, capturing the specific LLM output for that run.
- Jobs are immutable. Re-running a digest for the same period creates a new job record. No overwrites.
- Events are append-only. The event log provides an audit trail and enables new projections without schema migrations.
- Deduplication is handled at the pipeline level: posts with a matching `redditId` from a recent digest are skipped during triage unless explicitly re-requested.
- NSFW posts are filtered at fetch time based on the per-subreddit `includeNsfw` flag (default `false`).

---

## 5. LLM Pipeline Detail

### 5.1 Provider Abstraction

LLM calls are abstracted via the Vercel AI SDK provider pattern inside `@redgest/llm`. Configuration specifies provider (`anthropic` | `openai`) and model. Both triage and summarization use frontier models by default (quality-first approach). Provider and model are configurable globally and can be overridden per-run.

### 5.2 Pass 1: Triage

**Input:** Post metadata for all candidates in a subreddit (title, score, comment count, flair, body preview truncated to ~200 chars, post age). Global insight prompt. Per-sub insight prompt (if configured). Budget: ~8K tokens per subreddit for 50 candidates.

**System prompt:** Instructs the LLM to act as a content curator. Provides the user's interest context via insight prompts. Asks the LLM to select the N most interesting/relevant posts and briefly explain why each was selected. Emphasizes relevance over raw popularity — a 40-upvote deep technical discussion may be more valuable than a 500-upvote meme.

**Output:** Structured JSON array of selected post IDs with brief selection rationale.

### 5.3 Pass 2: Summarization + Insights

**Input:** Full post body + top 5 comments (by score) for each selected post. Global + per-sub insight prompts. Token budget per post: 3K (body) + 2.5K (5 comments × 500 each) = ~5.5K. With 5 posts per sub: ~27.5K tokens per summarization call.

**System prompt:** Instructs the LLM to produce a structured summary for each post. Includes: a concise summary paragraph, key takeaways as a list, insight notes connecting the post to the user's stated interests, and notable comment highlights (corrections, counterpoints, valuable links).

**Output:** Structured JSON per post: `{ summary, keyTakeaways[], insightNotes, commentHighlights[] }`.

**Tone:** Technical briefing — dense, actionable, no fluff. Shaped by the user's insight prompts.

**Truncation:** When post body or comments exceed token budgets, content is truncated and a note is appended to the LLM context: "Body truncated at [N] tokens. Weight comments and metadata more heavily for this post."

### 5.4 Non-Determinism

LLM-driven selection is inherently non-deterministic. The same candidate set may yield different selections across runs. This is acceptable for a personal digest tool and is documented here as a known characteristic, not a bug. Temperature is set to a low-but-nonzero value (e.g., 0.3) to balance consistency with the ability to surface novel connections.

---

## 6. Job Orchestration (Trigger.dev v4)

### 6.1 Why Trigger.dev

Trigger.dev v4 provides durable task execution with retries, scheduling, observability, and self-hosting via Docker — all without building custom job infrastructure. It manages both the queue and the compute, enabling long-running tasks without timeout constraints.

Key capabilities used by Redgest: scheduled tasks (replaces cron), manual task triggering (from MCP and web UI), retry policies with backoff, task status polling, and the Prisma v7 extension for database access within tasks.

### 6.2 Phased Deployment

**Phase 1:** Trigger.dev Cloud (free tier). Zero ops, focus on core pipeline logic. The SDK interface is identical between cloud and self-hosted — no code changes required for migration.

**Phase 2+:** Self-hosted Trigger.dev v4 via Docker Compose on cloud instances (AWS/GCP/DO). Added to the Redgest `docker-compose.yml` alongside Postgres and the MCP server. Full control, no external SaaS dependency.

### 6.3 Task Definitions

Tasks live in `apps/worker/` and import pipeline logic from `@redgest/core`:

- **`digest.generate`** — Main pipeline task. Receives `GenerateDigest` command payload. Orchestrates Reddit fetching → LLM triage → LLM summarization → digest assembly → delivery. Emits domain events at each stage. Updates job status.
- **`digest.schedule`** — Recurring scheduled task. Fires `GenerateDigest` with default config at configured intervals.
- **`digest.deliver`** — Delivery task. Triggered by `DigestCompleted` event. Sends email and/or Slack based on configuration.
- **`maintenance.cleanup`** — Periodic cleanup. Prunes old events, updates materialized views, etc.

---

## 7. Delivery Channels

### 7.1 Email (Resend + React Email)

Template uses React Email components. Clean typography with a max-width container, system sans-serif font stack, subtle section dividers between subreddits, post titles as styled links, light background color on insight callout blocks, and a minimal header ("Redgest" + date range). No hero images, no heavy design. Looks good in both light and dark email clients.

### 7.2 Slack (Incoming Webhook)

Digest rendered as Slack Block Kit message. Sections per subreddit with mrkdwn formatting. Post titles as links, summaries as text blocks, insight notes in a quote block. Webhook URL configured via environment variable. Channel-bound.

### 7.3 MCP (Primary)

Digest content returned as structured markdown via `get_digest`. Claude can present this conversationally, drill into individual posts, or answer follow-up questions. This is the richest interaction mode — email and Slack are push-only snapshots.

---

## 8. Configuration UI

Minimal Next.js 16 web interface. Exists for initial setup and visual configuration management. Not the primary interaction surface.

### 8.1 Screens

- **Subreddit Manager:** Add/remove/edit monitored subreddits. Edit per-sub insight prompts. Toggle active/inactive. Set per-sub max posts. Toggle NSFW inclusion.
- **Global Settings:** Global insight prompt editor. Default lookback period. LLM provider and model selection. Default delivery channels. Schedule configuration.
- **Run History:** Table of past pipeline runs. Status, duration, post counts, errors. Link to view digest output.
- **Manual Trigger:** Button to trigger an on-demand run with optional parameter overrides.

### 8.2 Design

ShadCN component library as the base. Minimal, functional, dark mode default. Server components by default. No polish beyond what ShadCN provides out of the box — this is a config panel, not a product.

---

## 9. Acceptance Criteria

### 9.1 Core Pipeline

- Given configured subreddits and a lookback period, when a digest run is triggered, then the system fetches candidate posts from Reddit, selects relevant posts via LLM triage, generates summaries with insights, and persists the digest.
- Given a digest run with 10 configured subreddits, the pipeline completes within 5 minutes (including LLM calls and ~80s rate-limited Reddit fetching).
- Given Reddit API rate limits of 60 req/min, the token bucket in `@redgest/reddit` never exceeds the limit.
- Given a post that appeared in the previous digest, it is skipped in the current run unless the user explicitly requests re-analysis.
- Given a partial failure (e.g., one subreddit fetch fails), the pipeline completes for remaining subs and marks the job as `partial` with error details.

### 9.2 MCP Server

- Given a `generate_digest` call, the server returns `{ ok: true, data: { jobId, status: "queued" } }` within 2 seconds.
- Given a `jobId`, `get_run_status` returns current status, progress, and timing in the standard response envelope.
- Given a completed digest, `get_digest` returns structured markdown content filterable by subreddit.
- Given a post ID or Reddit URL, `get_post` returns the full stored post content, comments, summary, and insight notes.
- Given a search query, `search_posts` and `search_digests` return relevant results from historical data.
- All MCP endpoints require a valid API key. Requests without a key return `{ ok: false, error: { code: "UNAUTHORIZED", message: "..." } }`.
- All tool responses follow the `{ ok, data, error }` envelope. No exceptions.
- The Streamable HTTP endpoint (`/mcp`) correctly handles POST (tool calls), GET (SSE stream for server-initiated messages), and DELETE (session termination) per MCP spec 2025-11-25.

### 9.3 CQRS

- Commands are the only write path. No direct database mutations outside command handlers.
- All state changes emit domain events to the event log.
- Read models are eventually consistent with the write side (acceptable lag: < 1 second for projections).
- Adding a new read model requires only a new projector — no changes to the write path.

### 9.4 Delivery

- Given delivery set to `email`, the digest is sent via Resend with the React Email template and arrives within 1 minute of job completion.
- Given delivery set to `slack`, a Block Kit message is posted to the configured webhook URL.
- Given delivery set to `none` (MCP-only run), no email or Slack message is sent.

### 9.5 Edge Cases

- A subreddit has zero posts in the lookback period: skip it, note in digest.
- Reddit API is down: retry once after 30 seconds, then fail the subreddit with error logged on the job.
- LLM API is down: retry once, then fail the job entirely (no digest without intelligence).
- A subreddit is private or banned: log error, skip, continue with remaining subs.
- Post body is empty (link post): use title + destination URL + comment content for summarization.
- Post body exceeds 3K token budget: truncate with LLM note to weight comments more heavily.
- Configured subreddit list is empty: return an error, do not run the pipeline.
- Trigger.dev is unavailable: `generate_digest` returns an error. Scheduled runs are missed and retried on recovery.
- NSFW post encountered on a sub with `includeNsfw: false`: filtered at fetch time, never reaches LLM.

---

## 10. Implementation Phases

### Phase 1: Core Pipeline + MCP

Minimum viable product. Reddit fetching, LLM pipeline, Postgres persistence, CQRS infrastructure, MCP server with all 12 tools. Manual trigger only (no scheduling). No email/Slack delivery. Trigger.dev Cloud for task execution.

- TurboRepo scaffolding with all packages
- `@redgest/db`: Prisma v7 schema, migrations, client generation
- `@redgest/core`: CQRS infrastructure (command bus, in-process event bus, projectors), pipeline orchestration
- `@redgest/reddit`: Reddit API client with token bucket rate limiter, `ContentSource` interface
- `@redgest/llm`: Provider abstraction, triage + summarization prompts, token budgeting
- `@redgest/mcp-server`: Hono + `@hono/mcp`, all 12 tools, agent-first descriptions, standard response envelopes, `tools.ts` / `http.ts` / `stdio.ts` architecture
- Docker Compose for local dev (Postgres + MCP server)
- Trigger.dev Cloud integration
- Deduplication logic

### Phase 2: Scheduling + Delivery + Self-Hosted Jobs

Add Trigger.dev self-hosted, scheduling, and push delivery channels.

- Trigger.dev v4 self-hosted in Docker Compose (cloud → self-hosted migration)
- Scheduled digest runs (`digest.schedule` task)
- Event bus extraction (in-process → Postgres NOTIFY or Redis, if needed for cross-process communication)
- `@redgest/email`: React Email templates + Resend integration
- `@redgest/slack`: Block Kit formatting + webhook
- Delivery channel selection per-run

### Phase 3: Config UI

Minimal web configuration interface.

- `apps/web`: Next.js 16, ShadCN, server components
- Subreddit manager, global settings, run history, manual trigger
- Dark mode default

### Phase 4: Search + History

Enrich the historical query capabilities.

- Full-text search across posts and digests (`pg_trgm` + GIN indexes, likely)
- `search_posts` and `search_digests` MCP tools fully operational
- Conversational Q&A support (Claude can answer questions about past content)
- Run history UI with digest viewer

---

## 11. Architecture Decision Registry

> **ADR-001: Single-User Personal Tool**
> **Decision:** No multi-tenancy, no user auth system.
> **Rationale:** Reduces complexity. No user management, row-level security, or billing.
> **Tradeoff:** Retrofitting auth later if sharing is desired. Acceptable.

> **ADR-002: MCP Server as Primary Interface**
> **Decision:** MCP is the first-class delivery and interaction mechanism.
> **Rationale:** Enables conversational interaction with digests via Claude. Email/Slack are push-only.
> **Tradeoff:** MCP is pull-based; still need push channels for scheduled delivery.

> **ADR-003: Configurable LLM Provider**
> **Decision:** Abstract LLM calls via Vercel AI SDK provider pattern. Support Claude + OpenAI.
> **Rationale:** Model landscape moves fast. Swap for cost/quality/speed as needed.

> **ADR-004: Postgres with Prisma v7** *(supersedes v1: Drizzle ORM)*
> **Decision:** Postgres for all persistence. Prisma v7 as ORM (Rust-free, ESM-native, `prisma.config.ts`).
> **Rationale:** Prisma v7 eliminates the Rust engine, resulting in faster queries and smaller bundles. Type-safe generated client covers 95%+ of query needs. `$queryRaw` available for the rest. Drizzle rejected due to frequent need for raw SQL deep in the stack.

> **ADR-005: Trigger.dev v4 for Job Orchestration** *(supersedes v1: Vercel Cron)*
> **Decision:** Use Trigger.dev v4 for durable task execution, scheduling, and retries. Cloud in Phase 1, self-hosted Docker in Phase 2+.
> **Rationale:** Provides durable execution, retry policies, scheduling, and observability without building custom infrastructure. Self-hostable aligns with local-first principle. First-class Prisma v7 support.
> **Tradeoff:** Additional Docker service in the stack (Phase 2). Cloud free tier covers Phase 1.

> **ADR-006: LLM-Driven Post Selection**
> **Decision:** Fetch broad candidate set, let LLM select interesting posts guided by insight prompts.
> **Rationale:** Relevance > raw popularity. A 40-upvote technical discussion may beat a 500-upvote meme.
> **Risk:** Non-deterministic. Same inputs may yield different selections across runs.

> **ADR-007: Two-Tier LLM Pipeline**
> **Decision:** Pass 1 (triage) on metadata, Pass 2 (summarization) on full content + comments.
> **Rationale:** Avoids sending 50 full posts to the LLM. Triage on metadata, go deep on winners.

> **ADR-008: Post + Top Comments Summarization**
> **Decision:** Fetch top 5 comments by score per selected post.
> **Rationale:** Reddit's value is often in the comments — corrections, counterpoints, links.

> **ADR-009: Global + Per-Sub Insight Prompts**
> **Decision:** Global prompt for general interests + per-sub overrides that layer on top.
> **Implementation:** Concatenate global + per-sub at runtime. Per-sub inherits global if no override.

> **ADR-010: Resend for Email Delivery**
> **Decision:** Resend for transactional digest emails.
> **Rationale:** React Email support, 100 emails/day free, good DX.

> **ADR-011: Slack Incoming Webhook**
> **Decision:** Incoming webhook, not a full Slack app.
> **Rationale:** Push-only digest delivery. No bot interactivity needed.
> **Tradeoff:** Channel-bound. No DMs. Retrofit to Slack app if interactive features needed later.

> **ADR-013: Quality-First LLM Strategy**
> **Decision:** Use frontier models for both triage and summarization. No cost ceiling.
> **Rationale:** Personal tool, small scale, quality is the point.

> **ADR-014: Job-Based Digest Pipeline**
> **Decision:** `generate_digest` always returns a job ID immediately. Pipeline runs async.
> **Rationale:** Uniform API. Decouples trigger from execution. No timeout risk.

> **ADR-015: MCP Returns Job References, Not Content**
> **Decision:** `generate_digest` returns `{ jobId, status }`. Content fetched separately.
> **Rationale:** Keeps MCP responses small. Avoids blowing up context windows.

> **ADR-016: Post-Level Access via MCP**
> **Decision:** Individual posts are first-class entities, queryable by ID, URL, subreddit, or keyword.
> **Rationale:** Enables conversational drill-down and Q&A about specific posts.

> **ADR-017: Project Named Redgest**
> **Decision:** Reddit + Digest = Redgest. Repo: `redgest`.

> **ADR-019: Immutable Runs**
> **Decision:** Every run creates a new record. No overwrites.
> **Rationale:** Simpler to reason about, enables comparison across runs.

> **ADR-020: MCP Auth via API Key**
> **Decision:** Hono `bearerAuth` middleware on the `/mcp` route. Single API key in env var.
> **Rationale:** Single user, personal tool. Sufficient security. `@hono/mcp` bundles OAuth routers for future upgrade path.

> **ADR-021: Clean React Email Template**
> **Decision:** React Email with intentional typography, light structure, insight callouts.
> **Rationale:** Worth the effort for a daily-read digest.

> **ADR-022: Local-First, Vendor-Agnostic Deployment**
> **Decision:** No platform lock-in. Docker Compose for local dev. Every component runs on any infrastructure that supports Node.js and Postgres. Deploy targets (AWS, GCP, DO, Fly.io, Railway, bare metal) are a runtime decision.
> **Rationale:** Avoids vendor lock-in during development. Local development has full parity with production.
> **Supersedes:** ADR-012 (Vercel Pro Tier).

> **ADR-023: TurboRepo Monorepo**
> **Decision:** TurboRepo monorepo from day one. Separate packages for each domain concern.
> **Rationale:** Clean dependency graphs, independent builds, package-level testing. Any package can be extracted as a standalone OSS library.

> **ADR-024: CQRS Architecture (Without Event Sourcing)**
> **Decision:** Full CQRS. Commands are the only write path. All state changes emit domain events. Queries read from standard Postgres views. Events stored in Postgres (append-only log), not used to rebuild state.
> **Rationale:** Formalizes the natural async separation. Gives clean boundaries, testability, audit trail, and the ability to add new read models without touching the write path.
> **Tradeoff:** More infrastructure code upfront (command bus, event bus, projectors). Worth it.
> **Explicitly not:** Full event sourcing. State is not rebuilt from events.

> **ADR-025: MCP Server as Standalone Hono Service**
> **Decision:** MCP server is a standalone Hono application. Not embedded in Next.js. Independently deployable as a Docker container on Node.js or Bun.
> **Rationale:** Next.js is a web framework; MCP is a protocol server. Different concerns, different deployment targets. Hono's ~14KB footprint produces minimal Docker images with sub-second cold starts. Native Bun support means zero code changes if runtime is switched later.
> **Supersedes:** ADR-018 (Vercel-hosted SSE endpoint).

> **ADR-026: Agent-First MCP API Design**
> **Decision:** MCP tool surface designed with agents as the primary consumer. Consistent response envelopes (`{ ok, data, error }`), machine-readable error codes, composable primitives over monolithic endpoints, and tool descriptions that tell agents *when* to use each tool.
> **Rationale:** Treat agents as developers interacting with your API. Their experience matters.

> **ADR-027: Trigger.dev Cloud First, Self-Host in Phase 2**
> **Decision:** Start with Trigger.dev Cloud (free tier) in Phase 1. Migrate to self-hosted Docker in Phase 2.
> **Rationale:** Phase 1 focus is core pipeline + MCP. Cloud eliminates ops overhead. SDK interface is identical — migration is a config change, not a code change.

> **ADR-028: Hono as MCP Server Framework**
> **Decision:** Hono + `@hono/mcp` for the MCP server's HTTP layer. MCP SDK (`@modelcontextprotocol/sdk`) for protocol handling, Streamable HTTP transport via `@hono/mcp`'s `StreamableHTTPTransport`, stdio via SDK's `StdioServerTransport`.
> **Rationale (spike results):** Hono scored 29/30 vs. 25/30 for both SDK-bare and Fastify. Key advantages: (1) Dual official adapter support from both the Hono team (`@hono/mcp`) and the MCP SDK team (`@modelcontextprotocol/hono`) — unique among frameworks. (2) Best middleware composition (bearerAuth, cors, logger as one-liners). (3) ~14KB bundle, sub-second Docker cold starts. (4) Native Bun support with zero code changes. (5) FastMCP (3K GitHub stars) uses Hono internally, validating the choice. (6) Vercel maintains an official Hono MCP server template.
> **Alternatives rejected:** SDK bare HTTP (25/30 — no middleware story, manual boilerplate for every HTTP concern). Fastify (25/30 — no official MCP SDK adapter, Bun officially unsupported, ~2MB dependency footprint, JSON Schema mismatch with Zod-based MCP SDK).
> **Migration cost if wrong:** Low. Tool definitions in `tools.ts` are framework-agnostic. Swapping the HTTP shell is ~4-6 hours of work. The `McpServer` instance and all 12 tools port unchanged.
> **Supersedes:** ADR-028 v1 (spike required).

> **ADR-029: In-Process Event Bus, Extract Later**
> **Decision:** In-process typed EventEmitter for Phase 1. Interface designed for extraction to Postgres LISTEN/NOTIFY or Redis pub/sub when services split across processes.
> **Rationale:** Single-process in Phase 1. Zero infrastructure, trivially testable. The contract (`emit`, `on`) is transport-agnostic — extraction is a one-file swap.
> **Trigger for extraction:** When MCP server and worker run as separate processes (Phase 2+).

> **ADR-030: Token Bucket Rate Limiter for Reddit API**
> **Decision:** Token bucket algorithm in `@redgest/reddit`, 60 tokens/min. Each API call costs 1 token. Pipeline accepts ~80s fetch time for 10 subs.
> **Rationale:** Reddit's rate limit is 60 req/min for script apps. Token bucket is simple, proven, and handles burst + sustained load.

> **ADR-031: Standard Postgres Views for Read Models**
> **Decision:** Read models are standard Postgres views, not materialized. Promote to materialized views only if performance requires it.
> **Rationale:** Single-user tool with low query volume. Standard views are fast enough and zero maintenance.

> **ADR-032: Reddit ContentSource Interface for Swappability**
> **Decision:** `@redgest/reddit` implements a `ContentSource` interface. Reddit API client is the default implementation.
> **Rationale:** Reddit API deprecation is a known risk. Clean interface means swapping to an alternative is an implementation change, not an architectural one.

> **ADR-033: LLM Token Budgets**
> **Decision:** Hard token budgets per component. Triage: ~8K per sub (50 candidates). Summarization: 3K per post body, 500 per comment × 5 = ~5.5K per post, ~27.5K per sub. Truncation with explicit LLM note.
> **Rationale:** Predictable costs, prevents context window overflow, works within any frontier model's limits.

---

## 12. Resolved Questions Log

All open questions from the design process have been resolved. Decisions are captured in the ADR registry above.

| # | Question | Resolution | ADR |
|---|----------|-----------|-----|
| 1 | Reddit API rate limiting strategy | Token bucket, 60 tokens/min, ~80s for 10 subs | ADR-030 |
| 2 | CQRS projection strategy | Standard Postgres views, promote to materialized if slow | ADR-031 |
| 3 | Full-text search implementation | Deferred to Phase 4. Lean toward `pg_trgm` + GIN indexes. | — |
| 4 | NSFW handling | `includeNsfw` boolean per sub, default false, filter at fetch | — |
| 5 | Reddit API deprecation risk | Accept risk, design `ContentSource` interface for swappability | ADR-032 |
| 6 | Trigger.dev self-hosting resources | Cloud instances (AWS/GCP/DO), adequate for self-hosted v4 | ADR-027 |
| 7 | LLM context window management | Hard token budgets, truncation with LLM note | ADR-033 |
| 8 | MCP server framework | Hono + `@hono/mcp`. Scored 29/30 in spike. | ADR-028 |
| 9 | Event bus implementation | In-process EventEmitter, extract later | ADR-029 |
| 10 | Trigger.dev cloud vs. self-hosted | Cloud Phase 1, self-host Phase 2 | ADR-027 |
