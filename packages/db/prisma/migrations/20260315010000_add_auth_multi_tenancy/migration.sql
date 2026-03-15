-- ─── BetterAuth: User table ───────────────────────────────

CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- ─── BetterAuth: Session table ────────────────────────────

CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "active_organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- ─── BetterAuth: Account table ────────────────────────────

CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "id_token" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── BetterAuth: Verification table ──────────────────────

CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- ─── BetterAuth: Organization table ──────────────────────

CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "logo" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- ─── BetterAuth: Member table ────────────────────────────

CREATE TABLE "member" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "member_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── BetterAuth: Invitation table ────────────────────────

CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "inviter_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── Add organizationId to existing tables ────────────────

-- Create a default system organization for existing data migration
INSERT INTO "organization" ("id", "name", "slug", "created_at")
VALUES ('org_default', 'Default Organization', 'default', CURRENT_TIMESTAMP);

-- Subreddits: add organization_id column
ALTER TABLE "subreddits" ADD COLUMN "organization_id" TEXT;
UPDATE "subreddits" SET "organization_id" = 'org_default';
ALTER TABLE "subreddits" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "subreddits" ADD CONSTRAINT "subreddits_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop old unique constraint on name, add composite unique
ALTER TABLE "subreddits" DROP CONSTRAINT IF EXISTS "subreddits_name_key";
CREATE UNIQUE INDEX "subreddits_name_organization_id_key" ON "subreddits"("name", "organization_id");
CREATE INDEX "subreddits_organization_id_idx" ON "subreddits"("organization_id");

-- DigestProfiles: add organization_id column
ALTER TABLE "digest_profiles" ADD COLUMN "organization_id" TEXT;
UPDATE "digest_profiles" SET "organization_id" = 'org_default';
ALTER TABLE "digest_profiles" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "digest_profiles" ADD CONSTRAINT "digest_profiles_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop old unique constraint on name, add composite unique
ALTER TABLE "digest_profiles" DROP CONSTRAINT IF EXISTS "digest_profiles_name_key";
CREATE UNIQUE INDEX "digest_profiles_name_organization_id_key" ON "digest_profiles"("name", "organization_id");
CREATE INDEX "digest_profiles_organization_id_idx" ON "digest_profiles"("organization_id");

-- Config: add organization_id column, transition from singleton to per-org
ALTER TABLE "config" ADD COLUMN "organization_id" TEXT;
UPDATE "config" SET "organization_id" = 'org_default';
ALTER TABLE "config" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "config" ADD CONSTRAINT "config_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "config_organization_id_key" ON "config"("organization_id");

-- Remove old singleton CHECK constraint (id=1)
ALTER TABLE "config" DROP CONSTRAINT IF EXISTS "config_singleton";

-- Make id auto-increment for new org configs
-- (existing row with id=1 is fine, new rows will get id>1)

-- Jobs: add organization_id column
ALTER TABLE "jobs" ADD COLUMN "organization_id" TEXT;
UPDATE "jobs" SET "organization_id" = 'org_default';
ALTER TABLE "jobs" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "jobs_organization_id_idx" ON "jobs"("organization_id");

-- Events: add organization_id column (nullable for system events)
ALTER TABLE "events" ADD COLUMN "organization_id" TEXT;
UPDATE "events" SET "organization_id" = 'org_default';
CREATE INDEX "events_organization_id_idx" ON "events"("organization_id");

-- ─── Update views to include organization_id ──────────────

-- digest_view: must DROP + recreate (inserting column)
DROP VIEW IF EXISTS digest_view;
CREATE VIEW digest_view AS
SELECT
  d.id            AS digest_id,
  d.job_id,
  j.organization_id,
  j.status::text  AS job_status,
  j.started_at,
  j.completed_at,
  j.subreddits    AS subreddit_list,
  (SELECT COUNT(*)::int FROM digest_posts dp WHERE dp.digest_id = d.id) AS post_count,
  d.content_markdown,
  d.content_html,
  d.created_at
FROM digests d
  JOIN jobs j ON j.id = d.job_id;

-- run_view: must DROP + recreate
DROP VIEW IF EXISTS run_view;
CREATE VIEW run_view AS
SELECT
  j.id              AS job_id,
  j.organization_id,
  j.status::text    AS status,
  j.progress,
  j.subreddits,
  (SELECT COUNT(*)::int FROM events e WHERE e.aggregate_id = j.id AND e.aggregate_type IN ('job', 'Job')) AS event_count,
  (SELECT e.type FROM events e WHERE e.aggregate_id = j.id AND e.aggregate_type IN ('job', 'Job') ORDER BY e.created_at DESC LIMIT 1) AS last_event_type,
  (SELECT e.created_at FROM events e WHERE e.aggregate_id = j.id AND e.aggregate_type IN ('job', 'Job') ORDER BY e.created_at DESC LIMIT 1) AS last_event_at,
  CASE
    WHEN j.started_at IS NOT NULL AND j.completed_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (j.completed_at - j.started_at))::int
    ELSE NULL
  END AS duration_seconds,
  j.trigger_run_id,
  j.started_at,
  j.completed_at,
  j.error,
  j.created_at
FROM jobs j;

-- subreddit_view: must DROP + recreate
DROP VIEW IF EXISTS subreddit_view;
CREATE VIEW subreddit_view AS
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
  s.organization_id,
  s.insight_prompt,
  s.max_posts,
  s.include_nsfw,
  s.is_active,
  s.crawl_interval_minutes,
  s.next_crawl_at,
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

-- profile_view: must DROP + recreate
DROP VIEW IF EXISTS profile_view;
CREATE VIEW profile_view AS
SELECT
  dp.id AS profile_id,
  dp.name,
  dp.organization_id,
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

-- delivery_view: must DROP + recreate
DROP VIEW IF EXISTS delivery_view;
CREATE VIEW delivery_view AS
SELECT
  del.id              AS delivery_id,
  del.digest_id,
  del.job_id,
  j.organization_id,
  del.channel::text   AS channel,
  del.status::text    AS status,
  del.error,
  del.external_id,
  del.sent_at,
  del.created_at,
  del.updated_at,
  d.created_at        AS digest_created_at,
  j.status::text      AS job_status
FROM deliveries del
  JOIN digests d ON d.id = del.digest_id
  JOIN jobs j ON j.id = del.job_id;

-- post_view stays unchanged (posts are globally shared, no org column)

-- ─── Restore raw-SQL indexes (Prisma schema drift protection) ──

CREATE INDEX IF NOT EXISTS idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_post_score ON post_comments (post_id, score DESC);
