# Follow-Up Research: Redgest Data Model & Prisma v7 — Revision

## Context

You conducted deep research on **designing the data model and Prisma v7 implementation for Redgest**, a personal Reddit digest engine. The research was evaluated and found to be **strong on Prisma v7 infrastructure (configuration, monorepo patterns, migration workflows, event store design) but missing the core deliverables: the actual Prisma schema, view SQL, repository interfaces, and schema validation analysis for Redgest's specific tables.**

The original spike asked 8 research questions and requested 7 deliverables (A–G). The infrastructure questions (3, 4, 6, 7) were well-answered. The data-model-specific questions (1, 2, 5, 8) and most deliverables (A, B, C, F, G) were either skipped or addressed generically with non-Redgest examples.

This follow-up targets those gaps. Your original output is included below — build on it, don't replace it. The Prisma v7 infrastructure knowledge is solid. The missing work is applying that knowledge to Redgest's specific data model.

---

## What Was Well-Covered (Preserve As-Is)

Do not re-research these areas. Reference them as needed when building the schema and views, but don't reproduce the explanations:

- ✅ **Prisma v7 `prisma.config.ts` configuration** — format, required fields, env var changes, `datasource.directUrl` removal. Correct and well-sourced.
- ✅ **TurboRepo monorepo structure** — `packages/db` layout, `prisma-client` provider, explicit output path, `turbo.json` task dependencies, ESM interaction. Matches official Prisma + TurboRepo guide.
- ✅ **Singleton client pattern with driver adapter** — `PrismaPg` adapter, globalThis pattern, package exports. Working code.
- ✅ **Views remain in Preview** — confirmed, `previewFeatures = ["views"]` required, `--create-only` migration workflow, TypedSQL as alternative.
- ✅ **Enum revert history** — `@map` runtime value change in 7.0.0 reverted in 7.3.0. Use Prisma enums for Postgres.
- ✅ **JSON type safety gap** — no native typed JSON in v7, use `prisma-json-types-generator` or Zod at runtime.
- ✅ **Event store column design** — BIGINT GENERATED ALWAYS AS IDENTITY, BRIN index on `created_at`, optimistic concurrency unnecessary for audit trail, partition strategy for 50M+ rows. Excellent section.
- ✅ **Full-text search preparation** — `Unsupported("tsvector")`, trigger-based column, raw SQL / TypedSQL for queries. Correct approach.
- ✅ **Seeding configuration** — moved to `prisma.config.ts#migrations.seed`, must run explicitly.
- ✅ **Migration workflow changes** — `generate` and `seed` no longer automatic, `--skip-generate`/`--skip-seed` flags removed.

---

## What Needs Work

### MISSING DELIVERABLE: Deliverable A — Complete `schema.prisma`

The original prompt's **primary deliverable** was a production-ready `schema.prisma` file with all models, enums, relations, indexes, and views. This was not produced. Only generator/datasource config fragments and a generic `Post` model for the FTS example appeared.

**Produce the actual `schema.prisma` file.** It must include:

- **Generator block** with `prisma-client` provider, explicit output path, `previewFeatures = ["views"]`
- **All 8 core models:** `Subreddit`, `Config`, `Job`, `Event`, `Post`, `PostComment`, `PostSummary`, `Digest`, `DigestPost`
- **All 4 view models:** `DigestView`, `PostView`, `RunView`, `SubredditView`
- **Enums:** `JobStatus` (queued/running/completed/failed/partial), `DeliveryChannel` (none/email/slack/all)
- **All relations** with explicit `@relation` fields, foreign key names, and onDelete behavior
- **All indexes** (`@@index`) — not just events table, ALL tables. Include indexes for: subreddit name lookup, post redditId lookup, job status filtering, post_summary lookup by postId+jobId, digest_post ordering, event aggregate lookup.
- **`@@map` annotations** for snake_case Postgres table/column names with camelCase TypeScript
- **JSON columns** typed as `Json` with comments noting the expected shape and corresponding Zod schema name
- **UUID strategy:** Use `@default(uuid(7))` for domain entity IDs (posts, jobs, digests, summaries). Use `BigInt` with `@default(autoincrement())` for events.
- **Comments** on every non-obvious decision (why this index, why this onDelete, why JSON vs normalized)

Use the data model from the original prompt as your source. Here it is again for reference:

**`subreddits`** — `id` (PK), `name` (unique), `insightPrompt` (nullable text), `maxPosts` (int, default 5), `includeNsfw` (boolean, default false), `isActive` (boolean, default true), `createdAt`, `updatedAt`

**`config`** — `id` (PK, always 1), `globalInsightPrompt` (text), `defaultLookback` (string, e.g. "24h"), `defaultDelivery` (enum), `llmProvider` (string), `llmModel` (string), `schedule` (nullable string, cron), `updatedAt`

