# Redgest Work Streams

10 work streams across 4 phases. Dependencies flow top-down.

---

## Dependency Graph

```
WS1: Monorepo & Config (Week 1, 3pt)
├── Unblocks: ALL other streams
│
├─► WS2: Database / Prisma v7 (Week 1, 5pt)
│   └── Unblocks: WS3 (CQRS Core)
│
├─► WS3: CQRS Core (Week 1-2, 8pt)
│   ├── Deps: WS1, WS2
│   └── Unblocks: WS6 (Pipeline), WS7 (MCP Server)
│
├─► WS4: Reddit Integration (Week 1-2, 3pt)
│   ├── Deps: WS1
│   └── Unblocks: WS6 (Pipeline)
│
└─► WS5: LLM Abstraction (Week 2, 5pt)
    ├── Deps: WS1
    └── Unblocks: WS6 (Pipeline)

WS6: Pipeline Orchestration (Week 2-3, 5pt)
├── Deps: WS3, WS4, WS5
└── Unblocks: WS7 (MCP Server)

WS7: MCP Server (Week 3, 5pt)
├── Deps: WS3, WS6
└── Unblocks: WS8 (Trigger.dev), E2E testing

WS8: Trigger.dev Integration (Week 3-4, 5pt)
├── Deps: WS7
└── Unblocks: Phase 1 completion

--- Phase 2+ ---

WS9: Delivery Channels (Week 5, 3pt)
├── Deps: WS3 (events), WS8 (task infrastructure)
└── Unblocks: scheduled delivery

WS10: Web UI / Config (Week 7-8, 8pt)
├── Deps: WS2 (db), WS3 (core)
└── Unblocks: self-service configuration
```

**Critical path**: WS1 → WS2 → WS3 → WS6 → WS7 → WS8

---

## Stream Details & Task Breakdown

### WS1: Monorepo & Config (3pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| Initialize TurboRepo with pnpm workspaces | 0.5 | — | All |
| Create package.json for all 10 packages | 0.5 | — | All |
| Setup @redgest/config with Zod validation schema | 1 | — | All |
| Create .env.example with all required vars | 0.5 | config schema | Testing |
| Setup shared tsconfig, eslint, prettier | 0.5 | — | All |

### WS2: Database / Prisma v7 (5pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| Create Prisma v7 schema (8 tables) | 2 | WS1 | migrations |
| Write prisma.config.ts (v7 requirement) | 0.5 | WS1 | client |
| Setup @prisma/adapter-pg | 0.5 | config.ts | client |
| Create initial migration | 0.5 | schema | client, seed |
| Write singleton Prisma client | 0.5 | adapter, migration | WS3, WS7 |
| Create seed script | 0.5 | migration | testing |
| Define 4 SQL views + migration | 0.5 | schema | WS3 queries |

### WS3: CQRS Core (8pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| Domain model classes (Command, Query, Event) | 1 | WS1 | handlers |
| Command bus implementation | 1 | domain models | handlers |
| Query bus implementation | 1 | domain models | handlers |
| Event bus (in-process EventEmitter) | 1 | domain models | projectors, WS8 |
| Command handlers (GenerateDigest, AddSubreddit, UpdateConfig) | 1.5 | buses, WS2 | WS7 |
| Query handlers (GetDigest, ListSubreddits, GetPost, SearchPosts, GetRunStatus) | 1 | buses, WS2 | WS7 |
| Event projectors (digest_view, post_view, run_view, subreddit_view) | 1 | event bus, WS2 views | queries |
| Unified error code registry | 0.5 | — | all handlers |

### WS4: Reddit Integration (3pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| Reddit API client (script-type auth) | 1 | WS1 | fetcher |
| Token bucket rate limiter (60 req/min) | 0.5 | client | fetcher |
| Content fetcher (hot/top/rising + comments) | 1 | client, limiter | WS6 |
| ContentSource interface for swappability | 0.5 | — | future sources |

