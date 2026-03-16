import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestDb, truncateAll, teardownTestDb } from "../helpers/db.js";
import { FakeContentSource } from "../fixtures/fake-content-source.js";
import {
  fakeGenerateTriageResult,
  fakeGeneratePostSummary,
} from "../fixtures/fake-llm.js";
import {
  runDigestPipeline,
  InProcessEventBus,
  type PipelineDeps,
  type ContentSource,
  type FetchedContent,
  type FetchOptions,
} from "@redgest/core";
import type { PrismaClient } from "@redgest/db";

let db: PrismaClient;

/**
 * Build a minimal PipelineDeps with fake LLM and fake content source.
 * The `config` field is required by the type but not read by the orchestrator,
 * so we cast a stub.
 */
function makeDeps(overrides?: Partial<PipelineDeps>): PipelineDeps {
  return {
    db,
    eventBus: new InProcessEventBus(),
    contentSource: new FakeContentSource(),
    config: {} as PipelineDeps["config"],
    generateTriage: fakeGenerateTriageResult,
    generateSummary: fakeGeneratePostSummary,
    ...overrides,
  };
}

beforeAll(async () => {
  db = await getTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
});

// ── Helpers ──────────────────────────────────────────────────

async function setupSubreddit(
  name: string,
  opts?: { insightPrompt?: string; maxPosts?: number },
) {
  const sub = await db.subreddit.create({
    data: {
      name,
      insightPrompt: opts?.insightPrompt ?? "test insight prompt",
      maxPosts: opts?.maxPosts ?? 10,
    },
  });

  // Ensure singleton config row (id=1, enforced by CHECK constraint)
  await db.config.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      globalInsightPrompt: "global test prompt",
      llmProvider: "anthropic",
      llmModel: "claude-sonnet-4-20250514",
    },
    update: {},
  });

  return sub;
}

