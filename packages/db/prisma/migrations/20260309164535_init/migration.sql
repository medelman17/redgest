-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "delivery_channel" AS ENUM ('NONE', 'EMAIL', 'SLACK', 'ALL');

-- CreateTable
CREATE TABLE "subreddits" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "insight_prompt" TEXT,
    "max_posts" INTEGER NOT NULL DEFAULT 5,
    "include_nsfw" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subreddits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config" (
    "id" INTEGER NOT NULL,
    "global_insight_prompt" TEXT NOT NULL,
    "default_lookback" TEXT NOT NULL DEFAULT '24h',
    "default_delivery" "delivery_channel" NOT NULL DEFAULT 'NONE',
    "llm_provider" TEXT NOT NULL,
    "llm_model" TEXT NOT NULL,
    "schedule" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'QUEUED',
    "subreddits" JSONB NOT NULL,
    "lookback" TEXT NOT NULL,
    "delivery" "delivery_channel" NOT NULL DEFAULT 'NONE',
    "trigger_run_id" TEXT,
    "progress" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "correlation_id" TEXT,
    "causation_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "reddit_id" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "author" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment_count" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "permalink" TEXT NOT NULL,
    "flair" TEXT,
    "is_nsfw" BOOLEAN NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "text_search" tsvector,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "reddit_id" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_summaries" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "key_takeaways" JSONB NOT NULL,
    "insight_notes" TEXT NOT NULL,
    "comment_highlights" JSONB NOT NULL,
    "selection_rationale" TEXT NOT NULL,
    "llm_provider" TEXT NOT NULL,
    "llm_model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digests" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "content_markdown" TEXT NOT NULL,
    "content_html" TEXT,
    "content_slack_blocks" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digest_posts" (
    "digest_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "subreddit" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "digest_posts_pkey" PRIMARY KEY ("digest_id","post_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subreddits_name_key" ON "subreddits"("name");

-- CreateIndex
CREATE INDEX "subreddits_is_active_idx" ON "subreddits"("is_active");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_created_at_idx" ON "jobs"("created_at");

-- CreateIndex
CREATE INDEX "jobs_trigger_run_id_idx" ON "jobs"("trigger_run_id");

-- CreateIndex
CREATE INDEX "events_aggregate_type_aggregate_id_version_idx" ON "events"("aggregate_type", "aggregate_id", "version");

-- CreateIndex
CREATE INDEX "events_type_created_at_idx" ON "events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "posts_reddit_id_key" ON "posts"("reddit_id");

-- CreateIndex
CREATE INDEX "posts_subreddit_idx" ON "posts"("subreddit");

-- CreateIndex
CREATE INDEX "posts_fetched_at_idx" ON "posts"("fetched_at");

-- CreateIndex
CREATE INDEX "post_comments_post_id_idx" ON "post_comments"("post_id");

-- CreateIndex
CREATE INDEX "post_summaries_post_id_idx" ON "post_summaries"("post_id");

-- CreateIndex
CREATE INDEX "post_summaries_job_id_idx" ON "post_summaries"("job_id");

-- CreateIndex
CREATE INDEX "post_summaries_post_id_job_id_idx" ON "post_summaries"("post_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "digests_job_id_key" ON "digests"("job_id");

-- CreateIndex
CREATE INDEX "digest_posts_subreddit_idx" ON "digest_posts"("subreddit");

-- AddForeignKey
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_summaries" ADD CONSTRAINT "post_summaries_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_summaries" ADD CONSTRAINT "post_summaries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digests" ADD CONSTRAINT "digests_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_posts" ADD CONSTRAINT "digest_posts_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "digests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_posts" ADD CONSTRAINT "digest_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
