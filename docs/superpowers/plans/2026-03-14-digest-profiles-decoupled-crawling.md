# Implementation Plan: Digest Profiles + Decoupled Crawling

**Date:** 2026-03-14
**Status:** Draft
**Estimated Effort:** ~30 story points across 8 steps

## Overview

Two architectural changes that compound:
1. **Digest Profiles** — Replace singleton Config for digest-specific settings. A profile groups subreddits + schedule + insight prompt + delivery + lookback + maxPosts.
2. **Decoupled Crawling** — Separate Reddit fetching from the digest pipeline. Crawlers run on their own schedule, posts accumulate in DB, digest generation queries local data.

## Design Decisions (Agreed)

| Decision | Choice |
|----------|--------|
| Post retention | Keep everything. BRIN index on `fetchedAt`. Phase 3 search needs history. |
| Score tracking | `scoreDelta` column on `Post`. Computed on upsert. |
| Comment merge | Keep delete-and-recreate. Simple, comments always fresh. |
| Rate limiter | Single shared TokenBucket + staggered crawl offsets. |
| Backfill on add | Immediate deep fetch on `add_subreddit`. One-time seed. |
| Real-time alerting | Not now. Design crawl events to make it possible later. |
| Cross-post dedup | Ignore. Rare at personal scale, triage handles implicitly. |
| Profile filters | Nullable `filters JSONB` column. Don't implement filter logic yet. |
| Crawl observability | `CrawlCompleted`/`CrawlFailed` events + `get_crawl_status` MCP tool. |
| Migration path | Incremental — each step independently shippable. |
| Multi-user | Ignore. Profiles are about interests, not users. |
| "Generate now" UX | Hybrid — default to crawled data, `force_refresh: true` triggers crawl-then-digest. |

---

## Step 1: DigestProfile Schema + Migration

**Files:** `packages/db/prisma/schema.prisma`, new migration

### New Tables

```prisma
model DigestProfile {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name             String    @unique
  insightPrompt    String?   @map("insight_prompt")
  schedule         String?                          // cron expression, null = manual only
  lookbackHours    Int       @default(24) @map("lookback_hours")
  maxPosts         Int       @default(5) @map("max_posts")
  delivery         DeliveryChannel @default(NONE)
  isActive         Boolean   @default(true) @map("is_active")
  filters          Json?                            // future: min score, flair, keywords
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  subreddits DigestProfileSubreddit[]
  jobs       Job[]

  @@map("digest_profiles")
}

model DigestProfileSubreddit {
  profileId   String        @map("profile_id") @db.Uuid
  subredditId String        @map("subreddit_id") @db.Uuid

  profile     DigestProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  subreddit   Subreddit     @relation(fields: [subredditId], references: [id], onDelete: Cascade)

  @@id([profileId, subredditId])
  @@map("digest_profile_subreddits")
}
```

### Schema Modifications

```prisma
// Add to Subreddit model:
  crawlIntervalMinutes  Int       @default(30) @map("crawl_interval_minutes")
  nextCrawlAt           DateTime? @map("next_crawl_at")
  profiles              DigestProfileSubreddit[]

// Add to Post model:
  scoreDelta  Int @default(0) @map("score_delta")

// Add to Job model:
  profileId   String?        @map("profile_id") @db.Uuid
  profile     DigestProfile? @relation(fields: [profileId], references: [id])
```

### Data Migration (SQL in migration file)

```sql
-- Create "Default" profile from existing config
INSERT INTO digest_profiles (id, name, insight_prompt, schedule, lookback_hours, max_posts, delivery, is_active)
SELECT
  gen_random_uuid(),
  'Default',
  c.global_insight_prompt,
  c.schedule,
  COALESCE(
    CASE WHEN c.default_lookback ~ '^\d+h$'
         THEN CAST(REPLACE(c.default_lookback, 'h', '') AS int)
         ELSE 24
    END,
    24
  ),
  COALESCE(c.max_digest_posts, 5),
  c.default_delivery,
  true
FROM config c
WHERE c.id = 1;

-- Link all active subreddits to Default profile
INSERT INTO digest_profile_subreddits (profile_id, subreddit_id)
SELECT dp.id, s.id
FROM digest_profiles dp, subreddits s
WHERE dp.name = 'Default' AND s.is_active = true;
```

