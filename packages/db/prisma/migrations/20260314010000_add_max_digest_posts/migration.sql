-- AlterTable
ALTER TABLE "config" ADD COLUMN "max_digest_posts" INTEGER NOT NULL DEFAULT 5;

-- Restore raw SQL indexes (Prisma schema drift protection)
CREATE INDEX IF NOT EXISTS idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_post_score ON post_comments (post_id, score DESC);
