import type { PrismaClient } from "@redgest/db";
import type { DomainEventBus } from "../events/bus.js";
import type {
  DomainEvent,
  DomainEventType,
  DomainEventMap,
} from "../events/types.js";
import { persistEvent, type EventCreateClient } from "../events/persist.js";
import { getModel } from "@redgest/llm";
import type { TriagePostCandidate, SummarizationComment } from "@redgest/llm";
import { findPreviousPostIds } from "./dedup.js";
import { fetchStep } from "./fetch-step.js";
import { triageStep } from "./triage-step.js";
import { summarizeStep } from "./summarize-step.js";
import { assembleStep } from "./assemble-step.js";
import type {
  PipelineDeps,
  PipelineResult,
  SubredditPipelineResult,
} from "./types.js";

async function emitEvent<K extends DomainEventType>(
  db: PrismaClient,
  eventBus: DomainEventBus,
  type: K,
  payload: DomainEventMap[K],
  aggregateId: string,
): Promise<void> {
  const event: DomainEvent = {
    type,
    payload,
    aggregateId,
    aggregateType: "job",
    version: 1,
    correlationId: null,
    causationId: null,
    metadata: {},
    occurredAt: new Date(),
  } as unknown as DomainEvent;

  // PrismaClient satisfies EventCreateClient at runtime; Prisma's generated types are stricter
  await persistEvent(db as unknown as EventCreateClient, event);
  eventBus.emitEvent(event);
}

async function checkCancellation(
  jobId: string,
  db: PrismaClient,
): Promise<boolean> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status === "CANCELED";
}

/**
 * Run the complete digest pipeline.
 *
 * Two-level error recovery (ADR-013):
 * - Per-subreddit: failed fetch/triage skips the subreddit
 * - Per-post: failed summarization skips the post
 *
 * Job status: COMPLETED (all ok), PARTIAL (some skipped), FAILED (zero content)
 */
export async function runDigestPipeline(
  jobId: string,
  subredditIds: string[],
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { db, eventBus } = deps;

  // 1. Update job status to RUNNING
  await db.job.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  // Defense-in-depth: catch any unhandled exception after RUNNING
  // and ensure the job is marked FAILED (issue #3)
  try {
    return await runPipelineBody(jobId, subredditIds, deps, db, eventBus);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort: mark job as FAILED in DB
    try {
      await db.job.update({
        where: { id: jobId },
        data: { status: "FAILED", completedAt: new Date(), error: message },
      });
    } catch {
      // DB may be unavailable — nothing more we can do
    }
    // Best-effort: emit failure event
    try {
      await emitEvent(
        db,
        eventBus,
        "DigestFailed",
        { jobId, error: message },
        jobId,
      );
    } catch {
      // Event persistence may fail — swallow
    }
    return {
      jobId,
      status: "FAILED" as const,
      subredditResults: [],
      errors: [message],
    };
  }
}