### Config Table Cleanup

The `config` table keeps **only global settings** that aren't profile-specific:
- `llmProvider`, `llmModel` — global LLM config
- `globalInsightPrompt` — global prompt (combined with profile + subreddit prompts)

Fields that move to profiles (kept in config for backward compat, but deprecated):
- `schedule` → `DigestProfile.schedule`
- `defaultLookback` → `DigestProfile.lookbackHours`
- `defaultDelivery` → `DigestProfile.delivery`
- `maxDigestPosts` → `DigestProfile.maxPosts`

**Don't drop these columns yet.** Mark them deprecated in code. Remove in a later cleanup step.

### Views Update

Update `subreddit_view` to include crawl fields:
```sql
-- Add to subreddit_view SELECT:
  s.crawl_interval_minutes,
  s.next_crawl_at
```

Add `profile_view`:
```sql
CREATE VIEW profile_view AS
SELECT
  dp.id AS profile_id,
  dp.name,
  dp.insight_prompt,
  dp.schedule,
  dp.lookback_hours,
  dp.max_posts,
  dp.delivery::text,
  dp.is_active,
  dp.created_at,
  dp.updated_at,
  COALESCE(
    jsonb_agg(
      jsonb_build_object('id', s.id, 'name', s.name)
    ) FILTER (WHERE s.id IS NOT NULL),
    '[]'::jsonb
  ) AS subreddit_list,
  COUNT(DISTINCT dps.subreddit_id)::int AS subreddit_count
FROM digest_profiles dp
LEFT JOIN digest_profile_subreddits dps ON dps.profile_id = dp.id
LEFT JOIN subreddits s ON s.id = dps.subreddit_id
GROUP BY dp.id;
```

### Acceptance Criteria
- [x] Migration applies cleanly on existing DB
- [x] "Default" profile created with current config values
- [x] All active subreddits linked to Default profile
- [x] `turbo db:generate` produces client with new models
- [x] Existing tests still pass (no behavioral change)

---

## Step 2: Profile CQRS (Commands + Queries)

**Files:** `packages/core/src/commands/types.ts`, `packages/core/src/queries/types.ts`, new handler files

### New Commands

```typescript
// CommandMap additions:
CreateProfile: {
  name: string;
  insightPrompt?: string;
  schedule?: string | null;
  lookbackHours?: number;
  maxPosts?: number;
  delivery?: DeliveryChannel;
  subredditIds?: string[];
};
UpdateProfile: {
  profileId: string;
  name?: string;
  insightPrompt?: string;
  schedule?: string | null;
  lookbackHours?: number;
  maxPosts?: number;
  delivery?: DeliveryChannel;
  subredditIds?: string[];  // replaces full list
  active?: boolean;
};
DeleteProfile: {
  profileId: string;
};

// CommandResultMap:
CreateProfile: { profileId: string };
UpdateProfile: { profileId: string };
DeleteProfile: { profileId: string };

// CommandEventMap:
CreateProfile: "ProfileCreated";
UpdateProfile: never;
DeleteProfile: "ProfileDeleted";
```

### New Queries

```typescript
// QueryMap additions:
ListProfiles: Record<string, never>;
GetProfile: { profileId: string };

// QueryResultMap:
ListProfiles: ProfileView[];
GetProfile: ProfileView | null;
```

### New Domain Events

```typescript
// DomainEventMap additions:
ProfileCreated: { profileId: string; name: string };
ProfileDeleted: { profileId: string; name: string };
```

### Handler Files

- `packages/core/src/commands/handlers/create-profile.ts`
- `packages/core/src/commands/handlers/update-profile.ts`
- `packages/core/src/commands/handlers/delete-profile.ts`
- `packages/core/src/queries/handlers/list-profiles.ts`
- `packages/core/src/queries/handlers/get-profile.ts`

