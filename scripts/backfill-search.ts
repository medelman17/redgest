import { config } from "dotenv";
config({ override: true });
// Dynamic import ensures dotenv loads before Prisma reads DATABASE_URL
const { prisma } = await import("@redgest/db");

const BATCH_SIZE = 50;

async function backfillSearchVectors(): Promise<void> {
  // The Postgres trigger handles search_vector on INSERT/UPDATE,
  // but existing rows need a touch to fire the trigger.
  // Batch update all rows at once — trigger fires per-row regardless.
  const result = await prisma.$executeRaw`
    UPDATE posts SET title = title
  `;

  console.log(`Backfilled search_vector for ${result} posts`);
}

async function backfillEmbeddings(): Promise<void> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.log("OPENAI_API_KEY not set — skipping embedding backfill");
    return;
  }

  // Find summaries without embeddings
  const summaries = await prisma.$queryRaw<
    Array<{ id: string; text: string }>
  >`
    SELECT
      ps.id::text,
      COALESCE(ps.summary, '') || ' ' ||
      COALESCE((SELECT string_agg(elem, '. ') FROM jsonb_array_elements_text(ps.key_takeaways) AS elem), '') || ' ' ||
      COALESCE(ps.insight_notes, '') AS text
    FROM post_summaries ps
    WHERE ps.embedding IS NULL
    ORDER BY ps.created_at ASC
  `;

  console.log(`Found ${summaries.length} summaries to embed`);

  if (summaries.length === 0) return;

  // Batch embed (OpenAI supports up to 2048 inputs per request)
  for (let i = 0; i < summaries.length; i += BATCH_SIZE) {
    const batch = summaries.slice(i, i + BATCH_SIZE);
    const texts = batch.map((s) => s.text);

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    for (const item of data.data) {
      const summary = batch[item.index];
      if (!summary) continue;
      const vecStr = `[${item.embedding.join(",")}]`;
      await prisma.$executeRaw`
        UPDATE post_summaries
        SET embedding = ${vecStr}::vector
        WHERE id = ${summary.id}
      `;
    }

    console.log(
      `  Embedded ${Math.min(i + BATCH_SIZE, summaries.length)}/${summaries.length} summaries`,
    );

    // Rate limit: 3 req/min for free tier, generous for paid
    if (i + BATCH_SIZE < summaries.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log("Embedding backfill complete");
}

async function main(): Promise<void> {
  console.log("=== Phase 3 Search Backfill ===\n");

  await backfillSearchVectors();
  console.log();
  await backfillEmbeddings();

  await prisma.$disconnect();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