async function createJob(subredditIds: string[]) {
  return db.job.create({
    data: {
      status: "QUEUED",
      subreddits: subredditIds,
      lookback: "24h",
      delivery: "NONE",
    },
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("runDigestPipeline integration", () => {
  it("writes correct DB records for one subreddit", async () => {
    const sub = await setupSubreddit("react");
    const job = await createJob([sub.id]);
    const deps = makeDeps();

    const result = await runDigestPipeline(job.id, [sub.id], deps);

    // --- Pipeline result assertions ---
    expect(result.status).toBe("COMPLETED");
    expect(result.digestId).toBeDefined();
    expect(result.errors).toHaveLength(0);

    // --- Job record updated ---
    const dbJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(dbJob.status).toBe("COMPLETED");
    expect(dbJob.startedAt).toBeInstanceOf(Date);
    expect(dbJob.completedAt).toBeInstanceOf(Date);

    // --- 3 posts written (FakeContentSource returns 3) ---
    const posts = await db.post.findMany({ where: { subreddit: "react" } });
    expect(posts).toHaveLength(3);

    // --- 3 PostSummaries linked to the job ---
    const summaries = await db.postSummary.findMany({
      where: { jobId: job.id },
    });
    expect(summaries).toHaveLength(3);

    // --- Digest created with markdown containing "Test Post" ---
    const digest = await db.digest.findUniqueOrThrow({
      where: { id: result.digestId! },
    });
    expect(digest.contentMarkdown).toContain("Test Post");
    expect(digest.jobId).toBe(job.id);

    // --- DigestPost join records ---
    const digestPosts = await db.digestPost.findMany({
      where: { digestId: result.digestId! },
    });
    expect(digestPosts).toHaveLength(3);

    // --- Events logged ---
    const events = await db.event.findMany({
      where: { aggregateId: job.id },
      orderBy: { createdAt: "asc" },
    });
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("PostsFetched");
    expect(eventTypes).toContain("PostsTriaged");
    expect(eventTypes).toContain("PostsSummarized");
    expect(eventTypes).toContain("DigestCompleted");
  });

  it("SQL views return correct shapes after pipeline run", async () => {
    const sub = await setupSubreddit("react");
    const job = await createJob([sub.id]);
    const deps = makeDeps();

    const result = await runDigestPipeline(job.id, [sub.id], deps);
    expect(result.status).toBe("COMPLETED");

    // --- digest_view ---
    const digestRows = await db.$queryRaw<
      Array<{ digest_id: string; job_id: string; post_count: number }>
    >`SELECT digest_id, job_id, post_count FROM digest_view`;
    expect(digestRows).toHaveLength(1);
    expect(digestRows[0]!.job_id).toBe(job.id);
    expect(digestRows[0]!.post_count).toBe(3);

    // --- run_view ---
    const runRows = await db.$queryRaw<
      Array<{ job_id: string; status: string }>
    >`SELECT job_id, status FROM run_view WHERE job_id = ${job.id}`;
    expect(runRows).toHaveLength(1);
    expect(runRows[0]!.status).toBe("COMPLETED");

    // --- post_view ---
    const postRows = await db.$queryRaw<
      Array<{ post_id: string; summary: string | null }>
    >`SELECT post_id, summary FROM post_view`;
    expect(postRows.length).toBeGreaterThanOrEqual(1);
    // At least one row should have a summary
    const withSummary = postRows.filter((r) => r.summary != null);
    expect(withSummary.length).toBeGreaterThanOrEqual(1);

    // --- subreddit_view ---
    const subRows = await db.$queryRaw<
      Array<{ name: string }>
    >`SELECT name FROM subreddit_view WHERE name = 'react'`;
    expect(subRows).toHaveLength(1);
    expect(subRows[0]!.name).toBe("react");
  });

  it("deduplicates posts across runs", async () => {
    const sub = await setupSubreddit("react");

    // --- Run 1: 3 posts processed ---
    const job1 = await createJob([sub.id]);
    const deps1 = makeDeps();
    const result1 = await runDigestPipeline(job1.id, [sub.id], deps1);
    expect(result1.status).toBe("COMPLETED");
    expect(result1.subredditResults[0]!.posts).toHaveLength(3);

    // --- Run 2: same fixture data → 0 new posts (all deduplicated) ---
    const job2 = await createJob([sub.id]);
    const deps2 = makeDeps();
    const result2 = await runDigestPipeline(job2.id, [sub.id], deps2);

    // All posts were already in the previous digest, so zero new content
    const run2Posts = result2.subredditResults[0]!.posts;
    expect(run2Posts).toHaveLength(0);

    // With zero posts, the pipeline should FAIL (no content produced)
    expect(result2.status).toBe("FAILED");
  });

  it("handles partial failure — one subreddit fails, another succeeds", async () => {
    const goodSub = await setupSubreddit("typescript");
    const badSub = await setupSubreddit("__fail__");

    const job = await createJob([goodSub.id, badSub.id]);

    // Content source that throws for __fail__ subreddit
    const failingSource: ContentSource = {
      async fetchContent(
        subreddit: string,
        options: FetchOptions,
      ): Promise<FetchedContent> {
        if (subreddit === "__fail__") {
          throw new Error("Simulated content source failure for __fail__");
        }
        return new FakeContentSource().fetchContent(subreddit, options);
      },
    };

    const deps = makeDeps({ contentSource: failingSource });
    const result = await runDigestPipeline(
      job.id,
      [goodSub.id, badSub.id],
      deps,
    );

    // --- Status should be PARTIAL (some errors, but some content) ---
    expect(result.status).toBe("PARTIAL");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("__fail__"))).toBe(true);

    // --- Good subreddit should have posts ---
    const tsResult = result.subredditResults.find(
      (r) => r.subreddit === "typescript",
    );
    expect(tsResult).toBeDefined();
    expect(tsResult!.posts.length).toBeGreaterThan(0);

    // --- Bad subreddit should have error ---
    const failResult = result.subredditResults.find(
      (r) => r.subreddit === "__fail__",
    );
    expect(failResult).toBeDefined();
    expect(failResult!.error).toBeDefined();
    expect(failResult!.posts).toHaveLength(0);

    // --- Digest should still be created (from good subreddit) ---
    expect(result.digestId).toBeDefined();
    const digest = await db.digest.findUniqueOrThrow({
      where: { id: result.digestId! },
    });
    expect(digest.contentMarkdown).toContain("typescript");

    // --- Job status in DB ---
    const dbJob = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(dbJob.status).toBe("PARTIAL");
    expect(dbJob.error).toContain("__fail__");
  });
});