**`jobs`** — `id` (PK, UUID), `status` (enum), `subreddits` (JSON array of strings), `lookback` (string), `delivery` (string), `triggerRunId` (nullable string), `progress` (nullable JSON), `startedAt` (nullable), `completedAt` (nullable), `error` (nullable text), `createdAt`

**`events`** — `id` (PK, auto-increment bigint), `type` (string), `payload` (JSON), `aggregateId` (string), `aggregateType` (string), `version` (int), `correlationId` (nullable UUID), `causationId` (nullable UUID), `metadata` (JSON, default {}), `createdAt`

**`posts`** — `id` (PK, UUID), `redditId` (unique string), `subreddit` (string), `title` (text), `body` (nullable text), `author` (string), `score` (int), `commentCount` (int), `url` (text), `permalink` (text), `flair` (nullable string), `isNsfw` (boolean), `fetchedAt` (timestamp)

**`post_comments`** — `id` (PK, UUID), `postId` (FK → posts), `redditId` (string), `author` (string), `body` (text), `score` (int), `depth` (int), `fetchedAt`

**`post_summaries`** — `id` (PK, UUID), `postId` (FK → posts), `jobId` (FK → jobs), `summary` (text), `keyTakeaways` (JSON string array), `insightNotes` (text), `commentHighlights` (JSON array of objects), `selectionRationale` (text), `llmProvider` (string), `llmModel` (string), `createdAt`

**`digests`** — `id` (PK, UUID), `jobId` (FK → jobs, unique), `contentMarkdown` (text), `contentHtml` (nullable text), `contentSlackBlocks` (nullable JSON), `createdAt`

**`digest_posts`** — `digestId` (FK → digests), `postId` (FK → posts), `subreddit` (string, denormalized), `rank` (int), composite PK on (digestId, postId)

---

### UNANSWERED: Question 1 — Schema Design Validation & Improvements

The original prompt asked you to validate and improve the data model. You covered the `events` table thoroughly but **ignored the other 7 tables entirely.** Address each of these sub-questions with specific analysis:

**1a. JSON column tradeoff analysis.** For each JSON column in the schema, recommend JSON vs. normalized and explain why:
- `jobs.subreddits` (JSON array of subreddit name strings) — should this be a join table to `subreddits` instead? Tradeoff: query convenience vs. referential integrity.
- `jobs.progress` (JSON object like `{ completed: 3, total: 10, currentSub: "LocalLLaMA" }`) — ephemeral runtime state vs. structured columns. Consider: is this ever queried by field?
- `post_summaries.keyTakeaways` (JSON string array) — is a string array in JSON fine, or should these be a related table for searchability?
- `post_summaries.commentHighlights` (JSON array of objects) — what's the object shape? Should these reference `post_comments` directly?
- `events.payload` and `events.metadata` — JSON is correct here (schema varies per event type), but confirm.
- `digests.contentSlackBlocks` — Slack Block Kit JSON, clearly should stay JSON. Confirm.

For each: state the recommendation, the tradeoff, and whether it affects indexing or query patterns.

**1b. Singleton `config` table enforcement.** How do you enforce a single-row config table in Prisma? Options include: `@default(1)` on the ID with a unique constraint, application-layer `upsert` with `where: { id: 1 }`, a check constraint via raw SQL migration, or something else. What's the cleanest pattern in Prisma v7?

**1c. `digest_posts` — explicit join table vs. Prisma implicit many-to-many.** The current design uses an explicit join table with a `rank` column and a denormalized `subreddit` string. Prisma's implicit many-to-many can't carry extra columns, so this must be explicit. Confirm this decision and show the correct Prisma model with composite PK.

**1d. `redditId` uniqueness on `posts`.** Reddit post IDs (e.g., `t3_abc123`) are globally unique across all subreddits. A `@unique` constraint on `redditId` alone is sufficient for deduplication. Confirm or challenge this.

**1e. Cascade delete strategy.** For each FK relationship, specify the `onDelete` behavior and why:
- `post_comments.postId` → `posts` — Cascade? (deleting a post should delete its comments)
- `post_summaries.postId` → `posts` — Cascade? (deleting a post should delete its summaries)
- `post_summaries.jobId` → `jobs` — what happens when a job is deleted? Cascade, SetNull, or Restrict?
- `digests.jobId` → `jobs` — Cascade? One digest per job.
- `digest_posts.digestId` → `digests` — Cascade.
- `digest_posts.postId` → `posts` — Cascade or Restrict? If a post is deleted, should it be removed from existing digests?