/** Inner pipeline body — extracted so the outer function can catch unhandled exceptions. */
async function runPipelineBody(
  jobId: string,
  subredditIds: string[],
  deps: PipelineDeps,
  db: PrismaClient,
  eventBus: DomainEventBus,
): Promise<PipelineResult> {
  const { contentSource } = deps;

  // 2. Load subreddits
  const subreddits = await db.subreddit.findMany({
    where:
      subredditIds.length > 0
        ? { id: { in: subredditIds }, isActive: true }
        : { isActive: true },
  });

  // 3. Load config for global insight prompt
  const dbConfig = await db.config.findFirst();
  const globalInsightPrompt = dbConfig?.globalInsightPrompt ?? "";

  // Read LLM model config at runtime (not boot time)
  // so config changes take effect without restart
  const runtimeModel = (() => {
    if (deps.model) return deps.model; // explicit override (e.g., test mode)
    if (dbConfig?.llmProvider && dbConfig?.llmModel) {
      return {
        provider: dbConfig.llmProvider as "anthropic" | "openai",
        model: dbConfig.llmModel,
      };
    }
    return undefined;
  })();

  // 4. Load dedup set (last 3 digests)
  const previousPostIds = await findPreviousPostIds(db);

  // Check cancellation before starting subreddit processing
  if (await checkCancellation(jobId, db)) {
    return { jobId, status: "CANCELED", subredditResults: [], errors: [] };
  }

  // 5. Process each subreddit
  const subredditResults: SubredditPipelineResult[] = [];
  const errors: string[] = [];

  for (const sub of subreddits) {
    try {
      // Checkpoint: before fetch
      if (await checkCancellation(jobId, db)) {
        break;
      }

      // --- Fetch ---
      const forceRefresh = deps.forceRefresh ?? false;
      const fetchResult = await fetchStep(
        {
          name: sub.name,
          maxPosts: sub.maxPosts,
          includeNsfw: sub.includeNsfw,
          lastFetchedAt: forceRefresh ? null : sub.lastFetchedAt,
        },
        contentSource,
        db,
      );

      // Update lastFetchedAt on the subreddit after a fresh fetch (skip on cache hit)
      if (!fetchResult.fromCache) {
        await db.subreddit.update({
          where: { id: sub.id },
          data: { lastFetchedAt: fetchResult.fetchedAt },
        });
      }

      await emitEvent(
        db,
        eventBus,
        "PostsFetched",
        {
          jobId,
          subreddit: sub.name,
          count: fetchResult.posts.length,
        },
        jobId,
      );

      // --- Dedup ---
      const newPosts = fetchResult.posts.filter(
        (p) => !previousPostIds.has(p.redditId),
      );

      if (newPosts.length === 0) {
        subredditResults.push({ subreddit: sub.name, posts: [] });
        continue;
      }

      // Checkpoint: before triage
      if (await checkCancellation(jobId, db)) {
        break;
      }

      // --- Build insight prompts ---
      const insightPrompts = [globalInsightPrompt, sub.insightPrompt].filter(
        (p): p is string => p != null && p.length > 0,
      );

      // --- Triage ---
      const candidates: TriagePostCandidate[] = newPosts.map((p, i) => ({
        index: i,
        subreddit: p.post.subreddit,
        title: p.post.title,
        score: p.post.score,
        numComments: p.post.num_comments,
        createdUtc: p.post.created_utc,
        selftext: p.post.selftext,
      }));

      const triageModel = runtimeModel ? getModel("triage", runtimeModel) : undefined;
      const triageResult = await triageStep(
        candidates,
        insightPrompts,
        sub.maxPosts,
        db,
        jobId,
        triageModel,
        deps.generateTriage as Parameters<typeof triageStep>[6],
      );

      await emitEvent(
        db,
        eventBus,
        "PostsTriaged",
        {
          jobId,
          subreddit: sub.name,
          selectedCount: triageResult.selected.length,
        },
        jobId,
      );

      // --- Summarize each selected post (per-post error recovery) ---
      const postResults: SubredditPipelineResult["posts"] = [];

      for (const sel of triageResult.selected) {
        const postData = newPosts[sel.index];
        if (!postData) continue;

        // Checkpoint: before each summarization
        if (await checkCancellation(jobId, db)) {
          break;
        }

        try {
          const sumComments: SummarizationComment[] =
            postData.comments.map((c) => ({
              author: c.author,
              score: c.score,
              body: c.body,
            }));

          const sumModel = runtimeModel ? getModel("summarize", runtimeModel) : undefined;
          const sumResult = await summarizeStep(
            {
              title: postData.post.title,
              subreddit: postData.post.subreddit,
              author: postData.post.author,
              score: postData.post.score,
              selftext: postData.post.selftext,
            },
            sumComments,
            insightPrompts,
            jobId,
            postData.postId,
            db,
            sumModel,
            sel.rationale,
            deps.generateSummary as Parameters<typeof summarizeStep>[8],
          );

          postResults.push({
            postId: postData.postId,
            redditId: postData.redditId,
            title: postData.post.title,
            summary: sumResult.summary,
            selectionRationale: sel.rationale,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(
            `Failed to summarize post ${postData.redditId}: ${msg}`,
          );
        }
      }

      await emitEvent(
        db,
        eventBus,
        "PostsSummarized",
        {
          jobId,
          subreddit: sub.name,
          summaryCount: postResults.length,
        },
        jobId,
      );

      subredditResults.push({ subreddit: sub.name, posts: postResults });
    } catch (err) {
      // Per-subreddit error recovery
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to process r/${sub.name}: ${msg}`);
      subredditResults.push({ subreddit: sub.name, posts: [], error: msg });
    }
  }

  // Check if job was canceled — preserve CANCELED status
  if (await checkCancellation(jobId, db)) {
    const canceledTotalPosts = subredditResults.reduce(
      (sum, r) => sum + r.posts.length,
      0,
    );
    // Assemble partial results if any content was generated
    if (canceledTotalPosts > 0) {
      await assembleStep(jobId, subredditResults, db);
    }
    return { jobId, status: "CANCELED", subredditResults, errors };
  }

  // 6. Determine final status
  const totalPosts = subredditResults.reduce(
    (sum, r) => sum + r.posts.length,
    0,
  );
  const hasErrors = errors.length > 0;

  if (totalPosts === 0) {
    const errorMessage = errors.join("; ") || "No content produced";

    await db.job.update({
      where: { id: jobId },
      data: { status: "FAILED", completedAt: new Date(), error: errorMessage },
    });

    await emitEvent(
      db,
      eventBus,
      "DigestFailed",
      { jobId, error: errorMessage },
      jobId,
    );

    return { jobId, status: "FAILED", subredditResults, errors };
  }

  // 7. Assemble digest
  const assembleResult = await assembleStep(jobId, subredditResults, db);

  // 8. Update job to final status
  const finalStatus = hasErrors ? "PARTIAL" : "COMPLETED";
  await db.job.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      error: hasErrors ? errors.join("; ") : null,
    },
  });

  await emitEvent(
    db,
    eventBus,
    "DigestCompleted",
    {
      jobId,
      digestId: assembleResult.digestId,
    },
    jobId,
  );

  return {
    jobId,
    status: finalStatus,
    digestId: assembleResult.digestId,
    subredditResults,
    errors,
  };
}