### WS5: LLM Abstraction (5pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| Zod schemas (ValidatedTriageResult, ValidatedPostSummary) | 1 | WS1 | generate fns |
| Prompt templates (triage system+user, summarization system+user) | 1 | — | generate fns |
| generateTriageResult() with Output.object() | 1 | schemas, prompts | WS6 |
| generatePostSummary() with Output.object() | 0.5 | schemas, prompts | WS6 |
| Provider abstraction (Anthropic + OpenAI registry) | 0.5 | — | generate fns |
| Upstash Redis cache layer (TTL: 2h/7d) | 0.5 | WS1 config | generate fns |
| Middleware logging (tokens, cost, duration) | 0.5 | — | observability |

### WS6: Pipeline Orchestration (5pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| Triage → Summarize → Assemble flow | 2 | WS3, WS4, WS5 | WS7 |
| Token budgeting and truncation (~8K/~9.7K) | 1 | WS5 | pipeline |
| Deduplication logic (skip previous digest posts) | 1 | WS2 | pipeline |
| Error recovery and partial failure handling | 1 | WS3 errors | pipeline |

### WS7: MCP Server (5pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| tools.ts: Register all 12 tools on McpServer | 2 | WS3, WS6 | http/stdio |
| http.ts: Hono + @hono/mcp Streamable HTTP | 1 | tools.ts | deployment |
| stdio.ts: StdioServerTransport | 0.5 | tools.ts | local dev |
| Bearer auth middleware | 0.5 | — | security |
| Response envelope {ok, data, error} | 0.5 | WS3 errors | all tools |
| Docker image for MCP server | 0.5 | http.ts | deployment |

### WS8: Trigger.dev Integration (5pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| trigger.config.ts with Prisma modern mode | 1 | WS2 | tasks |
| Task definitions (generate, fetch, triage, summarize) | 2 | WS6, WS7 | event handler |
| Event handler: DigestRequested → tasks.trigger() | 1 | WS3 event bus | async pipeline |
| Task result handlers (write status to Postgres) | 1 | tasks, WS2 | job tracking |

### WS9: Delivery Channels — Phase 2 (3pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| @redgest/email: React Email templates | 1 | WS3 events | delivery |
| Resend integration | 0.5 | email templates | delivery |
| @redgest/slack: Block Kit formatter | 1 | WS3 events | delivery |
| Slack webhook client | 0.5 | formatter | delivery |

### WS10: Web UI / Config — Phase 2 (8pt total)

| Task | Points | Blocked By | Unblocks |
|------|--------|-----------|----------|
| Next.js 16 app scaffold with ShadCN | 1 | WS1 | pages |
| Subreddit Manager page | 2 | WS2, WS3 | config |
| Global Settings page | 1.5 | WS2, WS3 | config |
| Run History page | 2 | WS2, WS3 | monitoring |
| Manual Trigger component | 1 | WS3, WS8 | testing |
| Dark mode + layout | 0.5 | scaffold | polish |

---

## Phase Totals

| Phase | Streams | Total Points | Duration |
|-------|---------|-------------|----------|
| Phase 1 | WS1-WS8 | 39pt | 4 weeks |
| Phase 2 | WS9-WS10 + extras | 11pt + TBD | 4 weeks |
| Phase 3+ | Search, history | TBD | Weeks 9+ |

## Testing & Deployment Tasks (Phase 1, Week 4)

| Task | Points | Blocked By |
|------|--------|-----------|
| Unit tests: Zod schemas, prompt building, truncation | 2 | WS5, WS6 |
| Integration tests: mock LLM, real Reddit API | 2 | WS4, WS5, WS6 |
| E2E: manual trigger via MCP → verify digest | 2 | WS7, WS8 |
| Docker Compose verification (full stack) | 1 | all WS1-8 |

Testing total: 7pt (built into Week 4 schedule)