**1f. Missing indexes.** Beyond the events table indexes (already covered), identify indexes needed on:
- `posts` — by `subreddit`, by `redditId` (already unique), by `fetchedAt`
- `post_comments` — by `postId`
- `post_summaries` — by `postId`, by `jobId`, composite `(postId, jobId)`
- `digest_posts` — by `digestId` (implicit from PK?), by `subreddit`
- `jobs` — by `status`, by `createdAt`
- `subreddits` — by `isActive`

**1g. Missing columns or tables.** Are there any tables, columns, or relationships missing from the design? Consider:
- Should `posts` have a FK to `subreddits` instead of a plain string `subreddit` column? Tradeoff: referential integrity vs. flexibility (what if a subreddit is deactivated but posts remain?).
- Should `digest_posts` have a FK to `post_summaries` to link the specific summary used in a digest? Currently, a digest includes a post, but you'd need to join through `post_summaries` to find which summary was used, filtered by `jobId`.
- Any audit columns missing? (e.g., `updatedAt` on tables that get modified)

---

### MISSING DELIVERABLE: Deliverable B — View SQL Definitions

Produce `CREATE VIEW` SQL statements for all 4 read models. For each view:
- Show the complete SQL with all joins, column selections, and computed columns
- Use the Postgres column names (snake_case as mapped by `@@map`)
- Note whether a standard view or materialized view is more appropriate and why
- Show the corresponding Prisma `view` model definition that maps to it

**`digest_view`** — Projected from `digests` + `jobs` + `digest_posts`. Should include: digest ID, job ID, job status, started/completed timestamps, subreddit list, post count per subreddit, content markdown, content HTML. Primary read model for `get_digest` and `list_runs`.

**`post_view`** — Projected from `posts` + latest `post_summaries` (most recent by `createdAt`) + aggregated `post_comments` (top N by score). Should include: post fields, summary text, key takeaways, insight notes, comment count, top comment previews. Primary read model for `get_post` and `search_posts`.

**`run_view`** — Projected from `jobs` + count of events per job + latest event type/timestamp. Should include: job ID, status, progress JSON, subreddit list, event count, last event type, last event timestamp, duration (completed - started). Primary read model for `get_run_status`.

**`subreddit_view`** — Projected from `subreddits` + stats derived from recent `digest_posts` + `jobs`. Should include: subreddit config fields, last digest date, post count in last digest, total posts fetched (from `posts` table), active/inactive status. Primary read model for `list_subreddits`.

---

### MISSING DELIVERABLE: Deliverable C — Repository Interface Definitions

The original research showed a generic `IOrderRepository` and `PrismaOrderRepository`. Produce the actual interfaces and one full implementation for Redgest's entities.

**Required interfaces (TypeScript):**

1. **`JobRepository`** — `create(data)`, `updateStatus(id, status, error?)`, `updateProgress(id, progress)`, `findById(id)`, `findRecent(limit)`, `findByStatus(status)`
2. **`PostRepository`** — `upsert(data)` (by redditId), `findById(id)`, `findByRedditId(redditId)`, `findBySubreddit(subreddit, since?)`, `createComments(postId, comments[])`
3. **`DigestRepository`** — `create(data)`, `findByJobId(jobId)`, `findRecent(limit)`, `addPosts(digestId, posts[])`
4. **`PostSummaryRepository`** — `create(data)`, `findByPostAndJob(postId, jobId)`, `findLatestByPost(postId)`
5. **`SubredditRepository`** — `findAll()`, `findActive()`, `findByName(name)`, `create(data)`, `update(id, data)`, `deactivate(id)`
6. **`ConfigRepository`** — `get()`, `update(data)`, `ensureExists(defaults)`
7. **`EventRepository`** — `append(event)`, `findByAggregateId(id)`, `findByType(type, since?)`, `findByCorrelationId(correlationId)`, `countByJobId(jobId)`

For each interface:
- Use **domain types** (not Prisma types) for parameters and return values. Define the domain types (e.g., `DomainJob`, `DomainPost`, `CreatePostInput`, `JobStatus`).
- Show the method signatures with full TypeScript types.

Then show **one full implementation** — `PrismaJobRepository` — as a reference, including:
- Constructor taking `PrismaClient` (or transaction client)
- Domain ↔ Prisma type mapping functions
- All methods implemented with actual Prisma calls
- How it works inside the Unit of Work / interactive transaction pattern from your original research

---

### MISSING DELIVERABLE: Deliverable F — Schema Design Decisions

Produce a structured rationale document. For each decision, state: the choice, the alternatives considered, the tradeoffs, and why this choice wins for Redgest's constraints (single-user, personal tool, read-heavy via MCP).

