# Research Task: Data Model Design & Prisma v7 Integration for "Redgest"

## Context

I'm building **Redgest**, a personal Reddit digest engine. It monitors subreddits, uses LLMs to select and summarize interesting posts based on user-defined interest prompts, and delivers digests via MCP (Model Context Protocol), email, and Slack. The system is structured as a TurboRepo monorepo with a CQRS architecture.

This spike is about **designing the underlying data model and its Prisma v7 implementation** — the schema, relationships, indexes, JSON column strategies, the event store, read model projections (Postgres views), and how all of this composes inside a monorepo where the database package (`@redgest/db`) is shared across multiple consumers.

## Architecture Context You Need

### CQRS Pattern

The system uses Command Query Responsibility Segregation **without** full event sourcing:

- **Write path:** Commands (`GenerateDigest`, `AddSubreddit`, etc.) are processed by handlers that validate input, persist state changes via Prisma, and emit domain events to an append-only `events` table. Events are also dispatched in-process to projectors and side-effect handlers.
- **Read path:** Queries read from Postgres views (or materialized views) optimized for specific access patterns. The MCP server's tools (`get_digest`, `get_post`, `search_posts`, `get_run_status`) read exclusively from these views.
- **Events are NOT the source of truth.** The primary tables (`jobs`, `posts`, `digests`, etc.) are the source of truth. The event log is an append-only audit trail used for: triggering side effects (e.g., `DigestCompleted` → send email), updating read model projections, and debugging/observability.

### Monorepo Structure (Relevant Parts)

```
redgest/
├── packages/
│   ├── core/           # CQRS commands, events, handlers, projectors, pipeline logic
│   ├── db/             # Prisma schema, generated client, migrations, repository interfaces
│   ├── mcp-server/     # MCP tools → commands (write) or view queries (read)
│   ├── reddit/         # Reddit API client, returns typed domain objects
│   ├── llm/            # LLM provider, returns structured JSON
│   └── ...
├── apps/
│   ├── web/            # Next.js config UI
│   └── worker/         # Trigger.dev task definitions (imports @redgest/core)
```

**`@redgest/db` is the single source of truth for all database access.** It exports:
- The generated Prisma client
- Typed repository interfaces (consumed by `@redgest/core`)
- Migration management
- View definitions

Every other package imports from `@redgest/db`. No package directly writes SQL or manages its own database connection.

### Consumers of the Database

| Consumer | Access Pattern | Examples |
|----------|---------------|---------|
| `@redgest/core` command handlers | Write via Prisma client. Create/update records, append events. | Create job, upsert post, create summary, append event |
| `@redgest/core` event projectors | Write to projection tables or refresh views after events. | Update `run_view` progress after `PostsFetched` |
| `@redgest/mcp-server` query handlers | Read from Postgres views via Prisma. Never write. | `get_digest` reads `digest_view`, `search_posts` reads `post_view` |
| `apps/web` (Next.js) | Read + write via `@redgest/core` commands and queries. | Config UI reads subreddit list, submits `AddSubreddit` command |
| `apps/worker` (Trigger.dev) | Read + write via `@redgest/core` pipeline logic. | Task reads config, writes posts/summaries/digests, emits events |

### Technology Constraints

- **Prisma v7** — Rust-free, ESM-native, uses `prisma.config.ts`. Generated client with `prisma-client` provider (not the legacy `prisma-client-js`). Output path is explicit (no longer in `node_modules` by default).
- **Postgres** — Primary database. Will be Neon, Supabase Postgres, AWS RDS, or any standard Postgres instance. No vendor-specific extensions assumed.
- **TypeScript strict mode, ESM throughout.**
- **Single-user tool** — no multi-tenancy, no row-level security, no complex permission model.

## The Data Model (Current Design — Needs Validation)

Here is the data model as currently designed in the PRD. **Your job is to validate, improve, and flesh this out into a production-ready Prisma schema with proper types, relations, indexes, and JSON column strategies.**

### Core Tables

**`subreddits`** — Monitored subreddit configuration.
- `id` (PK), `name` (unique, e.g., "LocalLLaMA"), `insightPrompt` (nullable text — per-sub prompt layered on top of global), `maxPosts` (int, default 5), `includeNsfw` (boolean, default false), `isActive` (boolean, default true), `createdAt`, `updatedAt`

