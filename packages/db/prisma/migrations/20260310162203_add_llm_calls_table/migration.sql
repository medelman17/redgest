-- DropIndex
DROP INDEX "idx_events_correlation_id";

-- DropIndex
DROP INDEX "idx_events_created_at_brin";

-- DropIndex
DROP INDEX "idx_post_comments_post_score";

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "post_id" TEXT,
    "task" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL,
    "finish_reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_calls_job_id_idx" ON "llm_calls"("job_id");

-- CreateIndex
CREATE INDEX "llm_calls_task_created_at_idx" ON "llm_calls"("task", "created_at");

-- AddForeignKey
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
