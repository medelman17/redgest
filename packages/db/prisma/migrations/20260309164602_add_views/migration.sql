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