**`config`** — Global configuration. Singleton row.
- `id` (PK, always 1), `globalInsightPrompt` (text), `defaultLookback` (string, e.g., "24h"), `defaultDelivery` (enum or string: none/email/slack/all), `llmProvider` (string: "anthropic" | "openai"), `llmModel` (string, e.g., "claude-sonnet-4-20250514"), `schedule` (nullable string, cron expression), `updatedAt`

**`jobs`** — Pipeline run records. Immutable once terminal.
- `id` (PK, UUID), `status` (enum: queued/running/completed/failed/partial), `subreddits` (JSON array of subreddit names included in this run), `lookback` (string), `delivery` (string), `triggerRunId` (nullable string — Trigger.dev run ID for correlation), `progress` (nullable JSON — e.g., `{ completed: 3, total: 10, currentSub: "LocalLLaMA" }`), `startedAt` (nullable), `completedAt` (nullable), `error` (nullable text), `createdAt`

**`events`** — Domain event log. Append-only.
- `id` (PK, auto-increment bigint), `type` (string, e.g., "DigestRequested", "PostsFetched"), `payload` (JSON), `aggregateId` (string — typically jobId or subreddit name), `aggregateType` (string — "job", "subreddit", "config"), `createdAt`

**`posts`** — Reddit posts with raw content and metadata. A post can exist independently of any digest.
- `id` (PK, UUID), `redditId` (unique string, e.g., "t3_abc123"), `subreddit` (string), `title` (text), `body` (nullable text — empty for link posts), `author` (string), `score` (int), `commentCount` (int), `url` (text — destination URL for link posts, Reddit URL for text posts), `permalink` (text — Reddit permalink), `flair` (nullable string), `isNsfw` (boolean), `fetchedAt` (timestamp)

**`post_comments`** — Top comments stored per post.
- `id` (PK, UUID), `postId` (FK → posts), `redditId` (string), `author` (string), `body` (text), `score` (int), `depth` (int — 0 for top-level), `fetchedAt`

**`post_summaries`** — LLM-generated summaries. Linked to both a post and a job (different runs may produce different summaries for the same post).
- `id` (PK, UUID), `postId` (FK → posts), `jobId` (FK → jobs), `summary` (text), `keyTakeaways` (JSON string array), `insightNotes` (text), `commentHighlights` (JSON array of objects), `selectionRationale` (text — from triage pass, why the LLM picked this post), `llmProvider` (string), `llmModel` (string), `createdAt`

**`digests`** — Assembled digest content per job.
- `id` (PK, UUID), `jobId` (FK → jobs, unique — one digest per job), `contentMarkdown` (text), `contentHtml` (nullable text — rendered for email), `contentSlackBlocks` (nullable JSON — Block Kit), `createdAt`

**`digest_posts`** — Join table: which posts appear in which digest, with ordering.
- `digestId` (FK → digests), `postId` (FK → posts), `subreddit` (string — denormalized for query convenience), `rank` (int — ordering within the subreddit section), composite PK on (digestId, postId)

### Read Models (Postgres Views)

These are Postgres views (standard, not materialized) that denormalize data for efficient querying by the MCP server.

**`digest_view`** — Projected from `digests` + `jobs` + `digest_posts`. Pre-joined digest content with run metadata (status, timing, subreddit list). Primary read model for `get_digest` and `list_runs`.

**`post_view`** — Projected from `posts` + latest `post_summaries` + `post_comments`. Denormalized post with its most recent summary and top comments. Primary read model for `get_post` and `search_posts`.

**`run_view`** — Projected from `jobs` + count of events per job + latest event. Job status with progress info. Primary read model for `get_run_status`.

**`subreddit_view`** — Projected from `subreddits` + stats derived from recent `digest_posts`. Config plus last activity, post count in last digest, etc. Primary read model for `list_subreddits`.

## Research Questions

### 1. Schema Design Validation & Improvements

**Research and propose improvements to the data model above:**

