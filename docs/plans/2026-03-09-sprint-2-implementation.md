# Sprint 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the database layer, Reddit API client, and LLM output schemas to unblock CQRS, pipeline, and MCP streams.

**Architecture:** Three independent work streams executed in parallel. WS2 creates the Prisma v7 schema, migrations, views, client, and seed. WS4 creates the Reddit API client with script-type OAuth2. WS5 adds Zod schemas for structured LLM output. All follow TDD.

**Tech Stack:** Prisma v7 + @prisma/adapter-pg, PostgreSQL 16, Zod 4, Vitest, TypeScript 5.9

---

## Stream A: WS2 — Database / Prisma v7 (2.5pt)

### Task A1: Prisma v7 Schema — Enums and Config Tables

**Files:**
- Create: `packages/db/prisma/schema.prisma`

**Step 1: Write the schema file with generator, datasource, enums, Subreddit, and Config**

```prisma
// ─────────────────────────────────────────────────────────
// Redgest — schema.prisma (Prisma v7)
// ─────────────────────────────────────────────────────────

generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"
  previewFeatures = ["views"]
}

datasource db {
  provider = "postgresql"
}

// ─── Enums ───────────────────────────────────────────────

enum JobStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  PARTIAL

  @@map("job_status")
}

enum DeliveryChannel {
  NONE
  EMAIL
  SLACK
  ALL

  @@map("delivery_channel")
}

// ─── Subreddit (config table for tracked subs) ───────────

model Subreddit {
  id            String   @id @default(uuid(7))
  name          String   @unique
  insightPrompt String?  @map("insight_prompt") @db.Text
  maxPosts      Int      @default(5) @map("max_posts")
  includeNsfw   Boolean  @default(false) @map("include_nsfw")
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@index([isActive])
  @@map("subreddits")
}

// ─── Config (singleton settings row) ─────────────────────

model Config {
  id                  Int             @id
  globalInsightPrompt String          @map("global_insight_prompt") @db.Text
  defaultLookback     String          @default("24h") @map("default_lookback")
  defaultDelivery     DeliveryChannel @default(NONE) @map("default_delivery")
  llmProvider         String          @map("llm_provider")
  llmModel            String          @map("llm_model")
  schedule            String?
  updatedAt           DateTime        @updatedAt @map("updated_at")

  @@map("config")
}
```

**Step 2: Continue schema — Job, Event, Post, PostComment**

Append to `schema.prisma`:

```prisma
// ─── Job (digest run execution) ──────────────────────────

model Job {
  id           String          @id @default(uuid(7))
  status       JobStatus       @default(QUEUED)
  subreddits   Json
  lookback     String
  delivery     DeliveryChannel @default(NONE)
  triggerRunId String?         @map("trigger_run_id")
  progress     Json?
  startedAt    DateTime?       @map("started_at")
  completedAt  DateTime?       @map("completed_at")
  error        String?         @db.Text
  createdAt    DateTime        @default(now()) @map("created_at")

  postSummaries PostSummary[]
  digest        Digest?

  @@index([status])
  @@index([createdAt])
  @@index([triggerRunId])
  @@map("jobs")
}

// ─── Event (append-only event store) ─────────────────────

model Event {
  id            BigInt   @id @default(autoincrement())
  type          String
  payload       Json
  aggregateId   String   @map("aggregate_id")
  aggregateType String   @map("aggregate_type")
  version       Int
  correlationId String?  @map("correlation_id")
  causationId   String?  @map("causation_id")
  metadata      Json     @default("{}")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([aggregateType, aggregateId, version])
  @@index([type, createdAt])
  @@map("events")
}

// ─── Post (fetched Reddit posts) ─────────────────────────

model Post {
  id           String                    @id @default(uuid(7))
  redditId     String                    @unique @map("reddit_id")
  subreddit    String
  title        String                    @db.Text
  body         String?                   @db.Text
  author       String
  score        Int
  commentCount Int                       @map("comment_count")
  url          String                    @db.Text
  permalink    String                    @db.Text
  flair        String?
  isNsfw       Boolean                   @map("is_nsfw")
  fetchedAt    DateTime                  @map("fetched_at")
  textSearch   Unsupported("tsvector")?  @map("text_search")

  comments    PostComment[]
  summaries   PostSummary[]
  digestPosts DigestPost[]

  @@index([subreddit])
  @@index([fetchedAt])
  @@map("posts")
}

// ─── PostComment (fetched comments on posts) ─────────────

model PostComment {
  id        String   @id @default(uuid(7))
  postId    String   @map("post_id")
  redditId  String   @map("reddit_id")
  author    String
  body      String   @db.Text
  score     Int
  depth     Int
  fetchedAt DateTime @map("fetched_at")

  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@index([postId])
  @@map("post_comments")
}
```

**Step 3: Continue schema — PostSummary, Digest, DigestPost**

Append to `schema.prisma`:

