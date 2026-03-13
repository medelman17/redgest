-- DropIndex
DROP INDEX "idx_events_correlation_id";

-- DropIndex
DROP INDEX "idx_events_created_at_brin";

-- DropIndex
DROP INDEX "idx_post_comments_post_score";

-- AlterTable
ALTER TABLE "subreddits" ADD COLUMN     "last_fetched_at" TIMESTAMP(3);
