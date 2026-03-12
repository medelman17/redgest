-- Fix case mismatch: run_view filtered on 'Job' but code writes 'job'
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
  WHERE aggregate_type = 'job'
  GROUP BY aggregate_id
) ec ON ec.aggregate_id = j.id
LEFT JOIN LATERAL (
  SELECT e.type, e.created_at
  FROM events e
  WHERE e.aggregate_type = 'job'
    AND e.aggregate_id = j.id
  ORDER BY e.created_at DESC
  LIMIT 1
) le ON true;
