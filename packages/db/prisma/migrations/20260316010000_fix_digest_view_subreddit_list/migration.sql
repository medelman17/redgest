-- Fix digest_view subreddit_list: restore aggregation from digest_posts
-- instead of using j.subreddits (which contains IDs, not names).
-- See: https://github.com/medelman17/redgest/issues/78

DROP VIEW IF EXISTS digest_view;
CREATE VIEW digest_view AS
SELECT
  d.id            AS digest_id,
  d.job_id,
  j.organization_id,
  j.status::text  AS job_status,
  j.started_at,
  j.completed_at,
  COALESCE(
    (SELECT jsonb_agg(DISTINCT dp.subreddit)
       FILTER (WHERE dp.subreddit IS NOT NULL)
     FROM digest_posts dp
     WHERE dp.digest_id = d.id),
    '[]'::jsonb
  )               AS subreddit_list,
  (SELECT COUNT(*)::int FROM digest_posts dp WHERE dp.digest_id = d.id) AS post_count,
  d.content_markdown,
  d.content_html,
  d.created_at
FROM digests d
  JOIN jobs j ON j.id = d.job_id;