```prisma
// ─── PostSummary (LLM-generated summary per post per job) ─

model PostSummary {
  id                 String   @id @default(uuid(7))
  postId             String   @map("post_id")
  jobId              String   @map("job_id")
  summary            String   @db.Text
  keyTakeaways       Json     @map("key_takeaways")
  insightNotes       String   @map("insight_notes") @db.Text
  commentHighlights  Json     @map("comment_highlights")
  selectionRationale String   @map("selection_rationale") @db.Text
  llmProvider        String   @map("llm_provider")
  llmModel           String   @map("llm_model")
  createdAt          DateTime @default(now()) @map("created_at")

  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)
  job  Job  @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([postId])
  @@index([jobId])
  @@index([postId, jobId])
  @@map("post_summaries")
}

// ─── Digest (rendered output of a job) ───────────────────

model Digest {
  id                 String   @id @default(uuid(7))
  jobId              String   @unique @map("job_id")
  contentMarkdown    String   @map("content_markdown") @db.Text
  contentHtml        String?  @map("content_html") @db.Text
  contentSlackBlocks Json?    @map("content_slack_blocks")
  createdAt          DateTime @default(now()) @map("created_at")

  job         Job          @relation(fields: [jobId], references: [id], onDelete: Cascade)
  digestPosts DigestPost[]

  @@map("digests")
}

// ─── DigestPost (explicit M2M join with rank) ────────────

model DigestPost {
  digestId  String @map("digest_id")
  postId    String @map("post_id")
  subreddit String
  rank      Int

  digest Digest @relation(fields: [digestId], references: [id], onDelete: Cascade)
  post   Post   @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@id([digestId, postId])
  @@index([subreddit])
  @@map("digest_posts")
}
```

**Step 4: Commit schema**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add Prisma v7 schema with 8 tables, 1 join, 2 enums"
```

---

### Task A2: prisma.config.ts and Dependencies

**Files:**
- Create: `packages/db/prisma.config.ts`
- Modify: `packages/db/package.json` (add dependencies)

**Step 1: Install Prisma v7 dependencies**

```bash
pnpm --filter @redgest/db add prisma@latest @prisma/client@latest @prisma/adapter-pg
pnpm --filter @redgest/db add -D tsx dotenv
```

Note: Prisma v7 uses `prisma-client` generator provider, NOT `@prisma/client`. The `@prisma/client` package is still needed for CLI tooling. The actual client is generated to `src/generated/prisma/`.

**Step 2: Write prisma.config.ts**

```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

**Step 3: Commit**

```bash
git add packages/db/prisma.config.ts packages/db/package.json pnpm-lock.yaml
git commit -m "feat(db): add prisma.config.ts with adapter-pg"
```

---

### Task A3: Docker Compose for Postgres

**Files:**
- Create: `docker-compose.yml` (project root)

**Step 1: Write docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: redgest
      POSTGRES_PASSWORD: redgest
      POSTGRES_DB: redgest
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

**Step 2: Start Postgres and verify**

```bash
docker compose up -d
docker compose ps  # Expect: postgres running, port 5432
```

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add docker-compose with Postgres 16"
```

---

### Task A4: Run Initial Migration

**Prereqs:** Postgres running (Task A3), prisma.config.ts (Task A2), schema (Task A1)

**Step 1: Create .env in packages/db for Prisma CLI**

The Prisma CLI needs `DATABASE_URL` via `dotenv/config` in prisma.config.ts. Ensure the root `.env` exists with the DATABASE_URL from `.env.example`:

```bash
cp .env.example .env  # If not already present — edit as needed
```

**Step 2: Generate Prisma client**

```bash
cd packages/db && npx prisma generate && cd ../..
```

Expected: Client generated to `packages/db/src/generated/prisma/`

**Step 3: Run initial migration**

```bash
cd packages/db && npx prisma migrate dev --name init && cd ../..
```

Expected: Migration created in `packages/db/prisma/migrations/`, all 9 tables created (8 + DigestPost join).

**Step 4: Verify tables exist**

```bash
docker compose exec postgres psql -U redgest -c '\dt'
```

Expected: Tables `subreddits`, `config`, `jobs`, `events`, `posts`, `post_comments`, `post_summaries`, `digests`, `digest_posts` listed.

**Step 5: Commit migration**

```bash
git add packages/db/prisma/migrations/ packages/db/src/generated/
git commit -m "feat(db): run initial migration — 9 tables created"
```

---

### Task A5: SQL Views Migration

**Files:**
- Create: migration via `prisma migrate dev --create-only`

**Step 1: Create empty migration**

```bash
cd packages/db && npx prisma migrate dev --create-only --name add_views && cd ../..
```

**Step 2: Write view SQL into the migration file**

Edit the generated migration SQL file (e.g., `packages/db/prisma/migrations/<timestamp>_add_views/migration.sql`) to contain:

```sql
-- digest_view
CREATE OR REPLACE VIEW digest_view AS
SELECT
  d.id                    AS digest_id,
  d.job_id,
  j.status::text          AS job_status,
  j.started_at,
  j.completed_at,
  COALESCE(
    jsonb_agg(DISTINCT dp.subreddit)
      FILTER (WHERE dp.subreddit IS NOT NULL),
    '[]'::jsonb
  )                       AS subreddit_list,
  COUNT(DISTINCT dp.post_id)::int AS post_count,
  d.content_markdown,
  d.content_html,
  d.created_at
