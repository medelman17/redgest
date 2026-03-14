-- ─── DigestProfile table ──────────────────────────────────

CREATE TABLE "digest_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "insight_prompt" TEXT,
    "schedule" TEXT,
    "lookback_hours" INTEGER NOT NULL DEFAULT 24,
    "max_posts" INTEGER NOT NULL DEFAULT 5,
    "delivery" "delivery_channel" NOT NULL DEFAULT 'NONE'::"delivery_channel",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "filters" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digest_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "digest_profiles_name_key" ON "digest_profiles"("name");

-- ─── DigestProfileSubreddit join table ────────────────────

CREATE TABLE "digest_profile_subreddits" (
    "profile_id" TEXT NOT NULL,
    "subreddit_id" TEXT NOT NULL,

    CONSTRAINT "digest_profile_subreddits_pkey" PRIMARY KEY ("profile_id","subreddit_id"),
    CONSTRAINT "digest_profile_subreddits_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "digest_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "digest_profile_subreddits_subreddit_id_fkey" FOREIGN KEY ("subreddit_id") REFERENCES "subreddits"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── Subreddit crawl fields ──────────────────────────────

ALTER TABLE "subreddits" ADD COLUMN "crawl_interval_minutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "subreddits" ADD COLUMN "next_crawl_at" TIMESTAMP(3);
UPDATE "subreddits" SET "next_crawl_at" = CURRENT_TIMESTAMP WHERE "next_crawl_at" IS NULL;

-- ─── Post score delta ────────────────────────────────────

ALTER TABLE "posts" ADD COLUMN "score_delta" INTEGER NOT NULL DEFAULT 0;

-- ─── Job profile relation ────────────────────────────────

ALTER TABLE "jobs" ADD COLUMN "profile_id" TEXT;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "digest_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Data migration: Create "Default" profile ────────────

INSERT INTO digest_profiles (id, name, insight_prompt, schedule, lookback_hours, max_posts, delivery, is_active, updated_at)
SELECT
  gen_random_uuid()::text,
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
  true,
  CURRENT_TIMESTAMP
FROM config c
WHERE c.id = 1;

-- Link all active subreddits to Default profile
INSERT INTO digest_profile_subreddits (profile_id, subreddit_id)
SELECT dp.id, s.id
FROM digest_profiles dp, subreddits s
WHERE dp.name = 'Default' AND s.is_active = true;

-- ─── Update subreddit_view to include crawl fields ───────

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

-- ─── Create profile_view ─────────────────────────────────

CREATE OR REPLACE VIEW profile_view AS
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

-- ─── Restore raw-SQL indexes (Prisma schema drift protection) ──

CREATE INDEX IF NOT EXISTS idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_post_score ON post_comments (post_id, score DESC);
