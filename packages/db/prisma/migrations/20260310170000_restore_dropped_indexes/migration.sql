-- Restore indexes that were unintentionally dropped by the add_llm_calls_table
-- migration. Prisma detected these raw-SQL indexes as schema drift and generated
-- DROP statements. Re-adding them here.

CREATE INDEX idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX idx_events_correlation_id ON events (correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_post_comments_post_score ON post_comments (post_id, score DESC);