FROM digests d
  JOIN jobs j ON j.id = d.job_id
  LEFT JOIN digest_posts dp ON dp.digest_id = d.id
GROUP BY
  d.id, d.job_id, j.status, j.started_at, j.completed_at,
  d.content_markdown, d.content_html, d.created_at;

-- post_view
CREATE OR REPLACE VIEW post_view AS
SELECT
  p.id                AS post_id,
  p.reddit_id,
  p.subreddit,
  p.title,
  p.body,
  p.author,
  p.score,
  p.comment_count,
  p.url,
  p.permalink,
  p.flair,
  p.is_nsfw,
  p.fetched_at,
  ls.summary,
  ls.key_takeaways,
  ls.insight_notes,
  ls.selection_rationale,
  ls.llm_provider,
  ls.llm_model,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'author', tc.author,
        'body',   tc.body,
        'score',  tc.score
      )
    ), '[]'::jsonb)
    FROM (
      SELECT pc.author, pc.body, pc.score
      FROM post_comments pc
      WHERE pc.post_id = p.id
      ORDER BY pc.score DESC
      LIMIT 3
    ) tc
  ) AS top_comments
FROM posts p
LEFT JOIN LATERAL (
  SELECT
    ps.summary,
    ps.key_takeaways,
    ps.insight_notes,
    ps.selection_rationale,
    ps.llm_provider,
    ps.llm_model
  FROM post_summaries ps
  WHERE ps.post_id = p.id
  ORDER BY ps.created_at DESC
  LIMIT 1
) ls ON true;

-- run_view
CREATE OR REPLACE VIEW run_view AS
SELECT
  j.id                  AS job_id,
  j.status::text,
  j.progress,
  j.subreddits,
  COALESCE(ec.event_count, 0)::int AS event_count,
  le.type               AS last_event_type,
  le.created_at         AS last_event_at,
  CASE
    WHEN j.started_at IS NOT NULL AND j.completed_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (j.completed_at - j.started_at))::int
    ELSE NULL
  END                   AS duration_seconds,
  j.trigger_run_id,
  j.started_at,
  j.completed_at,
  j.error,
  j.created_at
FROM jobs j
LEFT JOIN (
  SELECT aggregate_id, COUNT(*)::int AS event_count
  FROM events
  WHERE aggregate_type = 'Job'
  GROUP BY aggregate_id
) ec ON ec.aggregate_id = j.id
LEFT JOIN LATERAL (
  SELECT e.type, e.created_at
  FROM events e
  WHERE e.aggregate_type = 'Job'
    AND e.aggregate_id = j.id
  ORDER BY e.created_at DESC
  LIMIT 1
) le ON true;

-- subreddit_view
CREATE OR REPLACE VIEW subreddit_view AS
WITH digest_stats AS (
  SELECT
    dp.subreddit,
    MAX(d.created_at)              AS last_digest_date,
    COUNT(DISTINCT dp.digest_id)   AS total_digests
  FROM digest_posts dp
    JOIN digests d ON d.id = dp.digest_id
  GROUP BY dp.subreddit
),
last_digest_counts AS (
  SELECT
    dp.subreddit,
    COUNT(*)::int AS posts_in_last
  FROM digest_posts dp
    JOIN digests d ON d.id = dp.digest_id
  WHERE d.created_at = (
    SELECT MAX(d2.created_at)
    FROM digests d2
      JOIN digest_posts dp2 ON dp2.digest_id = d2.id
    WHERE dp2.subreddit = dp.subreddit
  )
  GROUP BY dp.subreddit
)
SELECT
  s.id,
  s.name,
  s.insight_prompt,
  s.max_posts,
  s.include_nsfw,
  s.is_active,
  s.created_at,
  s.updated_at,
  ds.last_digest_date,
  COALESCE(ldc.posts_in_last, 0)::int     AS posts_in_last_digest,
  (SELECT COUNT(*)::int
   FROM posts p WHERE p.subreddit = s.name) AS total_posts_fetched,
  COALESCE(ds.total_digests, 0)::int       AS total_digests_appeared_in
FROM subreddits s
  LEFT JOIN digest_stats ds ON ds.subreddit = s.name
  LEFT JOIN last_digest_counts ldc ON ldc.subreddit = s.name;

