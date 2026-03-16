# Redgest

A personal Reddit digest engine. Monitors configured subreddits, uses a three-pass LLM pipeline to identify and curate relevant posts based on custom "insight prompts," generates structured summaries with channel-specific editorial prose, and delivers curated digests via email, Slack, or MCP.

**MCP-first architecture** — Claude (or any MCP client) is the primary consumer via 32 tools. Full-text and vector search, trending topic tracking, digest profiles, and delivery channel management are all built in.

## How It Works

```
1. Configure subreddits + insight prompts (what you care about)
2. Generate a digest (manual or scheduled)
   ├── Fetch: hot/top/rising posts + comments from Reddit
   ├── Triage: LLM ranks all posts across subreddits by relevance
   ├── Summarize: LLM generates structured summaries per selected post
   └── Assemble: persist digest, extract topics, generate embeddings
3. Deliver via email/Slack (LLM generates channel-specific editorial prose)
4. Read the digest, search history, track trends
```

Global cross-subreddit triage — posts from all subreddits compete in a single ranking pass, so the best content surfaces regardless of source. Two-pass LLM pipeline with token budgeting, deduplication across runs, and per-post error recovery.

## Quick Start

### Prerequisites

- Node.js >= 20.9
- pnpm 10.x
- Docker (for Postgres + Redis)
- Reddit API credentials ([create a script app](https://www.reddit.com/prefs/apps))
- Anthropic API key

### Setup

```bash
# Clone and install
git clone https://github.com/medelman17/redgest.git
cd redgest
pnpm install

# Start Postgres + Redis
docker compose up postgres redis -d
# Postgres on port 5433 (not 5432) to avoid local conflicts

# Configure environment
cp .env.example .env
# Edit .env with your API credentials

# Generate Prisma client + run migrations + seed
pnpm turbo db:generate
pnpm --filter @redgest/db exec prisma migrate deploy
pnpm --filter @redgest/db exec tsx prisma/seed.ts
```

### Run the MCP Server

**HTTP** (Streamable HTTP transport — production):
```bash
npx tsx packages/mcp-server/src/http.ts
# Server on http://localhost:3100 with /health endpoint
```

**stdio** (Claude Desktop / Claude Code):
```bash
npx tsx packages/mcp-server/src/stdio.ts
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "redgest": {
      "command": "npx",
      "args": ["tsx", "packages/mcp-server/src/stdio.ts"],
      "cwd": "/path/to/redgest",
      "env": {
        "DATABASE_URL": "postgresql://redgest:redgest@localhost:5433/redgest",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "REDDIT_CLIENT_ID": "...",
        "REDDIT_CLIENT_SECRET": "..."
      }
    }
  }
}
```

### Docker Compose

Run everything (Postgres + Redis + MCP server):

```bash
docker compose up -d
```

## MCP Tools (32)

### Digest Generation & Retrieval

| Tool | Description |
|------|-------------|
| `generate_digest` | Start a digest run (optional: profile, subreddits, lookback, max_posts) |
| `get_run_status` | Check progress with per-step breakdown and timing |
| `get_digest` | Get a digest by ID or latest |
| `list_digests` | List recent digests (cursor pagination) |
| `list_runs` | List recent runs with status |
| `cancel_run` | Cancel an in-progress run |
| `preview_digest` | Preview rendered digest (markdown, email, or Slack format) |

### Search & Analytics

| Tool | Description |
|------|-------------|
| `search_posts` | Full-text search across post summaries |
| `search_digests` | Full-text search across digests |
| `find_similar` | Find semantically similar posts (vector search) |
| `ask_history` | Natural language search over digest history (hybrid text+vector) |
| `get_trending_topics` | View trending topics by frequency and recency |
| `compare_periods` | Compare two time periods for volume and topic changes |
| `compare_digests` | Compare two digests for new/dropped posts and overlap |

### Subreddit Management

| Tool | Description |
|------|-------------|
| `list_subreddits` | List all monitored subreddits |
| `add_subreddit` | Add a subreddit with optional insight prompt |
| `remove_subreddit` | Remove a monitored subreddit |
| `update_subreddit` | Update settings (prompt, max posts, crawl interval) |
| `get_subreddit_stats` | Per-subreddit metrics and utilization |
| `get_crawl_status` | Crawl health: last/next crawl, post counts, errors |

### Digest Profiles

| Tool | Description |
|------|-------------|
| `list_profiles` | List all digest profiles |
| `get_profile` | Get a specific profile by name or ID |
| `create_profile` | Create a profile (groups subreddits + schedule + delivery) |
| `update_profile` | Update profile settings |
| `delete_profile` | Delete a profile (cannot delete Default) |

### Configuration & Observability

| Tool | Description |
|------|-------------|
| `get_config` | View global configuration |
| `update_config` | Update global settings |
| `get_llm_metrics` | LLM usage: tokens, latency, cache hit rate |
| `get_delivery_status` | Email/Slack delivery status per digest |
| `check_reddit_connectivity` | Reddit API status, auth type, rate limiter state |
| `get_post` | Get a specific post summary |
| `use_redgest` | Usage guide for all tools |

All tools return a consistent envelope: `{ ok, data?, error?: { code, message } }`.

## Architecture

**CQRS without event sourcing.** Commands mutate state and emit domain events to an append-only Postgres event log. Queries read from optimized SQL views. Events trigger async jobs via Trigger.dev but are not used to rebuild state.

```
packages/
  config/       # Zod-validated environment config
  db/           # Prisma v7 schema, client, 11 migrations, 6 SQL views
  core/         # CQRS (9 commands, 21 queries, 16 events), pipeline orchestration
  reddit/       # Reddit API client, token bucket rate limiter, content sanitization
  llm/          # AI SDK wrapper, prompts, token budgets, Redis cache, embeddings
  mcp-server/   # Hono MCP server (32 tools, HTTP + stdio transports)
  email/        # React Email digest templates + Resend integration
  slack/        # Block Kit digest formatter + webhook delivery
apps/
  web/          # Next.js 16 config UI
  worker/       # Trigger.dev tasks (5 tasks: digest gen/deliver/schedule + crawl/schedule)
```

**Dependency graph:** `mcp-server` → `core` → `db`, `reddit`, `llm`. `worker` → `core`, `llm`, `email`, `slack`. No circular dependencies.

### Data Model (15 tables, 6 views)

**Core:** `subreddits` (with crawl scheduling), `config` (singleton), `jobs` (immutable run records), `events` (append-only log)

**Content:** `posts` (with tsvector FTS + pgvector embeddings + score_delta), `post_comments`, `post_summaries` (structured LLM output + embeddings)

**Digests:** `digests` (markdown/HTML/Slack blocks), `digest_posts` (ranked join table), `deliveries` (email/Slack delivery tracking)

**Profiles:** `digest_profiles` (named configurations), `digest_profile_subreddits` (profile↔subreddit join)

**Analytics:** `topics` (extracted trending topics), `post_topics` (post↔topic join), `llm_calls` (per-call usage logging)

**Views:** `digest_view`, `post_view`, `run_view`, `subreddit_view`, `profile_view`, `delivery_view`

### LLM Pipeline

Three-pass with token budgeting and global triage:

1. **Triage** (~8K tokens) — Post metadata + insight prompts → LLM ranks all posts across all subreddits in a single pass, selects top N by relevance
2. **Summarization** (~9.7K tokens/post) — Full content + comments → structured summary with key takeaways, insight notes, sentiment, and comment highlights
3. **Delivery Prose** — Per-channel editorial prose generation (email gets detailed narratives, Slack gets concise summaries) with headline + per-subreddit body

Features:
- Global cross-subreddit ranking (best posts surface regardless of source)
- Deduplication across last 3 digests
- Comments-first truncation when over budget
- Per-subreddit and per-post error recovery (COMPLETED / PARTIAL / FAILED)
- Topic extraction and embedding generation post-summarization
- Optional Redis cache (2h triage, 7d summaries)
- Structured logging of all LLM calls to `llm_calls` table

### Delivery Channels

Each channel receives LLM-generated editorial prose tailored to its format via `generateDeliveryProse()`, then merged with structured data via `buildFormattedDigest()`.

- **Email** — React Email templates + Resend. Detailed multi-paragraph narratives. Requires `RESEND_API_KEY` + `DELIVERY_EMAIL`.
- **Slack** — Block Kit formatting + webhook. Concise editorial summaries. Requires `SLACK_WEBHOOK_URL`.
- **MCP** — Read digests directly via `get_digest` / `search_digests` / `ask_history`.

Delivery is tracked per-digest in the `deliveries` table. Check status with `get_delivery_status`.

### Digest Profiles

Profiles group subreddits with their own schedule, lookback window, max posts, and delivery channel. A Default profile is auto-created from global config.

```
create_profile("AI Research", subreddits: ["MachineLearning", "LocalLLaMA"],
               schedule: "0 8 * * 1", lookbackHours: 168, delivery: "EMAIL")
```

### Trigger.dev Integration

Five async tasks:
- **`generate-digest`** — Wraps the full pipeline. Retry: 2 attempts.
- **`deliver-digest`** — Generates per-channel LLM prose, merges with structured data, dispatches to email/Slack. Retry: 3 attempts.
- **`scheduled-digest`** — Cron-based (`DIGEST_CRON`, default `0 7 * * *`).
- **`crawl-subreddit`** — Crawls a single subreddit independently. Retry: 3 attempts.
- **`scheduled-crawl`** — Cron-based (`*/5 * * * *`), triggers crawls for subreddits past their `nextCrawlAt`.

**Conditional dispatch:** If `TRIGGER_SECRET_KEY` is set, jobs dispatch to Trigger.dev Cloud. Otherwise, the pipeline runs in-process — no external dependencies needed for local use.

## Development

```bash
# Install dependencies
pnpm install

# Generate Prisma client (must run before build/dev)
pnpm turbo db:generate

# Run all tests (627 across 60 test files)
pnpm test

# Lint + typecheck + test (all packages)
pnpm check

# Build all packages
pnpm turbo build

# Single package tests
pnpm turbo test --filter=@redgest/core

# Specific test file
pnpm --filter @redgest/core exec vitest run src/path/to/test.ts

# Database migrations
pnpm --filter @redgest/db exec prisma migrate dev      # Dev: create + apply
pnpm --filter @redgest/db exec prisma migrate deploy    # CI: apply pending
```

**Pre-commit hook** runs `pnpm lint && pnpm typecheck && pnpm test`. All three must pass.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | TurboRepo 2.x, pnpm workspaces |
| Language | TypeScript 5.9 (strict, ESM-only, `noUncheckedIndexedAccess`) |
| Database | PostgreSQL 16 + Prisma v7 + pgvector + tsvector |
| MCP Server | Hono + `@hono/mcp` (Streamable HTTP / stdio) |
| LLM | Vercel AI SDK v6, Anthropic Claude Sonnet 4 |
| Job Queue | Trigger.dev v4 Cloud (optional — in-process fallback) |
| Web UI | Next.js 16 + React 19 + ShadCN/ui + Tailwind v4 |
| Email | React Email + Resend |
| Slack | Block Kit + webhook |
| Cache | Redis 7 (optional, for LLM response caching) |
| Testing | Vitest 4 (627 tests across 60 files) |

## Environment Variables

See [`.env.example`](.env.example) for all options.

**Required:**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key for LLM pipeline |
| `REDDIT_CLIENT_ID` | Reddit script app client ID |
| `REDDIT_CLIENT_SECRET` | Reddit script app client secret |

**Optional:**

| Variable | Description |
|----------|-------------|
| `MCP_SERVER_API_KEY` | Bearer token for HTTP transport (min 32 chars) |
| `MCP_SERVER_PORT` | MCP server port (default: 3100) |
| `REDIS_URL` | Redis for LLM response caching |
| `RESEND_API_KEY` | Resend API key for email delivery |
| `DELIVERY_EMAIL` | Recipient email for digests |
| `SLACK_WEBHOOK_URL` | Slack webhook for digest delivery |
| `TRIGGER_SECRET_KEY` | Trigger.dev secret (omit for in-process fallback) |
| `OPENAI_API_KEY` | OpenAI API key (fallback LLM provider) |
| `DIGEST_CRON` | Scheduled digest cron (default: `0 7 * * *`) |

## License

Private project.
