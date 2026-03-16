import type { PrismaClient } from "@redgest/db";
import type { DomainEventBus } from "../events/bus.js";
import { emitDomainEvent } from "../events/emit.js";
import { getModel } from "@redgest/llm";
import type { TriagePostCandidate, SummarizationComment } from "@redgest/llm";
import { findPreviousPostIds } from "./dedup.js";
import { fetchStep } from "./fetch-step.js";
import { selectPostsStep } from "./select-posts-step.js";
import { triageStep } from "./triage-step.js";
import { summarizeStep } from "./summarize-step.js";
import { assembleStep } from "./assemble-step.js";
import { topicStep } from "./topic-step.js";
import type {
  PipelineDeps,
  PipelineResult,
  SubredditPipelineResult,
} from "./types.js";

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

/** Default concurrency for parallel post summarization. */
const SUMMARIZE_CONCURRENCY = 3;

/**
 * Process items concurrently with a bounded pool size.
 * Like Promise.allSettled but with a maximum number of in-flight promises.
 * Safe in single-threaded JS: nextIndex increment is atomic between awaits.
 */
async function mapSettled<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      const item = items[i];
      if (item === undefined) continue;
      try {
        results[i] = { status: "fulfilled", value: await fn(item) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
      await emitDomainEvent(
        db,
        eventBus,
        "DigestFailed",
        { jobId, error: message },
        jobId,
        "job",
        deps.organizationId,
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

/** Tracks a fetched post alongside its source subreddit name. */
interface PooledPost {
  subreddit: string;
  postId: string;
  redditId: string;
  post: import("./types.js").RedditPostData;
  comments: import("./types.js").RedditCommentData[];
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

  // 2. Load subreddits (scoped to organization)
  const subreddits = await db.subreddit.findMany({
    where:
      subredditIds.length > 0
        ? { id: { in: subredditIds }, isActive: true, organizationId: deps.organizationId }
        : { isActive: true, organizationId: deps.organizationId },
  });

  // 3. Load config + job profile in parallel (independent queries)
  const [dbConfig, job] = await Promise.all([
    db.config.findUnique({ where: { organizationId: deps.organizationId } }),
    db.job.findUnique({
      where: { id: jobId },
      select: { profileId: true },
    }),
  ]);
  const globalInsightPrompt = dbConfig?.globalInsightPrompt ?? "";

  const profile = job?.profileId
    ? await db.digestProfile.findUnique({ where: { id: job.profileId } })
    : null;

  // Resolution priority: explicit param > profile > config > default
  const targetPostCount = deps.maxPosts ?? profile?.maxPosts ?? dbConfig?.maxDigestPosts ?? 5;

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

  // ─── PHASE 1: FETCH from all subreddits (per-sub error recovery) ───
  const errors: string[] = [];
  const fetchErrors: Map<string, string> = new Map();
  const allNewPosts: PooledPost[] = [];
  const allInsightPrompts: string[] = [];
  const fetchedSubreddits: string[] = [];

  // Collect global insight prompt
  if (globalInsightPrompt.length > 0) {
    allInsightPrompts.push(globalInsightPrompt);
  }

  // Collect profile insight prompt (combined with global + per-sub)
  if (profile?.insightPrompt && profile.insightPrompt.length > 0) {
    allInsightPrompts.push(profile.insightPrompt);
  }

  for (const sub of subreddits) {
    try {
      // Checkpoint: before fetch
      if (await checkCancellation(jobId, db)) {
        break;
      }

      const forceRefresh = deps.forceRefresh ?? false;
      const fetchResult = contentSource
        ? await fetchStep(
            {
              name: sub.name,
              maxPosts: sub.maxPosts,
              includeNsfw: sub.includeNsfw,
              lastFetchedAt: forceRefresh ? null : sub.lastFetchedAt,
            },
            contentSource,
            db,
          )
        : await selectPostsStep(
            { name: sub.name, maxPosts: sub.maxPosts, includeNsfw: sub.includeNsfw },
            deps.lookbackHours ?? profile?.lookbackHours ?? 24,
            db,
          );

      // Update lastFetchedAt on the subreddit after a fresh fetch (skip on cache hit)
      if (!fetchResult.fromCache) {
        await db.subreddit.update({
          where: { id: sub.id },
          data: { lastFetchedAt: fetchResult.fetchedAt },
        });
      }

      await emitDomainEvent(
        db,
        eventBus,
        "PostsFetched",
        { jobId, subreddit: sub.name, count: fetchResult.posts.length },
        jobId,
        "job",
        deps.organizationId,
      );

      // Dedup
      const newPosts = fetchResult.posts.filter(
        (p) => !previousPostIds.has(p.redditId),
      );

      for (const p of newPosts) {
        allNewPosts.push({
          subreddit: sub.name,
          postId: p.postId,
          redditId: p.redditId,
          post: p.post,
          comments: p.comments,
        });
      }

      // Collect per-sub insight prompt
      if (sub.insightPrompt && sub.insightPrompt.length > 0) {
        allInsightPrompts.push(sub.insightPrompt);
      }

      // Historical context for triage (best-effort)
      if (deps.searchService) {
        try {
          const recentHistory = await deps.searchService.searchByKeyword(
            sub.name,
            { subreddit: sub.name, limit: 5 },
          );
          if (recentHistory.length > 0) {
            const context = recentHistory
              .map((r) => `"${r.title}" (score: ${r.score})`)
              .join("; ");
            allInsightPrompts.push(
              `Previously discussed topics in r/${sub.name}: ${context}. Prefer posts with NEW information or different perspectives.`,
            );
          }
        } catch {
          // Best-effort: don't fail pipeline for context injection
        }
      }

      fetchedSubreddits.push(sub.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to process r/${sub.name}: ${msg}`);
      fetchErrors.set(sub.name, msg);
    }
  }

  // If canceled during fetch, assemble what we have
  if (await checkCancellation(jobId, db)) {
    return { jobId, status: "CANCELED", subredditResults: [], errors };
  }

  // No candidates at all — FAILED
  if (allNewPosts.length === 0) {
    // Build subredditResults for subs that had fetch errors
    const subredditResults: SubredditPipelineResult[] = subreddits.map((sub) => {
      const fetchError = fetchErrors.get(sub.name);
      return {
        subreddit: sub.name,
        posts: [],
        ...(fetchError ? { error: fetchError } : {}),
      };
    });

    const errorMessage = errors.join("; ") || "No content produced";
    await db.job.update({
      where: { id: jobId },
      data: { status: "FAILED", completedAt: new Date(), error: errorMessage },
    });
    await emitDomainEvent(db, eventBus, "DigestFailed", { jobId, error: errorMessage }, jobId, "job", deps.organizationId);
    return { jobId, status: "FAILED", subredditResults, errors };
  }

  // ─── PHASE 2: POOL + TRIAGE (single global call) ───

  // Checkpoint: before triage
  if (await checkCancellation(jobId, db)) {
    return { jobId, status: "CANCELED", subredditResults: [], errors };
  }

  const candidates: TriagePostCandidate[] = allNewPosts.map((p, i) => ({
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
    allInsightPrompts,
    targetPostCount,
    db,
    jobId,
    triageModel,
    deps.generateTriage as Parameters<typeof triageStep>[6],
  );

  const triageSubreddits = [...new Set(fetchedSubreddits)];
  await emitDomainEvent(
    db,
    eventBus,
    "PostsTriaged",
    { jobId, selectedCount: triageResult.selected.length, subreddits: triageSubreddits },
    jobId,
    "job",
    deps.organizationId,
  );

  // ─── PHASE 3: SUMMARIZE selected posts (per-post error recovery) ───

  // Checkpoint: before summarize
  if (await checkCancellation(jobId, db)) {
    return { jobId, status: "CANCELED", subredditResults: [], errors };
  }

  // Pre-load embedding module once (not per post)
  let generateEmbeddingFn: ((text: string) => Promise<import("@redgest/llm").GenerateResult<number[]>>) | undefined;
  if (process.env.OPENAI_API_KEY) {
    try {
      const llmMod = await import("@redgest/llm");
      generateEmbeddingFn = llmMod.generateEmbedding;
    } catch {
      // Embedding unavailable — proceed without it
    }
  }

  // Build work items (filter out invalid indices)
  const workItems = triageResult.selected.flatMap((sel) => {
    const postData = allNewPosts[sel.index];
    return postData ? [{ sel, postData }] : [];
  });

  // Shared cancellation flag — once set, remaining workers skip
  let canceled = false;
  const sumModel = runtimeModel ? getModel("summarize", runtimeModel) : undefined;

  type PostResult = SubredditPipelineResult["posts"][number] & { subreddit: string };
  const settled = await mapSettled(
    workItems,
    async ({ sel, postData }): Promise<PostResult | null> => {
      // Skip if cancellation was detected by another concurrent worker
      if (canceled) return null;

      // Checkpoint: check cancellation before starting this post
      if (await checkCancellation(jobId, db)) {
        canceled = true;
        return null;
      }

      const sumComments: SummarizationComment[] =
        postData.comments.map((c) => ({
          author: c.author,
          score: c.score,
          body: c.body,
        }));

      const sumResult = await summarizeStep(
        {
          title: postData.post.title,
          subreddit: postData.post.subreddit,
          author: postData.post.author,
          score: postData.post.score,
          selftext: postData.post.selftext,
        },
        sumComments,
        allInsightPrompts,
        jobId,
        postData.postId,
        db,
        sumModel,
        sel.rationale,
        deps.generateSummary as Parameters<typeof summarizeStep>[8],
      );

      // --- Embedding (optional, best-effort) ---
      if (generateEmbeddingFn) {
        try {
          const embResult = await generateEmbeddingFn(sumResult.summary.summary);
          const vecStr = `[${embResult.data.join(",")}]`;
          await db.$executeRaw`
            UPDATE post_summaries SET embedding = ${vecStr}::vector WHERE id = ${sumResult.postSummaryId}
          `;
          if (embResult.log) {
            await db.llmCall.create({
              data: {
                jobId,
                postId: postData.postId,
                task: "embed",
                model: embResult.log.model,
                inputTokens: embResult.log.inputTokens,
                outputTokens: embResult.log.outputTokens,
                durationMs: embResult.log.durationMs,
                cached: embResult.log.cached,
                finishReason: embResult.log.finishReason,
              },
            });
          }
        } catch (err) {
          console.error(
            `[Pipeline] Embedding failed for post ${postData.redditId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // --- Topic extraction (best-effort) ---
      try {
        await topicStep(postData.postId, sumResult.summary, db);
      } catch (err) {
        console.error(
          `[Pipeline] Topic extraction failed for post ${postData.redditId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        subreddit: postData.subreddit,
        postId: postData.postId,
        redditId: postData.redditId,
        title: postData.post.title,
        summary: sumResult.summary,
        selectionRationale: sel.rationale,
      };
    },
    SUMMARIZE_CONCURRENCY,
  );

  // Collect results and errors from settled promises
  const summarizedPosts: PostResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (!s) continue;
    if (s.status === "fulfilled" && s.value !== null) {
      summarizedPosts.push(s.value);
    } else if (s.status === "rejected") {
      const workItem = workItems[i];
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      errors.push(
        `Failed to summarize post ${workItem?.postData.redditId}: ${msg}`,
      );
    }
  }

  await emitDomainEvent(
    db,
    eventBus,
    "PostsSummarized",
    { jobId, summaryCount: summarizedPosts.length },
    jobId,
    "job",
    deps.organizationId,
  );

  // ─── PHASE 4: GROUP results by subreddit + ASSEMBLE ───

  // Group summarized posts back into per-subreddit results (preserving triage order)
  const postsBySubreddit = new Map<string, SubredditPipelineResult["posts"]>();
  for (const post of summarizedPosts) {
    let bucket = postsBySubreddit.get(post.subreddit);
    if (!bucket) {
      bucket = [];
      postsBySubreddit.set(post.subreddit, bucket);
    }
    bucket.push({
      postId: post.postId,
      redditId: post.redditId,
      title: post.title,
      summary: post.summary,
      selectionRationale: post.selectionRationale,
    });
  }

  // Build SubredditPipelineResult[] for all subreddits (including those with no selected posts)
  const subredditResults: SubredditPipelineResult[] = subreddits.map((sub) => {
    const fetchError = fetchErrors.get(sub.name);
    return {
      subreddit: sub.name,
      posts: postsBySubreddit.get(sub.name) ?? [],
      ...(fetchError ? { error: fetchError } : {}),
    };
  });

  // Check if job was canceled — preserve CANCELED status
  if (await checkCancellation(jobId, db)) {
    const canceledTotalPosts = subredditResults.reduce(
      (sum, r) => sum + r.posts.length,
      0,
    );
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

    await emitDomainEvent(
      db,
      eventBus,
      "DigestFailed",
      { jobId, error: errorMessage },
      jobId,
      "job",
      deps.organizationId,
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

  await emitDomainEvent(
    db,
    eventBus,
    "DigestCompleted",
    {
      jobId,
      digestId: assembleResult.digestId,
    },
    jobId,
    "job",
    deps.organizationId,
  );

  return {
    jobId,
    status: finalStatus,
    digestId: assembleResult.digestId,
    subredditResults,
    errors,
  };
}