-- Additional indexes (raw SQL — not expressible in Prisma schema)
CREATE INDEX idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX idx_events_correlation_id ON events (correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_post_comments_post_score ON post_comments (post_id, score DESC);

-- Singleton enforcement
ALTER TABLE config ADD CONSTRAINT config_singleton CHECK (id = 1);
```

**Step 3: Add view models to schema.prisma**

Append to `schema.prisma`:

```prisma
// ─── Views (read-only, created via SQL migration) ────────

view DigestView {
  digestId        String    @unique @map("digest_id")
  jobId           String    @map("job_id")
  jobStatus       String    @map("job_status")
  startedAt       DateTime? @map("started_at")
  completedAt     DateTime? @map("completed_at")
  subredditList   Json      @map("subreddit_list")
  postCount       Int       @map("post_count")
  contentMarkdown String    @map("content_markdown")
  contentHtml     String?   @map("content_html")
  createdAt       DateTime  @map("created_at")

  @@map("digest_view")
}

view PostView {
  postId             String   @unique @map("post_id")
  redditId           String   @map("reddit_id")
  subreddit          String
  title              String
  body               String?
  author             String
  score              Int
  commentCount       Int      @map("comment_count")
  url                String
  permalink          String
  flair              String?
  isNsfw             Boolean  @map("is_nsfw")
  fetchedAt          DateTime @map("fetched_at")
  summary            String?
  keyTakeaways       Json?    @map("key_takeaways")
  insightNotes       String?  @map("insight_notes")
  selectionRationale String?  @map("selection_rationale")
  topComments        Json?    @map("top_comments")
  llmProvider        String?  @map("llm_provider")
  llmModel           String?  @map("llm_model")

  @@map("post_view")
}

view RunView {
  jobId           String    @unique @map("job_id")
  status          String
  progress        Json?
  subreddits      Json
  eventCount      Int       @map("event_count")
  lastEventType   String?   @map("last_event_type")
  lastEventAt     DateTime? @map("last_event_at")
  durationSeconds Int?      @map("duration_seconds")
  triggerRunId    String?   @map("trigger_run_id")
  startedAt       DateTime? @map("started_at")
  completedAt     DateTime? @map("completed_at")
  error           String?
  createdAt       DateTime  @map("created_at")

  @@map("run_view")
}

view SubredditView {
  id                     String    @unique
  name                   String
  insightPrompt          String?   @map("insight_prompt")
  maxPosts               Int       @map("max_posts")
  includeNsfw            Boolean   @map("include_nsfw")
  isActive               Boolean   @map("is_active")
  createdAt              DateTime  @map("created_at")
  updatedAt              DateTime  @map("updated_at")
  lastDigestDate         DateTime? @map("last_digest_date")
  postsInLastDigest      Int       @map("posts_in_last_digest")
  totalPostsFetched      Int       @map("total_posts_fetched")
  totalDigestsAppearedIn Int       @map("total_digests_appeared_in")

  @@map("subreddit_view")
}
```

**Step 4: Apply the views migration**

```bash
cd packages/db && npx prisma migrate dev && cd ../..
```

**Step 5: Regenerate client (v7 doesn't auto-regenerate after migrate)**

```bash
cd packages/db && npx prisma generate && cd ../..
```

**Step 6: Commit**

```bash
git add packages/db/prisma/migrations/ packages/db/prisma/schema.prisma packages/db/src/generated/
git commit -m "feat(db): add 4 SQL views + additional indexes + singleton constraint"
```

---

### Task A6: Singleton Prisma Client

**Files:**
- Create: `packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts`

**Step 1: Write client.ts**

```typescript
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

**Step 2: Update index.ts**

```typescript
export { prisma } from "./client.js";
export * from "../generated/prisma/client.js";
```

**Step 3: Commit**

```bash
git add packages/db/src/client.ts packages/db/src/index.ts
git commit -m "feat(db): add singleton Prisma client with PrismaPg adapter"
```

---

### Task A7: Seed Script

**Files:**
- Create: `packages/db/prisma/seed.ts`

**Step 1: Write seed.ts**

```typescript
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  // Seed subreddits
  const subreddits = [
    {
      name: "machinelearning",
      insightPrompt: "AI/ML research breakthroughs, new model architectures, practical deployment techniques",
      maxPosts: 5,
    },
    {
      name: "typescript",
      insightPrompt: "TypeScript language features, type system patterns, tooling improvements",
      maxPosts: 5,
    },
    {
      name: "selfhosted",
      insightPrompt: "Self-hosting tools, Docker setups, privacy-first alternatives to SaaS",
      maxPosts: 3,
    },
  ];

  for (const sub of subreddits) {
    await prisma.subreddit.upsert({
      where: { name: sub.name },
      update: sub,
      create: sub,
    });
  }

  // Seed singleton config
  await prisma.config.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      globalInsightPrompt:
        "I'm a software engineer interested in AI/ML, TypeScript ecosystem, and self-hosting. Focus on practical, actionable content.",
      defaultLookback: "24h",
      defaultDelivery: "NONE",
      llmProvider: "anthropic",
      llmModel: "claude-sonnet-4-20250514",
    },
  });

  console.log("Seed complete: 3 subreddits + config singleton");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

**Step 2: Run seed**

```bash
cd packages/db && npx prisma db seed && cd ../..
```

Expected: "Seed complete: 3 subreddits + config singleton"

**Step 3: Verify seed data**

```bash
docker compose exec postgres psql -U redgest -c 'SELECT name FROM subreddits;'
docker compose exec postgres psql -U redgest -c 'SELECT id, llm_provider FROM config;'
```

**Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): add seed script with 3 subreddits + config"
```

---

## Stream B: WS4 — Reddit API Client (1pt)

### Task B1: Add Reddit Config Vars

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/__tests__/config.test.ts`
- Modify: `.env.example`

**Step 1: Write failing test**

Add to `packages/config/src/__tests__/config.test.ts`:

```typescript
it("requires REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET", () => {
  const result = configSchema.safeParse({
    ...validEnv,
    REDDIT_CLIENT_ID: undefined,
    REDDIT_CLIENT_SECRET: undefined,
  });
  expect(result.success).toBe(false);
});

it("parses valid Reddit credentials", () => {
  const result = configSchema.safeParse({
    ...validEnv,
    REDDIT_CLIENT_ID: "abc123",
    REDDIT_CLIENT_SECRET: "secret456",
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.REDDIT_CLIENT_ID).toBe("abc123");
    expect(result.data.REDDIT_CLIENT_SECRET).toBe("secret456");
  }
});
```

Also add `REDDIT_CLIENT_ID: "test-client-id"` and `REDDIT_CLIENT_SECRET: "test-client-secret"` to the `validEnv` object used in existing tests.

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @redgest/config exec vitest run
```

Expected: FAIL — `REDDIT_CLIENT_ID` not in schema

**Step 3: Add Reddit vars to config schema**

In `packages/config/src/schema.ts`, add under the `// Required` section:

```typescript
REDDIT_CLIENT_ID: z.string().min(1, "REDDIT_CLIENT_ID is required"),
REDDIT_CLIENT_SECRET: z.string().min(1, "REDDIT_CLIENT_SECRET is required"),
```

**Step 4: Run tests to verify pass**

```bash
pnpm --filter @redgest/config exec vitest run
```

Expected: ALL PASS

**Step 5: Update .env.example**

Add under `# --- Required ---`:

```
# Reddit API credentials (script-type app)
REDDIT_CLIENT_ID=""
REDDIT_CLIENT_SECRET=""
```

**Step 6: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/__tests__/config.test.ts .env.example
git commit -m "feat(config): add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET"
```

---

### Task B2: Reddit API Types

**Files:**
- Create: `packages/reddit/src/types.ts`

**Step 1: Write types**

```typescript
/**
 * Reddit OAuth2 token response.
 */
export interface RedditAuthToken {
  accessToken: string;
  tokenType: string;
  expiresAt: number; // Unix timestamp (ms)
}

/**
 * Reddit API "thing" wrapper for listings.
 */
export interface RedditListing<T> {
  kind: "Listing";
  data: {
    after: string | null;
    before: string | null;
    children: Array<{ kind: string; data: T }>;
  };
}

/**
 * Reddit post (t3) data from the API.
 * Only the fields we use — Reddit returns many more.
 */
export interface RedditPostData {
  id: string;
  name: string; // t3_ prefixed
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  link_flair_text: string | null;
  over_18: boolean;
  created_utc: number;
  is_self: boolean;
}

/**
 * Reddit comment (t1) data from the API.
 */
export interface RedditCommentData {
  id: string;
  name: string; // t1_ prefixed
  author: string;
  body: string;
  score: number;
  depth: number;
  created_utc: number;
}

/**
 * Options for fetching subreddit posts.
 */
export interface FetchPostsOptions {
  subreddit: string;
  sort: "hot" | "top" | "rising" | "new";
  limit?: number;
  timeframe?: "hour" | "day" | "week" | "month" | "year" | "all";
}
```

**Step 2: Commit**

```bash
git add packages/reddit/src/types.ts
git commit -m "feat(reddit): add Reddit API response types"
```

---

### Task B3: Reddit Client — Tests First

**Files:**
- Create: `packages/reddit/src/__tests__/client.test.ts`
- Create: `packages/reddit/src/client.ts`

**Step 1: Install test dependency**

```bash
pnpm --filter @redgest/reddit add @redgest/core@workspace:*
```

**Step 2: Write failing tests**

Create `packages/reddit/src/__tests__/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedditClient } from "../client.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockTokenResponse() {
  return new Response(
    JSON.stringify({
      access_token: "test-token-123",
      token_type: "bearer",
      expires_in: 3600,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mockTokenExpiredResponse() {
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
  });
}

function mock403Response() {
  return new Response("Forbidden", { status: 403 });
}

function mock429Response() {
  return new Response("Too Many Requests", { status: 429 });
}

describe("RedditClient", () => {
  let client: RedditClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new RedditClient({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      userAgent: "redgest:test:v0.0.1",
    });
  });

  describe("authenticate", () => {
    it("obtains an access token via script-type OAuth2", async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await client.authenticate();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/api/v1/access_token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        }),
      );
    });

    it("sets the Authorization header with Basic auth", async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await client.authenticate();

      const call = mockFetch.mock.calls[0];
      const headers = call[1].headers;
      const expected = btoa("test-client-id:test-client-secret");
      expect(headers["Authorization"]).toBe(`Basic ${expected}`);
    });

    it("stores the token with correct expiry", async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await client.authenticate();

      expect(client.isAuthenticated()).toBe(true);
    });
  });

  describe("error handling", () => {
    it("throws REDDIT_API_ERROR on 403", async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await client.authenticate();

      mockFetch.mockResolvedValueOnce(mock403Response());

      await expect(client.get("/test")).rejects.toThrow(
        expect.objectContaining({ code: "REDDIT_API_ERROR" }),
      );
    });

    it("throws RATE_LIMITED on 429", async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await client.authenticate();

      mockFetch.mockResolvedValueOnce(mock429Response());

      await expect(client.get("/test")).rejects.toThrow(
        expect.objectContaining({ code: "RATE_LIMITED" }),
      );
    });

    it("re-authenticates on 401 and retries once", async () => {
      // Initial auth
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await client.authenticate();

      // First call returns 401
      mockFetch.mockResolvedValueOnce(mockTokenExpiredResponse());
      // Re-auth
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      // Retry returns success
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "ok" }), { status: 200 }),
      );

      const result = await client.get("/test");
      expect(result).toEqual({ data: "ok" });
      // 1 initial auth + 1 failed call + 1 re-auth + 1 retry = 4 total
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });
});
```

**Step 3: Run test to verify it fails**

```bash
pnpm --filter @redgest/reddit exec vitest run
```

Expected: FAIL — `RedditClient` does not exist

**Step 4: Implement RedditClient**

Create `packages/reddit/src/client.ts`:

```typescript
import { RedgestError } from "@redgest/core";
import type { RedditAuthToken } from "./types.js";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

