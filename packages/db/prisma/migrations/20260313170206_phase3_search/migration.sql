-- 1. pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. New columns on post_summaries
ALTER TABLE "post_summaries" ADD COLUMN "community_consensus" TEXT;
ALTER TABLE "post_summaries" ADD COLUMN "sentiment" TEXT;
ALTER TABLE "post_summaries" ADD COLUMN "embedding" vector(1536);

-- 3. Replace textSearch with search_vector on posts
ALTER TABLE "posts" DROP COLUMN IF EXISTS "text_search";
ALTER TABLE "posts" ADD COLUMN "search_vector" tsvector;

-- 4. GIN index on search_vector
CREATE INDEX "posts_search_idx" ON "posts" USING GIN ("search_vector");

-- 5. HNSW index on embeddings
CREATE INDEX "summaries_embedding_idx" ON "post_summaries" USING hnsw ("embedding" vector_cosine_ops);

-- 6. Topics tables (TEXT IDs to match existing schema convention)
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frequency" INT NOT NULL DEFAULT 1,
    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "topics_name_key" ON "topics"("name");

CREATE TABLE "post_topics" (
    "post_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    CONSTRAINT "post_topics_pkey" PRIMARY KEY ("post_id","topic_id"),
    CONSTRAINT "post_topics_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE,
    CONSTRAINT "post_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE
);
CREATE INDEX "post_topics_topic_idx" ON "post_topics"("topic_id");

-- 7. Trigger function for composite search_vector
CREATE OR REPLACE FUNCTION update_post_search_vector() RETURNS trigger AS $$
DECLARE
  target_post_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'posts' THEN
    target_post_id := NEW.id;
  ELSE
    target_post_id := NEW.post_id;
  END IF;

  UPDATE posts SET search_vector =
    setweight(to_tsvector('english', COALESCE(p.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(s.summary, '') || ' ' || COALESCE(s.key_takeaways_text, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(s.insight_notes, '') || ' ' || COALESCE(s.community_consensus, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(p.body, '')), 'D')
  FROM posts p
  LEFT JOIN LATERAL (
    SELECT ps.summary, ps.insight_notes, ps.community_consensus,
           COALESCE((SELECT string_agg(elem, '. ') FROM jsonb_array_elements_text(ps.key_takeaways) AS elem), '') AS key_takeaways_text
    FROM post_summaries ps WHERE ps.post_id = target_post_id
    ORDER BY ps.created_at DESC LIMIT 1
  ) s ON true
  WHERE p.id = target_post_id AND posts.id = target_post_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 8. Triggers
-- WHEN clause on posts trigger limits firing to title/body changes only,
-- preventing infinite recursion when the trigger itself UPDATEs search_vector.
CREATE TRIGGER posts_search_update
  AFTER INSERT OR UPDATE OF title, body ON posts
  FOR EACH ROW EXECUTE FUNCTION update_post_search_vector();

CREATE TRIGGER summaries_search_update
  AFTER INSERT OR UPDATE ON post_summaries
  FOR EACH ROW EXECUTE FUNCTION update_post_search_vector();

-- Restore raw-SQL indexes (Prisma schema drift drops these — see CLAUDE.md)
CREATE INDEX IF NOT EXISTS idx_events_created_at_brin ON events USING BRIN (created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_comments_post_score ON post_comments (post_id, score DESC);
