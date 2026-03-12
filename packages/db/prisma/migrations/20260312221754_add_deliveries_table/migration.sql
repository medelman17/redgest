-- CreateEnum
CREATE TYPE "delivery_channel_type" AS ENUM ('EMAIL', 'SLACK');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "digest_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "channel" "delivery_channel_type" NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "external_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliveries_job_id_idx" ON "deliveries"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_digest_id_channel_key" ON "deliveries"("digest_id", "channel");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "digests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateView
CREATE OR REPLACE VIEW delivery_view AS
SELECT
  d.id AS delivery_id,
  d.digest_id,
  d.job_id,
  d.channel::text AS channel,
  d.status::text AS status,
  d.error,
  d.external_id,
  d.sent_at,
  d.created_at,
  d.updated_at,
  dig.created_at AS digest_created_at,
  j.status::text AS job_status
FROM deliveries d
JOIN digests dig ON d.digest_id = dig.id
JOIN jobs j ON d.job_id = j.id
ORDER BY dig.created_at DESC, d.channel ASC;