### Acceptance Criteria
- [ ] CRUD operations work on profiles
- [ ] Creating a profile with subredditIds links them in join table
- [ ] Updating subredditIds replaces the full set (delete + create)
- [ ] Deleting a profile cascades to join table, doesn't delete subreddits
- [ ] Can't delete the "Default" profile (guard in handler)
- [ ] Unit tests for all handlers

---

## Step 3: Profile MCP Tools

**Files:** `packages/mcp-server/src/tools.ts`

### New Tools

```
create_profile    — Create a new digest profile
update_profile    — Update profile settings (name, prompt, schedule, subreddits, etc.)
delete_profile    — Delete a digest profile (cannot delete "Default")
list_profiles     — List all digest profiles with subreddit details
get_profile       — Get a specific profile by name or ID
```

### Modify Existing Tools

- **`generate_digest`** — Add optional `profile` param (name or ID). If provided, loads profile's subreddits, lookback, maxPosts. Falls back to legacy behavior if omitted.
- **`update_config`** — Deprecation notice in description: "For per-digest settings, use profiles instead."

### Acceptance Criteria
- [ ] All 5 profile tools registered and functional
- [ ] `generate_digest` with `profile: "Default"` produces same result as before
- [ ] `generate_digest` without profile uses all active subs (backward compat)
- [ ] Profile name resolution (case-insensitive) works like subreddit name resolution

---

## Step 4: Wire Pipeline to Profiles

**Files:** `packages/core/src/pipeline/orchestrator.ts`, `packages/core/src/commands/handlers/generate-digest.ts`

### Changes

1. **`GenerateDigest` command** accepts `profileId`:
   ```typescript
   GenerateDigest: {
     profileId?: string;      // NEW
     subredditIds?: string[];
     lookbackHours?: number;
     forceRefresh?: boolean;
     maxPosts?: number;
   };
   ```

2. **`Job` creation** stores `profileId`:
   ```typescript
   const job = await ctx.db.job.create({
     data: {
       status: "QUEUED",
       subreddits: subredditIds,
       lookback,
       profileId: params.profileId ?? null,
     },
   });
   ```

3. **Pipeline orchestrator** loads profile settings when profileId is on the job:
   - Profile's `insightPrompt` is combined with global + per-sub prompts
   - Profile's `lookbackHours` used unless explicitly overridden
   - Profile's `maxPosts` used unless explicitly overridden

4. **DigestCompleted event handler** reads profile's delivery settings to determine channels.

### Resolution Priority (for overlapping settings)

```
maxPosts:     explicit param > profile > config > default (5)
lookback:     explicit param > profile > config > default (24h)
insightPrompt: global + profile + per-subreddit (all combined)
delivery:     profile > config > NONE
subreddits:   explicit param > profile > all active
```

### Acceptance Criteria
- [ ] `generate_digest` with profileId uses profile settings
- [ ] `generate_digest` without profileId = legacy behavior (unchanged)
- [ ] Delivery uses profile's delivery setting, not config's
- [ ] Profile insight prompt combined with global + per-sub
- [ ] Job record stores profileId

---

## Step 5: Decoupled Crawling - Subreddit Crawl Fields

**Already done in Step 1 schema.** This step wires the behavior.

### Subreddit Changes

- `add_subreddit` command sets `nextCrawlAt = now()` (immediate first crawl)
- `update_subreddit` allows setting `crawlIntervalMinutes`
- MCP tool `update_subreddit` gets `crawlInterval` param

### Post Upsert - Score Delta

Update `fetchStep` (and later crawl task) to compute `scoreDelta`:
```typescript
// In post upsert:
const existing = await db.post.findUnique({ where: { redditId: post.id }, select: { score: true } });
const scoreDelta = existing ? post.score - existing.score : 0;

await db.post.upsert({
  where: { redditId: post.id },
  create: { ..., scoreDelta: 0 },
  update: { ..., score: post.score, scoreDelta },
});
```

