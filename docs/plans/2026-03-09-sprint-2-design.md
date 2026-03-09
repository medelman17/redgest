# Sprint 2 Design: Database + Reddit Client + LLM Schemas

**Date**: 2026-03-09
**Sprint**: 2 (4.5pt)
**Goal**: Stand up the database layer and unblock parallel work on Reddit integration and LLM structured output

## Tasks

| Task | Stream | Points |
|------|--------|--------|
| Prisma v7 schema (8 tables + DigestPost join) + prisma.config.ts | WS2 | 2.5 |
| Reddit API client — script-type OAuth2 auth | WS4 | 1.0 |
| Zod schemas — TriageResult + PostSummary | WS5 | 1.0 |

## WS2: Database / Prisma v7

### Schema

8 tables + 1 join table + 2 enums, per the data model spike (`docs/spikes/outputs/data-model-implementation.md`).

**Tables**: Subreddit, Config, Job, Event, Post, PostComment, PostSummary, Digest, DigestPost

**Enums**: JobStatus (QUEUED | RUNNING | COMPLETED | FAILED | PARTIAL), DeliveryChannel (NONE | EMAIL | SLACK | ALL)

**Key conventions**:
- UUID v7 for all IDs (`@default(uuid(7))`) — time-sortable
- `@map("snake_case")` for all multi-word columns
- `@@map("table_name")` for table names
- Cascade deletes on child relations (PostComment→Post, PostSummary→Post/Job, DigestPost→Digest/Post, Digest→Job)
- Event table uses BigInt autoincrement ID for global ordering
- Config table uses Int ID fixed to 1 (singleton enforced at app layer)

### Prisma v7 Config

`packages/db/prisma.config.ts` — uses `@prisma/adapter-pg` with `DATABASE_URL` from env directly (not from `@redgest/config`, since Prisma config runs before app code).

### Client

`packages/db/src/client.ts` — singleton PrismaClient with `PrismaPg` adapter. Global reference pattern to survive HMR in dev.

### Views

4 SQL views defined via raw SQL migration (Prisma doesn't auto-generate views):
- `digest_view` — digest + job + aggregated subreddits/post count
- `post_view` — post + latest summary + top 3 comments
- `run_view` — job + event count + duration + last event
- `subreddit_view` — subreddit + last digest date + post counts

Prisma view models defined in schema for type-safe reads.

### Seed

`packages/db/prisma/seed.ts`:
- 2-3 sample subreddits (e.g., machinelearning, typescript, selfhosted)
- Config singleton row with sensible defaults

### Deliverables

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma.config.ts`
- `packages/db/src/client.ts`
- `packages/db/src/index.ts`
- `packages/db/prisma/seed.ts`
- Initial migration + views migration
- Docker Compose with Postgres (if not already present)

## WS4: Reddit API Client

### Auth

Script-type OAuth2: POST to `https://www.reddit.com/api/v1/access_token` with client credentials (Basic auth header). Returns `access_token` with ~1h expiry. Auto-refresh on expiry.

### Types

- `RedditPost` — maps Reddit API `t3` response fields
- `RedditComment` — maps Reddit API `t1` response fields
- `RedditAuthToken` — `{ accessToken, expiresAt, tokenType }`

Input types only — mappers to domain Post/PostComment are a later task (content fetcher).

### Error Handling

Uses `RedgestError` from `@redgest/core`:
- 401 → re-authenticate, retry once
- 403 → `REDDIT_API_ERROR` with details
- 429 → `RATE_LIMITED` (rate limiter is a separate task)
- Network errors → `REDDIT_API_ERROR`

### Config

Requires `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` in `@redgest/config`. These need to be added to the config schema.

### Deliverables

- `packages/reddit/src/client.ts` — RedditClient class
- `packages/reddit/src/types.ts` — API response types
- `packages/reddit/src/index.ts` — exports
- Tests with mocked HTTP responses

## WS5: Zod Schemas for LLM Output

### TriageResultSchema

```typescript
z.object({
  selectedPosts: z.array(z.object({
    index: z.number().int(),
    relevanceScore: z.number(),
    rationale: z.string(),
  })),
})
```

Used by `generateTriageResult()` with AI SDK `Output.object()`.

### PostSummarySchema

```typescript
z.object({
  summary: z.string(),
  keyTakeaways: z.array(z.string()),
  insightNotes: z.array(z.string()),
  communityConsensus: z.string().nullable(),
  commentHighlights: z.array(z.object({
    author: z.string(),
    insight: z.string(),
    score: z.number(),
  })),
  sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
  relevanceScore: z.number(),
  contentType: z.enum(['text', 'link', 'image', 'video', 'other']),
  notableLinks: z.array(z.string()),
})
```

Used by `generatePostSummary()` with AI SDK `Output.object()`.

### Input Types (plain TypeScript, not Zod)

- `CandidatePost` — triage input: index, redditId, title, subreddit, score, numComments, ageHours, flair?, selftextPreview?, contentType, url?
- `SummarizationInput` — summarization input: post object, comments array, insightPrompts array

### Deliverables

- `packages/llm/src/schemas.ts` — Zod schemas + inferred types
- `packages/llm/src/types.ts` — Input interfaces (CandidatePost, SummarizationInput)
- Updated `packages/llm/src/index.ts` — exports
- Tests validating schemas against valid/invalid inputs

## Key Decisions

1. **DigestPost replaces JobPost + SubredditPost** — data model spike supersedes reconciled plan
2. **Prisma config reads DATABASE_URL from env directly** — not from @redgest/config (runs before app code)
3. **Reddit config vars added to @redgest/config** — REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET
4. **LLM input types are plain TS interfaces** — not Zod validated; they're constructed internally, not from external input
5. **Views via raw SQL migration** — Prisma view models for type-safe reads

## References

- Data model spike: `docs/spikes/outputs/data-model-implementation.md`
- Prisma v7 spike: `docs/spikes/outputs/prisma-v7-monorepo-architecture.md`
- LLM pipeline spike: `docs/spikes/outputs/llm-pipeline-revision.md`
- Reconciled plan: `docs/synthesis/reconciled-implementation-plan.md`
