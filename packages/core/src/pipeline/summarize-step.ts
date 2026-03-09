import type { LanguageModel } from "ai";
import type { PrismaClient } from "@redgest/db";
import type { SummarizationPost, SummarizationComment } from "@redgest/llm";
import { generatePostSummary } from "@redgest/llm";
import { applySummarizationBudget } from "./token-budget.js";
import type { SummarizeStepResult } from "./types.js";

export async function summarizeStep(
  post: SummarizationPost,
  comments: SummarizationComment[],
  insightPrompts: string[],
  jobId: string,
  postId: string,
  db: PrismaClient,
  model?: LanguageModel,
  selectionRationale?: string,
): Promise<SummarizeStepResult> {
  // Apply comments-first truncation (ADR-011)
  const budgeted = applySummarizationBudget(post.selftext, comments);

  const truncatedPost: SummarizationPost = {
    ...post,
    selftext: budgeted.selftext,
  };

  const summary = await generatePostSummary(
    truncatedPost,
    budgeted.comments,
    insightPrompts,
    model,
  );

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
      selectionRationale: selectionRationale ?? "",
      llmProvider,
      llmModel,
    },
  });

  return { postSummaryId: record.id, summary };
}
