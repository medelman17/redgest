-- AlterTable
ALTER TABLE "subreddits" ADD COLUMN     "last_fetched_at" TIMESTAMP(3);

-- Restore raw-SQL indexes (Prisma schema drift drops these — see CLAUDE.md)
CREATE INDEX IF NOT EXISTS idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_post_score ON post_comments (post_id, score DESC);
