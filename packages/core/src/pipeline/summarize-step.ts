import type { LanguageModel } from "ai";
import type { PrismaClient } from "@redgest/db";
import type { SummarizationPost, SummarizationComment } from "@redgest/llm";
import { generatePostSummary } from "@redgest/llm";
import { applySummarizationBudget } from "./token-budget";
import type { SummarizeStepResult } from "./types";

type SummaryFn = typeof generatePostSummary;

export async function summarizeStep(
  post: SummarizationPost,
  comments: SummarizationComment[],
  insightPrompts: string[],
  jobId: string,
  postId: string,
  db: PrismaClient,
  model?: LanguageModel,
  selectionRationale?: string,
  summarizeFn?: SummaryFn,
): Promise<SummarizeStepResult> {
  // Apply comments-first truncation (ADR-011)
  const budgeted = applySummarizationBudget(post.selftext, comments);

  const truncatedPost: SummarizationPost = {
    ...post,
    selftext: budgeted.selftext,
  };

  const generate = summarizeFn ?? generatePostSummary;
  const { data: summary, log } = await generate(
    truncatedPost,
    budgeted.comments,
    insightPrompts,
    model,
  );

  if (log) {
    await db.llmCall.create({
      data: {
        jobId,
        postId,
        task: "summarize",
        model: log.model,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
        durationMs: log.durationMs,
        cached: log.cached,
        finishReason: log.finishReason,
      },
    });
  }

  const isModelObject = model != null && typeof model === "object";
  const llmProvider =
    isModelObject && "provider" in model ? model.provider : "anthropic";
  const llmModel =
    isModelObject && "modelId" in model
      ? model.modelId
      : "claude-sonnet-4-20250514";

  // Save to database
  const record = await db.postSummary.create({
    data: {
      postId,
      jobId,
      summary: summary.summary,
      keyTakeaways: summary.keyTakeaways,
      insightNotes: summary.insightNotes,
      commentHighlights: summary.commentHighlights,
      communityConsensus: summary.communityConsensus,
      sentiment: summary.sentiment,
      selectionRationale: selectionRationale ?? "",
      llmProvider,
      llmModel,
    },
  });

  return { postSummaryId: record.id, summary };
}