export interface RedditClientOptions {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}

export class RedditClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly userAgent: string;
  private token: RedditAuthToken | null = null;

  constructor(options: RedditClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.userAgent = options.userAgent;
  }

  async authenticate(): Promise<void> {
    const credentials = btoa(`${this.clientId}:${this.clientSecret}`);

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.userAgent,
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      throw new RedgestError(
        "REDDIT_API_ERROR",
        `Authentication failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    this.token = {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  isAuthenticated(): boolean {
    return this.token !== null && Date.now() < this.token.expiresAt;
  }

  async get<T>(path: string): Promise<T> {
    if (!this.token) {
      throw new RedgestError("REDDIT_API_ERROR", "Not authenticated. Call authenticate() first.");
    }

    const response = await this.request(path);

    // 401: re-auth and retry once
    if (response.status === 401) {
      await this.authenticate();
      const retry = await this.request(path);
      return this.handleResponse<T>(retry);
    }

    return this.handleResponse<T>(response);
  }

  private async request(path: string): Promise<Response> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

    return fetch(url, {
      headers: {
        "Authorization": `${this.token!.tokenType} ${this.token!.accessToken}`,
        "User-Agent": this.userAgent,
      },
    });
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 403) {
      throw new RedgestError("REDDIT_API_ERROR", `Forbidden: ${response.statusText}`, {
        status: 403,
      });
    }

    if (response.status === 429) {
      throw new RedgestError("RATE_LIMITED", "Reddit API rate limit exceeded", {
        status: 429,
      });
    }

    if (!response.ok) {
      throw new RedgestError(
        "REDDIT_API_ERROR",
        `Reddit API error: ${response.status} ${response.statusText}`,
        { status: response.status },
      );
    }

    return response.json() as Promise<T>;
  }
}
```

**Step 5: Run tests to verify pass**

```bash
pnpm --filter @redgest/reddit exec vitest run
```

Expected: ALL PASS

**Step 6: Update exports**

Replace `packages/reddit/src/index.ts`:

```typescript
export { RedditClient } from "./client.js";
export type { RedditClientOptions } from "./client.js";
export type {
  RedditAuthToken,
  RedditListing,
  RedditPostData,
  RedditCommentData,
  FetchPostsOptions,
} from "./types.js";
```

**Step 7: Commit**

```bash
git add packages/reddit/src/
git commit -m "feat(reddit): add RedditClient with script-type OAuth2 and error handling"
```

---

## Stream C: WS5 — Zod Schemas for LLM Output (1pt)

### Task C1: Triage Result Schema — Tests First

**Files:**
- Create: `packages/llm/src/schemas.ts`
- Create: `packages/llm/src/__tests__/schemas.test.ts`

**Step 1: Write failing tests**

Create `packages/llm/src/__tests__/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { TriageResultSchema } from "../schemas.js";

describe("TriageResultSchema", () => {
  it("validates a correct triage result", () => {
    const valid = {
      selectedPosts: [
        { index: 0, relevanceScore: 8.5, rationale: "Directly relevant to AI interests" },
        { index: 3, relevanceScore: 7.2, rationale: "Novel TS pattern worth tracking" },
      ],
    };
    const result = TriageResultSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects non-integer index", () => {
    const invalid = {
      selectedPosts: [{ index: 1.5, relevanceScore: 8, rationale: "test" }],
    };
    const result = TriageResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing rationale", () => {
    const invalid = {
      selectedPosts: [{ index: 0, relevanceScore: 8 }],
    };
    const result = TriageResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("accepts empty selectedPosts array", () => {
    const result = TriageResultSchema.safeParse({ selectedPosts: [] });
    expect(result.success).toBe(true);
  });

  it("rejects missing selectedPosts", () => {
    const result = TriageResultSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @redgest/llm exec vitest run src/__tests__/schemas.test.ts
```

Expected: FAIL — cannot import `TriageResultSchema`

**Step 3: Implement TriageResultSchema**

Create `packages/llm/src/schemas.ts`:

```typescript
import { z } from "zod";

export const TriageResultSchema = z.object({
  selectedPosts: z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .describe("Zero-based index of post from candidate list"),
        relevanceScore: z
          .number()
          .describe("1 (tangential) to 10 (core interest)"),
        rationale: z
          .string()
          .describe("1-2 sentence explanation why post matters for THIS user"),
      }),
    )
    .describe("Top posts ordered by relevance, most relevant first"),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;
```

**Step 4: Run tests to verify pass**

```bash
pnpm --filter @redgest/llm exec vitest run src/__tests__/schemas.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/llm/src/schemas.ts packages/llm/src/__tests__/schemas.test.ts
git commit -m "feat(llm): add TriageResultSchema with Zod validation"
```

---

### Task C2: Post Summary Schema — Tests First

**Files:**
- Modify: `packages/llm/src/schemas.ts`
- Modify: `packages/llm/src/__tests__/schemas.test.ts`

**Step 1: Write failing tests**

Add to `packages/llm/src/__tests__/schemas.test.ts`:

```typescript
import { PostSummarySchema } from "../schemas.js";

describe("PostSummarySchema", () => {
  const validSummary = {
    summary: "A comprehensive analysis of new LoRA fine-tuning techniques that reduce cost by 80%.",
    keyTakeaways: [
      "3B-param LoRA at $12/run",
      "Works with quantized base models",
      "Open-source implementation available",
    ],
    insightNotes: [
      "3B-param LoRA at $12/run applies directly to small-model deployment strategy",
    ],
    communityConsensus: "Top comments agree the cost reduction is real but question scalability.",
    commentHighlights: [
      { author: "ml_researcher", insight: "Confirmed results on Llama 3.3", score: 145 },
      { author: "startup_dev", insight: "Using this in production with good results", score: 89 },
    ],
    sentiment: "positive" as const,
    relevanceScore: 9.2,
    contentType: "text" as const,
    notableLinks: ["https://github.com/example/lora-paper"],
  };

  it("validates a complete post summary", () => {
    const result = PostSummarySchema.safeParse(validSummary);
    expect(result.success).toBe(true);
  });

  it("accepts null communityConsensus", () => {
    const result = PostSummarySchema.safeParse({
      ...validSummary,
      communityConsensus: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays for optional collections", () => {
    const result = PostSummarySchema.safeParse({
      ...validSummary,
      commentHighlights: [],
      notableLinks: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid sentiment value", () => {
    const result = PostSummarySchema.safeParse({
      ...validSummary,
      sentiment: "angry",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid contentType value", () => {
    const result = PostSummarySchema.safeParse({
      ...validSummary,
      contentType: "podcast",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = PostSummarySchema.safeParse({ summary: "just a summary" });
    expect(result.success).toBe(false);
  });

  it("rejects commentHighlight without author", () => {
    const result = PostSummarySchema.safeParse({
      ...validSummary,
      commentHighlights: [{ insight: "test", score: 10 }],
    });
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @redgest/llm exec vitest run src/__tests__/schemas.test.ts
```

Expected: FAIL — `PostSummarySchema` not exported

**Step 3: Add PostSummarySchema to schemas.ts**

Append to `packages/llm/src/schemas.ts`:

```typescript
export const PostSummarySchema = z.object({
  summary: z
    .string()
    .describe("2-4 sentence executive summary. Lead with key finding. No filler."),
  keyTakeaways: z
    .array(
      z.string().describe(
        "One concrete fact, technique, or finding — single sentence",
      ),
    )
    .describe("3-5 key takeaways from post and discussion"),
  insightNotes: z
    .array(
      z.string().describe(
        "Specific, actionable connection to user interests. MUST cite detail from post.",
      ),
    )
    .describe("1-3 insight notes connecting post to user interests"),
  communityConsensus: z
    .string()
    .nullable()
    .describe("What top comments agree/disagree about. Null if no comments."),
  commentHighlights: z
    .array(
      z.object({
        author: z.string().describe("Reddit username"),
        insight: z.string().describe("Key point from comment, 1-2 sentences"),
        score: z.number().describe("Comment upvote score"),
      }),
    )
    .describe("2-4 most insightful comments"),
  sentiment: z
    .enum(["positive", "negative", "neutral", "mixed"])
    .describe("Overall sentiment of post and discussion"),
  relevanceScore: z
    .number()
    .describe("How relevant to user interests: 1 (low) to 10 (high)"),
  contentType: z
    .enum(["text", "link", "image", "video", "other"])
    .describe("Type of Reddit post"),
  notableLinks: z
    .array(z.string())
    .describe("Important URLs/resources mentioned. Empty if none."),
});

export type PostSummary = z.infer<typeof PostSummarySchema>;
```

**Step 4: Run tests to verify pass**

```bash
pnpm --filter @redgest/llm exec vitest run src/__tests__/schemas.test.ts
```

Expected: ALL PASS

**Step 5: Commit**

```bash
git add packages/llm/src/schemas.ts packages/llm/src/__tests__/schemas.test.ts
git commit -m "feat(llm): add PostSummarySchema with Zod validation"
```

---

### Task C3: Input Types

**Files:**
- Create: `packages/llm/src/types.ts`

**Step 1: Write input interfaces**

```typescript
/**
 * Input to the triage LLM call. Represents a candidate post for selection.
 * Constructed internally from Reddit API data — not validated from external input.
 */
export interface CandidatePost {
  /** Position in the candidate list (0-indexed) */
  index: number;
  /** Reddit's t3_ prefixed ID, for mapping back after triage */
  redditId: string;
  title: string;
  subreddit: string;
  score: number;
  numComments: number;
  /** Hours since post was created */
  ageHours: number;
  flair?: string;
  /** First ~200 chars of selftext */
  selftextPreview?: string;
  contentType: "text" | "link" | "image" | "video";
  url?: string;
}

/**
 * Input to the summarization LLM call.
 */
export interface SummarizationInput {
  post: {
    redditId: string;
    title: string;
    subreddit: string;
    author: string;
    score: number;
    numComments: number;
    /** Full body text, pre-truncated by caller if over token budget */
    selftext: string;
    contentType: "text" | "link" | "image" | "video";
    url?: string;
  };
  comments: Array<{
    author: string;
    /** Pre-truncated comment body */
    body: string;
    score: number;
  }>;
  /** User interest prompts (global + per-subreddit) */
  insightPrompts: string[];
}
```

**Step 2: Commit**

```bash
git add packages/llm/src/types.ts
git commit -m "feat(llm): add CandidatePost and SummarizationInput types"
```

---

### Task C4: Update LLM Package Exports

**Files:**
- Modify: `packages/llm/src/index.ts`

**Step 1: Update index.ts**

```typescript
export {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  buildSummarizationSystemPrompt,
  buildSummarizationUserPrompt,
  sanitizeForPrompt,
} from "./prompts/index.js";

export type {
  TriagePostCandidate,
  SummarizationPost,
  SummarizationComment,
} from "./prompts/index.js";

export { TriageResultSchema, PostSummarySchema } from "./schemas.js";
export type { TriageResult, PostSummary } from "./schemas.js";
export type { CandidatePost, SummarizationInput } from "./types.js";
```

**Step 2: Run all LLM tests**

```bash
pnpm --filter @redgest/llm exec vitest run
```

Expected: ALL PASS (both prompts.test.ts and schemas.test.ts)

**Step 3: Commit**

```bash
git add packages/llm/src/index.ts
git commit -m "feat(llm): export schemas and input types from package"
```

---

## Final: Full Test Suite Verification

### Task Z1: Run All Tests

**Step 1: Run turbo test**

```bash
turbo test
```

Expected: All packages pass. Sprint 1 tests (34) + Sprint 2 tests should all be green.

**Step 2: Run turbo build**

```bash
turbo build
```

Expected: All packages build successfully.

**Step 3: Run turbo lint**

```bash
turbo lint
```

Expected: No lint errors.

---

## Task Dependency Map

```
Stream A (WS2):  A1 → A2 → A3 → A4 → A5 → A6 → A7
Stream B (WS4):  B1 → B2 → B3
Stream C (WS5):  C1 → C2 → C3 → C4

All streams → Z1 (final verification)
```

Streams A, B, and C are fully independent and can execute in parallel.

## Summary

| Task | Description | Commits |
|------|-------------|---------|
| A1 | Prisma schema (8 tables + join + enums) | 1 |
| A2 | prisma.config.ts + deps | 1 |
| A3 | Docker Compose for Postgres | 1 |
| A4 | Initial migration | 1 |
| A5 | SQL views migration + view models | 1 |
| A6 | Singleton Prisma client | 1 |
| A7 | Seed script | 1 |
| B1 | Reddit config vars (TDD) | 1 |
| B2 | Reddit API types | 1 |
| B3 | RedditClient class (TDD) | 1 |
| C1 | TriageResultSchema (TDD) | 1 |
| C2 | PostSummarySchema (TDD) | 1 |
| C3 | Input types (CandidatePost, SummarizationInput) | 1 |
| C4 | Update LLM exports | 1 |
| Z1 | Full verification | 0 |