### Acceptance Criteria
- [ ] New subreddits get `nextCrawlAt = now()`
- [ ] `scoreDelta` computed correctly on post upsert
- [ ] `update_subreddit` supports `crawlInterval` parameter
- [ ] Existing fetch step still works (it's still used until Step 7)

---

## Step 6: Crawl Task (Trigger.dev)

**Files:** `apps/worker/src/trigger/crawl-subreddit.ts`, `apps/worker/src/trigger/scheduled-crawl.ts`

### `crawl-subreddit` Task

```typescript
export const crawlSubreddit = task({
  id: "crawl-subreddit",
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000 },
  run: async (payload: { subredditId: string }) => {
    // 1. Load subreddit from DB
    // 2. Fetch from Reddit API (3 sorts + comments)
    // 3. Upsert posts with scoreDelta
    // 4. Delete/recreate comments
    // 5. Update subreddit.lastFetchedAt and nextCrawlAt
    // 6. Emit CrawlCompleted event
  },
});
```

### `scheduled-crawl` Task

```typescript
export const scheduledCrawl = schedules.task({
  id: "scheduled-crawl",
  cron: "*/5 * * * *",  // Check every 5 minutes
  run: async () => {
    // 1. Find subreddits where nextCrawlAt <= now() AND isActive
    // 2. For each, trigger crawl-subreddit with idempotency key
    // 3. Stagger: batch trigger with slight delays to avoid rate limit burst
  },
});
```

### New Domain Events

```typescript
CrawlCompleted: {
  subredditId: string;
  subreddit: string;
  postCount: number;
  newPostCount: number;
  updatedPostCount: number;
};
CrawlFailed: {
  subredditId: string;
  subreddit: string;
  error: string;
};
```

### In-Process Fallback (no Trigger.dev)

Like `wireDigestDispatch`, add `wireCrawlDispatch` in `bootstrap.ts`:
- On `SubredditAdded` event → trigger immediate crawl (backfill)
- Timer-based crawl loop when Trigger.dev not configured

### Acceptance Criteria
- [ ] `crawl-subreddit` task fetches and persists posts
- [ ] `scheduled-crawl` finds due subreddits and triggers crawls
- [ ] Crawl updates `lastFetchedAt` and `nextCrawlAt`
- [ ] `scoreDelta` computed correctly
- [ ] Rate limiter respected (shared TokenBucket)
- [ ] CrawlCompleted/CrawlFailed events emitted
- [ ] In-process fallback works without Trigger.dev
- [ ] Backfill triggered on `SubredditAdded`

---

## Step 7: Replace fetchStep with selectPostsStep

**Files:** `packages/core/src/pipeline/select-posts-step.ts`, `packages/core/src/pipeline/orchestrator.ts`

### `selectPostsStep`

Replaces `fetchStep`. Reads from DB instead of Reddit API:

```typescript
export async function selectPostsStep(
  subreddit: { name: string; maxPosts: number; includeNsfw: boolean },
  lookbackHours: number,
  db: PrismaClient,
): Promise<FetchStepResult> {
  const since = new Date(Date.now() - lookbackHours * 3600 * 1000);

  const posts = await db.post.findMany({
    where: {
      subreddit: subreddit.name,
      fetchedAt: { gte: since },
      ...(subreddit.includeNsfw ? {} : { isNsfw: false }),
    },
    orderBy: [{ score: "desc" }, { fetchedAt: "desc" }],
    take: subreddit.maxPosts * 3,
    include: { comments: { orderBy: { score: "desc" }, take: 10 } },
  });

  // Map to FetchStepResult shape (same interface, different source)
  return {
    subreddit: subreddit.name,
    posts: posts.map((p) => ({ /* ... same mapping as cache hit path */ })),
    fetchedAt: new Date(),
    fromCache: true,  // semantically: from local data, not live API
  };
}
```

### Orchestrator Changes

```typescript
// Before (coupled):
const fetchResult = await fetchStep(sub, contentSource, db);

// After (decoupled):
const fetchResult = deps.contentSource
  ? await fetchStep(sub, deps.contentSource, db)       // legacy/force_refresh path
  : await selectPostsStep(sub, lookbackHours, db);     // decoupled path
```

### PipelineDeps Change

```typescript
interface PipelineDeps {
  db: PrismaClient;
  eventBus: DomainEventBus;
  contentSource?: ContentSource;  // NOW OPTIONAL
  config: RedgestConfig;
  // ... rest unchanged
}
```

### `force_refresh` Behavior

When `force_refresh: true`:
1. Trigger immediate crawl for the relevant subreddits
2. Wait for crawl to complete (or timeout after 60s)
3. Then run `selectPostsStep` with fresh data

### Acceptance Criteria
- [ ] Pipeline works with `contentSource: undefined` (reads from DB)
- [ ] Lookback window filters posts correctly
- [ ] `force_refresh` triggers crawl then reads
- [ ] Triage/summarize/assemble steps unchanged
- [ ] All existing pipeline tests pass with minimal modification
- [ ] New tests for `selectPostsStep`

---

## Step 8: Crawl Observability + Cleanup

### MCP Tool: `get_crawl_status`

```
get_crawl_status — View crawl health for monitored subreddits.
  Returns: last crawl time, next crawl time, post count, error (if last crawl failed).
  Params: name? (specific subreddit, or all)
```

### Query

```typescript
GetCrawlStatus: { name?: string };
// Returns:
CrawlStatusResult: Array<{
  subreddit: string;
  lastCrawledAt: string | null;
  nextCrawlAt: string | null;
  crawlIntervalMinutes: number;
  totalPosts: number;
  lastCrawlStatus: "ok" | "failed" | "never";
  lastError?: string;
}>;
```

### Scheduled Digest Update

`scheduled-digest` task uses profiles:
```typescript
// Before: find all active subreddits, create one job
// After: find all active profiles with schedules, create one job per profile
for (const profile of activeProfiles) {
  if (shouldRunNow(profile.schedule)) {
    const job = await createJob(profile);
    await generateDigest.trigger({ jobId: job.id, profileId: profile.id });
  }
}
```

### Cleanup (Non-Breaking)

- Mark `config.schedule`, `config.defaultLookback`, `config.defaultDelivery`, `config.maxDigestPosts` as deprecated in code comments
- Update seed.ts to create Default profile
- Update `use_redgest` guide to mention profiles
- Remove `ContentSource` as required field from `PipelineDeps`

### Acceptance Criteria
- [ ] `get_crawl_status` tool works
- [ ] Scheduled digests use profiles
- [ ] Seed creates Default profile
- [ ] Usage guide updated
- [ ] All tests pass
- [ ] `pnpm check` clean

---

## Dependency Graph

```
Step 1 (Schema)
  ├── Step 2 (Profile CQRS) ──── Step 3 (Profile MCP Tools)
  │                                    │
  │                                    └── Step 4 (Pipeline ← Profiles)
  │
  ├── Step 5 (Crawl Fields) ──── Step 6 (Crawl Task)
  │                                    │
  │                                    └── Step 7 (selectPostsStep)
  │
  └── Step 8 (Observability + Cleanup) ← depends on Steps 4, 6, 7
```

**Parallelizable:** Steps 2-4 (profiles) and Steps 5-7 (crawling) can be developed in parallel after Step 1.

## Testing Strategy

- **Unit tests:** All new handlers, select-posts-step, crawl logic
- **Integration tests:** Profile → generate_digest flow, crawl → select → triage flow
- **E2E tests:** FakeContentSource works with decoupled model (crawl writes fake data, pipeline reads it)
- **Migration test:** Run migration on a DB with existing data, verify Default profile created correctly

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Migration fails on prod data | Test migration against DB dump first |
| Profile schema too rigid | JSONB `filters` column for future extensibility |
| Crawl task overwhelms Reddit API | Shared rate limiter + staggered cron offsets |
| Backward compatibility break | Legacy path (no profileId) always works |
| Fetch cache regression | Keep fetchStep as fallback for force_refresh |