- Are there missing tables, columns, or relationships?
- Are the JSON columns (`subreddits` on jobs, `keyTakeaways`, `commentHighlights`, `progress`, `payload`) the right choice, or should any of these be normalized into their own tables? What's the tradeoff for each?
- Is the `events` table well-structured for an append-only event log? Should it have additional columns (e.g., `version`, `correlationId`, `causationId` for event chain tracking)?
- Is the singleton `config` table the right pattern, or is there a better way to handle global configuration in Prisma?
- Should `digest_posts` be a proper Prisma many-to-many relation or an explicit join table? What are the tradeoffs?
- Is `redditId` on `posts` sufficient for deduplication, or do we need a composite key (redditId + subreddit)?
- How should we handle the `post_comments` → `posts` relationship for cascade deletes?
- Are there any indexing opportunities we're obviously missing?

### 2. Prisma v7 Schema Implementation

**Produce a complete, production-ready `schema.prisma` file for this data model.**

Specific Prisma v7 concerns to address:
- Proper use of `@id`, `@unique`, `@relation`, `@@index`, `@@unique`, `@@map` for table/column naming conventions (snake_case in Postgres, camelCase in TypeScript)
- JSON columns: use `Json` type. How to handle typed JSON in Prisma v7? Is there a way to get type safety on JSON columns, or do we validate at the application layer?
- Enum types: should `JobStatus` and `DeliveryChannel` be Prisma enums, Postgres enums, or plain strings? What's the current Prisma v7 best practice? (Note: Prisma v7 had issues with mapped enums that were reverted — research the current state.)
- UUID generation: `@default(uuid())` vs. `@default(dbgenerated("gen_random_uuid()"))` — which is preferred in Prisma v7?
- DateTime handling: `@default(now())`, timezone awareness
- BigInt for the events table auto-increment ID
- The `config` singleton pattern — how to enforce it at the schema level

### 3. Prisma v7 Configuration for Monorepo

**How should `@redgest/db` be structured as a TurboRepo package?**

- What does `prisma.config.ts` look like? Where does the schema file live relative to the package?
- Where should the generated client output go? Inside `packages/db/src/generated/`? Somewhere else?
- How do other packages (`@redgest/core`, `apps/worker`) import and use the generated client?
- How do migrations work in a monorepo? Where do migration files live? How do you run them in CI vs. local dev vs. production?
- Is there a recommended pattern for exporting the Prisma client as a singleton from the `@redgest/db` package?
- How does Prisma v7's ESM output interact with TurboRepo's build pipeline?

### 4. Postgres Views in Prisma

**How do we define and use Postgres views with Prisma v7?**

- Prisma supports `view` models — what's the current state in v7? Is it GA or still preview?
- How do you define a view in the Prisma schema? Do you also need a SQL migration to create the view?
- Can Prisma views have relations to other models?
- How do you query a view through the Prisma client? Same as a regular model?
- For our four views (`digest_view`, `post_view`, `run_view`, `subreddit_view`), provide the SQL `CREATE VIEW` statements and the corresponding Prisma `view` model definitions.
- If views are not well-supported in Prisma v7, what's the alternative? Raw SQL queries? Prisma client extensions? A query layer that wraps `$queryRaw`?

### 5. Repository Pattern & CQRS Integration

**How should `@redgest/db` expose its functionality to `@redgest/core`?**

We want a repository pattern where `@redgest/core` doesn't import Prisma directly — it imports typed repository interfaces from `@redgest/db`. This enables:
- Testing `core` without a real database (mock the repository)
- Swapping the persistence layer without changing domain logic
- Clean separation between domain types and Prisma-generated types

**Research and propose:**
- A repository interface pattern that works well with Prisma v7. Show interfaces and their Prisma implementations for at least: `JobRepository`, `PostRepository`, `DigestRepository`, `EventRepository`.
- How to map between Prisma-generated types and domain types. Should the repository methods return Prisma types or domain types? How much mapping is needed?
- How does the event store repository work? It needs: `append(event)`, `getByAggregateId(id)`, `getByType(type, since?)`. What does this look like with Prisma?
- Should the repository implementations use Prisma transactions for command handlers that need to write to multiple tables atomically (e.g., create post + create summary + create digest_post + append event)?

### 6. Event Store Design

**Deep dive into the `events` table design for our CQRS pattern.**

