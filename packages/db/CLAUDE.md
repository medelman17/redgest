# @redgest/db

Prisma v7 schema, client, migrations, and SQL views.

## Prisma v7 Setup

This project uses Prisma v7 which requires:

- **`prisma.config.ts`** (not schema-level config) — uses `defineConfig()` from `prisma/config`
- **`@prisma/adapter-pg`** — Rust-free Postgres adapter, explicit in client setup
- **Generated output:** `src/generated/prisma` (not default `node_modules/.prisma`)
- **`turbo db:generate`** must run before build/dev — Prisma client generation

## Client Singleton

`src/client.ts` creates a `PrismaPg` adapter + `PrismaClient` with global singleton for dev:

```typescript
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
// globalThis pattern for HMR (TD-003: unavoidable as unknown as cast)
```

**Exported types:** `PrismaClient`, `TransactionClient` (omits `$connect`/`$disconnect`/`$transaction`/`$extends`).

## Schema: 15 Tables, 6 Views

**Tables:**
| Table | Key Notes |
|-------|-----------|
| `subreddits` | UUID v7, unique `name`, `isActive` flag, `crawlIntervalMinutes`, `nextCrawlAt` |
| `digest_profiles` | Named digest configurations with schedule, lookback, maxPosts, delivery |
| `digest_profile_subreddits` | Profile↔subreddit join table, composite PK, cascade deletes |
| `config` | Singleton (CHECK constraint `id = 1`) |
| `jobs` | Immutable run records, JSONB `subreddits` + `progress`, optional `profileId` FK |
| `events` | **BigInt autoincrement ID** (not UUID), append-only |
| `posts` | Unique `redditId`, `Unsupported("tsvector")` for FTS, `scoreDelta` for trend tracking |
| `post_comments` | Cascade delete from post |
| `post_summaries` | Dual FK: post + job, JSONB `keyTakeaways` + `commentHighlights`, `embedding` vector(1536) |
| `digests` | Unique `jobId` (1:1), markdown/HTML/slack_blocks, `Unsupported("tsvector")` for FTS |
| `digest_posts` | Join table, composite PK `[digestId, postId]`, rank column |
| `llm_calls` | Token usage logging, FK: job + optional post |
| `deliveries` | Email/Slack delivery tracking per digest, status + error + timestamps |
| `topics` | Extracted trending topics, unique name, occurrence count |
| `post_topics` | Post↔topic join table, composite PK |

**Views (raw SQL):** `digest_view`, `post_view`, `run_view`, `subreddit_view`, `profile_view`, `delivery_view`

## Migration History

| # | Migration | What |
|---|-----------|------|
| 1 | `20260309164535_init` | Core tables + enums |
| 2 | `20260309164602_add_views` | SQL views + 3 raw indexes + singleton constraint |
| 3 | `20260310162203_add_llm_calls_table` | llm_calls table (**accidentally dropped raw indexes**) |
| 4 | `20260310170000_restore_dropped_indexes` | Re-creates the 3 dropped indexes |
| 5 | `20260312040236_add_canceled_status` | Adds `CANCELED` to `job_status` enum + restores raw indexes |
| 6 | `20260312130000_fix_run_view_aggregate_type_case` | Fixes case sensitivity in run_view aggregate type filter |
| 7 | `20260312221754_add_deliveries_table` | Delivery tracking table + delivery_view |
| 8 | `20260313162138_add_fetch_caching` | Adds `lastFetchedAt` to posts for fetch cache |
| 9 | `20260313170206_phase3_search` | tsvector columns, pgvector extension, embeddings, topics tables |
| 10 | `20260314010000_add_max_digest_posts` | Adds `maxDigestPosts` to config |
| 11 | `20260314020000_digest_profiles_decoupled_crawling` | Digest profiles, crawl fields, score_delta, profile_view |

## Raw SQL Indexes (Not in Prisma Schema)

These three indexes are managed via raw SQL migrations, not Prisma schema declarations:

```sql
CREATE INDEX idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX idx_events_correlation_id ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_post_comments_post_score ON post_comments (post_id, score DESC);
```

Prisma cannot express BRIN, partial, or DESC indexes. They must be maintained manually.

## Gotchas

- **Schema drift drops raw-SQL indexes** — `prisma migrate dev` detects manually-created indexes as drift and generates DROP statements. Always check `prisma migrate diff` output. If dropped, restore in a follow-up migration.
- **JSON fields aren't auto-serializable** — `Decimal`/`BigInt`/`Date` from Prisma aren't JSON-safe. Use `select` in query handlers to return only serializable fields.
- **`tsvector` is Unsupported type** — Full-text search requires raw SQL queries, not Prisma's query builder.
- **Event ID is BigInt, not UUID** — Autoincrement for ordering in append-only log. All other tables use UUID v7.
- **Singleton enforcement** — Config table uses DB-level `CHECK (id = 1)` + application-level upsert.
- **Cascade deletes** — Deleting a post cascades to comments and summaries. Deleting a digest cascades to digest_posts.
- **Seed auto-runs** — `prisma.config.ts` configures `tsx prisma/seed.ts` to run after `prisma migrate dev`.
- **`CREATE OR REPLACE VIEW` cannot reorder columns** — If new columns are inserted before existing ones, Postgres requires `DROP VIEW` + `CREATE VIEW`. Always check column ordering in view migrations.

## Commands

```bash
pnpm --filter @redgest/db exec prisma migrate dev      # Dev: create + apply migration
pnpm --filter @redgest/db exec prisma migrate deploy    # CI: apply pending migrations
pnpm --filter @redgest/db exec prisma generate          # Regenerate client
pnpm --filter @redgest/db exec tsx prisma/seed.ts       # Seed manually
turbo db:generate                                        # Monorepo-wide generate
```
