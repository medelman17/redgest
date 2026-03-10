# Redgest

A personal Reddit digest engine. Monitors configured subreddits, uses an LLM pipeline to identify relevant posts based on custom "insight prompts," generates structured summaries, and delivers curated digests.

**MCP-first architecture** -- Claude (or any MCP client) is the primary consumer via 15 tools.

## How It Works

```
add_subreddit("typescript", insightPrompt: "new language features and compiler improvements")
  -> generate_digest()
    -> Fetch posts from Reddit (hot/top/rising + comments)
    -> Triage: LLM selects the most relevant posts
    -> Summarize: LLM generates structured summaries per post
    -> Assemble: persist digest to Postgres
  -> get_digest()
    -> curated digest with summaries, key takeaways, and insight notes
```

Two-pass LLM pipeline with token budgeting, deduplication across runs, and per-post error recovery.

## Quick Start

### Prerequisites

- Node.js >= 20.9.0
- pnpm 10.x
- PostgreSQL 16+
- Reddit API credentials ([create a script app](https://www.reddit.com/prefs/apps))
- Anthropic API key

### Setup

```bash
# Clone and install
git clone https://github.com/medelman17/redgest.git
cd redgest
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start Postgres (or use Docker)
docker compose up postgres -d

# Run migrations and generate Prisma client
pnpm db:generate
pnpm --filter @redgest/db exec prisma migrate deploy

# Seed the database
pnpm --filter @redgest/db exec tsx prisma/seed.ts
```

### Run the MCP Server

**stdio** (for Claude Desktop / Claude Code):
```bash
npx tsx packages/mcp-server/src/stdio.ts
```

**HTTP** (Streamable HTTP transport):
```bash
npx tsx packages/mcp-server/src/http.ts
# Server starts on port 3100
```

### Claude Desktop Configuration

Add to your Claude Desktop MCP config:

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
        "REDDIT_CLIENT_SECRET": "...",
        "MCP_SERVER_API_KEY": "your-secret-key-min-32-chars"
      }
    }
  }
}
```

### Docker Compose

Run everything (Postgres + MCP server):

```bash
docker compose up -d
```

The MCP server is available at `http://localhost:3100` with a `/health` endpoint.

## MCP Tools

| Tool | Description |
|------|-------------|
| `use_redgest` | Usage guide for all tools |
| `generate_digest` | Start a new digest run |
| `get_run_status` | Check progress of a digest run |
| `list_runs` | List recent digest runs |
| `get_digest` | Get a digest by ID (or latest) |
| `get_post` | Get a specific post summary |
| `list_digests` | List recent digests |
| `search_posts` | Search across post summaries |
| `search_digests` | Search across digests |
| `list_subreddits` | List monitored subreddits |
| `add_subreddit` | Add a subreddit to monitor |
| `remove_subreddit` | Remove a monitored subreddit |
| `update_subreddit` | Update subreddit settings |
| `get_config` | View global configuration |
| `update_config` | Update global configuration |

All tools return a consistent envelope: `{ ok: boolean, data?: T, error?: { code, message } }`.

## Architecture

**CQRS without event sourcing.** Commands mutate state and emit domain events to an append-only Postgres event log. Queries read from optimized SQL views.

```
packages/
  config/       # Zod-validated environment config
  db/           # Prisma v7 schema, client, migrations, SQL views
  core/         # CQRS commands/queries/events, pipeline orchestration
  reddit/       # Reddit API client, token bucket rate limiter
  llm/          # AI SDK wrapper, prompts, token budgets, Redis cache
  mcp-server/   # Hono MCP server (tools, HTTP, stdio transports)
  email/        # (Phase 2) React Email templates
  slack/        # (Phase 2) Block Kit formatting
apps/
  web/          # (Phase 3) Next.js config UI
  worker/       # (Phase 2) Trigger.dev task definitions
```

**Dependency graph:** `mcp-server` -> `core` -> `db`, `reddit`, `llm`

### Data Model

8 tables, 4 SQL views:

- **subreddits** -- monitored subreddits with insight prompts
- **config** -- singleton global settings
- **jobs** -- immutable run records (QUEUED -> RUNNING -> COMPLETED/PARTIAL/FAILED)
- **events** -- append-only domain event log
- **posts**, **post_comments** -- fetched Reddit content
- **post_summaries** -- LLM-generated structured summaries
- **digests**, **digest_posts** -- assembled digests

Views: `digest_view`, `post_view`, `run_view`, `subreddit_view`

### LLM Pipeline

Two-pass with token budgeting:

1. **Triage** (~8K tokens/sub) -- post metadata + insight prompts -> ranked selection
2. **Summarization** (~9.7K tokens/post) -- full content + comments -> structured summary with key takeaways, insight notes, and comment highlights

Features:
- Deduplication across last 3 digests
- Comments-first truncation when over budget
- Per-subreddit and per-post error recovery
- Optional Redis cache (2h triage, 7d summaries)
- Structured logging of all LLM calls

## Development

```bash
# Run all tests (319 unit tests)
pnpm test

# Run E2E and integration tests (requires Postgres)
pnpm test:e2e

# Lint and typecheck
pnpm lint
pnpm typecheck

# All checks
pnpm check

# Single package tests
pnpm turbo test --filter=@redgest/core

# Specific test file
pnpm --filter @redgest/core exec vitest run src/path/to/test.ts
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | TurboRepo 2.x, pnpm workspaces |
| Language | TypeScript 5.9 (strict, ESM-only) |
| Database | PostgreSQL 16 + Prisma v7 |
| MCP Server | Hono + Streamable HTTP / stdio |
| LLM | Vercel AI SDK v6, Anthropic Claude |
| Testing | Vitest 4 (unit + integration + E2E) |
| Cache | Redis (optional, via ioredis) |

## Environment Variables

See [`.env.example`](.env.example) for all options. Required:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `REDDIT_CLIENT_ID` | Reddit script app client ID |
| `REDDIT_CLIENT_SECRET` | Reddit script app client secret |
| `MCP_SERVER_API_KEY` | Bearer token for HTTP transport (min 32 chars) |

Optional: `REDIS_URL` (LLM response caching), `OPENAI_API_KEY` (fallback provider), `MCP_SERVER_PORT` (default 3100).

## License

Private project.