Decisions to cover:
1. JSON vs. normalized for each JSON column (from 1a above)
2. Prisma enums vs. Postgres enums vs. plain strings for `JobStatus` and `DeliveryChannel`
3. UUID v7 via `@default(uuid(7))` for domain entities vs. alternatives
4. BIGINT autoincrement for events PK (already covered — summarize from original)
5. Standard views vs. materialized views for the 4 read models
6. Explicit `digest_posts` join table vs. Prisma implicit M2M
7. `posts.subreddit` as string vs. FK to `subreddits`
8. Singleton config pattern choice
9. Cascade delete strategy per relationship
10. Event store: single table vs. partitioned (already covered — summarize)

---

### MISSING DELIVERABLE: Deliverable G — Open Questions

This was missing entirely. In a domain with Prisma v7 edge cases, CQRS patterns, and evolving view support, there are absolutely open questions. Produce a substantive list of things you **couldn't resolve** or that **need runtime verification**. Examples of what might belong here:
- Does `@default(uuid(7))` actually work in Prisma v7's `prisma-client` provider? (vs. only in `prisma-client-js`)
- Performance of Prisma views with complex joins at the query volumes Redgest will see
- Whether Prisma's `$transaction` interactive mode works correctly with the `PrismaPg` driver adapter
- Any known issues with `previewFeatures = ["views"]` in v7
- Whether TypedSQL `.sql` files work in a monorepo when the schema is in a different package

Be honest. Flag what needs hands-on testing.

---

### UNANSWERED: Question 8 — Seed Script

Produce an actual TypeScript seed script (`packages/db/prisma/seed.ts`) that:
1. Ensures the singleton `config` row exists with sensible defaults
2. Creates 3-4 sample subreddits (e.g., LocalLLaMA, ExperiencedDevs, MachineLearning, selfhosted)
3. Creates one sample completed job with a few posts, summaries, a digest, and digest_posts
4. Appends corresponding events to the event log
5. Uses `upsert` for idempotency
6. Is compatible with Prisma v7's seeding model (invoked via `prisma.config.ts#migrations.seed`)

---

### UNVERIFIED: Claims Needing Source Confirmation

The following claims from your original research are plausible but unsourced. Verify each against current v7 documentation:

1. **`@default(uuid(7))` syntax** — You stated UUIDv7 is "fully supported" via this syntax. Verify this works with the `prisma-client` provider (not just `prisma-client-js`). Cite the schema reference doc.
2. **`Prisma.validator` removed in v7** — Stated without citation. Check the v7 upgrade guide and confirm. If removed, confirm that `satisfies` is the recommended replacement.
3. **v7.4.0 batching in interactive transactions** — Mentioned without a source. Verify this version number and the feature.
4. **`PrismaPg` import path** — Confirm `@prisma/adapter-pg` is the correct package for the Postgres driver adapter in v7.

---

## Targeted Deliverables Summary

| ID | Deliverable | Status |
|----|------------|--------|
| A | Complete `schema.prisma` | **PRODUCE** — Full file, all models, enums, relations, indexes, views, `@@map` |
| B | View SQL Definitions | **PRODUCE** — 4 `CREATE VIEW` statements + corresponding Prisma view models |
| C | Repository Interfaces | **PRODUCE** — 7 interfaces with domain types + 1 full Prisma implementation |
| D | Package Structure | ✅ Solid — do not reproduce |
| E | Migration Strategy | ✅ Adequate — do not reproduce (but include view migration workflow in Deliverable B) |
| F | Schema Design Decisions | **PRODUCE** — 10 decisions with rationale |
| G | Open Questions | **PRODUCE** — Substantive list of unresolved items |
| H | Seed Script (new) | **PRODUCE** — Working TypeScript seed for dev environment |

---

## Important Notes

- **Build on your original research.** The Prisma v7 infrastructure sections (config, monorepo, event store, FTS prep) are solid. This revision is about applying that knowledge to Redgest's actual tables.
- **Priority order:** Deliverable A (schema) → Question 1 (validation) → Deliverable B (views) → Deliverable C (repositories). These four items are blocking implementation. F, G, and H are important but secondary.
- **The schema must be a real, complete file.** Not fragments. Not pseudocode. A file I can drop into `packages/db/prisma/schema.prisma` and run `prisma generate` against.
- **Incorporate the event store columns from your original research** (`version`, `correlationId`, `causationId`, `metadata`) into the Prisma schema. Your original SQL was good — translate it to Prisma model syntax.
- **If you can't verify a v7 behavior, say so in Deliverable G.** An explicit "needs runtime testing" is more valuable than a confident guess that turns out wrong.
- **Search Prisma v7 docs before writing the schema.** Specifically confirm: `uuid(7)` syntax, `BigInt` with `@default(autoincrement())`, `Json` default values, `@@map` on composite keys, and `view` keyword syntax. These are all v7-specific details where training data may be stale.

---

## Original Research (Reference)

[ATTACH: The full spike output from the previous research run. The revision agent needs this as its foundation.]