- Is a single `events` table the right approach, or should events be partitioned by aggregate type?
- What columns are essential for an event log that supports: audit trail, event replay to rebuild projections, debugging/observability, and correlation (tracking which event caused which)?
- Recommended columns from CQRS literature: `id`, `type`, `payload`, `aggregateId`, `aggregateType`, `version` (per-aggregate sequence number), `correlationId` (links related events across a flow), `causationId` (which event/command caused this one), `metadata` (JSON — actor, source, etc.), `createdAt`.
- How do we prevent event ordering issues? Do we need optimistic concurrency on the aggregate version?
- Index strategy for the events table — we need fast queries by: `aggregateId`, `type`, `createdAt` range, and `correlationId`.
- Pruning strategy: the PRD mentions a `maintenance.cleanup` task. How should old events be pruned? By age? By aggregate? Never (storage is cheap)?

### 7. Full-Text Search Preparation (Phase 4)

This is a Phase 4 feature, but schema decisions now affect it.

- Should we add `tsvector` columns to `posts` and `post_summaries` now, even if we don't build the search UI until Phase 4?
- How does Prisma v7 handle `tsvector` / `trgm` indexes? Can they be defined in the schema, or do they require raw SQL migrations?
- What columns should be indexed for search? (`posts.title`, `posts.body`, `post_summaries.summary`, `post_summaries.insightNotes`?)
- Is there a Prisma extension or pattern for full-text search that avoids dropping to raw SQL for every query?

### 8. Seeding & Initial State

- How should the singleton `config` row be seeded? Prisma seed script? Migration? Application-level "ensure exists" on startup?
- What does a reasonable seed script look like for local development (a few subreddits, a sample digest with posts and summaries)?
- How does Prisma v7 handle seeding in a monorepo? (v7 removed automatic seeding from `migrate dev`.)

## Deliverables

### A. Complete Prisma Schema
A production-ready `schema.prisma` file with all models, enums, relations, indexes, and views. Annotated with comments explaining non-obvious decisions.

### B. View SQL Definitions
`CREATE VIEW` (or `CREATE MATERIALIZED VIEW` where justified) SQL statements for all four read models. Include column selections, joins, and any computed columns.

### C. Repository Interface Definitions
TypeScript interfaces for the repository pattern: `JobRepository`, `PostRepository`, `DigestRepository`, `SubredditRepository`, `ConfigRepository`, `EventRepository`. Include method signatures with domain types (not Prisma types). Show one implementation (e.g., `PrismaJobRepository`) as a reference.

### D. Package Structure
Recommended file/folder structure for `packages/db/`, including:
- `prisma.config.ts`
- Schema location
- Generated client output location
- Migration directory
- Repository implementations
- Client singleton export
- View SQL files

### E. Migration Strategy
How to manage migrations in local dev, CI, and production for this monorepo setup. Include the commands and any TurboRepo pipeline integration.

### F. Schema Design Decisions
For each non-obvious choice (JSON vs. normalized, enum vs. string, UUID strategy, index strategy, view vs. materialized view, etc.), provide a brief rationale with tradeoffs.

### G. Open Questions
Anything you couldn't resolve. Flag clearly.

## Important Notes

- **Prisma v7 is a major release that changed many things.** The Rust engine is gone. `prisma.config.ts` is required. The `prisma-client` provider replaces `prisma-client-js`. ESM is the default. Output path is explicit. Seeding is no longer automatic. **Do not rely on pre-v7 patterns.** Search for current Prisma v7 documentation and best practices.
- **Prisma view support** has been evolving. Check the current state in v7 — it may be GA or still in preview. The `views` preview feature was mentioned in the v7 changelog as graduating.
- **JSON column type safety** is a known Prisma limitation. Research if there are new solutions in v7, or if application-layer validation (e.g., Zod schemas) is still the standard approach.
- **The event store design matters more than it looks.** Get the column set and indexing right — it's hard to change later. Research CQRS event store patterns specifically for Postgres + Prisma.
- **Search for real-world Prisma v7 monorepo setups.** The `prisma.config.ts` + explicit output path + ESM changes affect how the generated client is shared across packages. This is a common pain point.
- I care more about **getting this right** than getting a quick answer. If Prisma v7 has limitations that conflict with our design (e.g., poor view support, JSON type safety issues), say so clearly and propose workarounds. Don't paper over problems.
