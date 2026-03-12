-- AlterEnum
ALTER TYPE "job_status" ADD VALUE 'CANCELED';

-- Prisma detected raw-SQL indexes as drift and generated DROP statements.
-- Restoring them here (see migration 4: restore_dropped_indexes).
CREATE INDEX IF NOT EXISTS idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_post_score ON post_comments (post_id, score DESC);
