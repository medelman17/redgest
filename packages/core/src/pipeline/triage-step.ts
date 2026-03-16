import type { LanguageModel } from "ai";
import type { PrismaClient } from "@redgest/db";
import type { TriagePostCandidate } from "@redgest/llm";
import { generateTriageResult } from "@redgest/llm";
import { applyTriageBudget } from "./token-budget";
import type { TriageStepResult } from "./types";

type TriageFn = typeof generateTriageResult;

export async function triageStep(
  candidates: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  db: PrismaClient,
  jobId: string,
  model?: LanguageModel,
  triageFn?: TriageFn,
): Promise<TriageStepResult> {
  if (candidates.length === 0) {
    return { selected: [] };
  }

  // If we have fewer candidates than target, select all
  const effectiveTarget = Math.min(targetCount, candidates.length);

  // Apply token budget to truncate long selftext
  const budgeted = applyTriageBudget(candidates);

  const generate = triageFn ?? generateTriageResult;
  const { data: result, log } = await generate(
    budgeted,
    insightPrompts,
    effectiveTarget,
    model,
  );

  if (log) {
    await db.llmCall.create({
      data: {
        jobId,
        postId: null,
        task: "triage",
        model: log.model,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
        durationMs: log.durationMs,
        cached: log.cached,
        finishReason: log.finishReason,
      },
    });
  }

  return {
    selected: result.selectedPosts.map((sp) => ({
      index: sp.index,
      relevanceScore: sp.relevanceScore,
      rationale: sp.rationale,
    })),
  };
}
