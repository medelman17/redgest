import type { LanguageModel } from "ai";
import type { TriagePostCandidate } from "@redgest/llm";
import { generateTriageResult } from "@redgest/llm";
import { applyTriageBudget } from "./token-budget.js";
import type { TriageStepResult } from "./types.js";

type TriageFn = typeof generateTriageResult;

export async function triageStep(
  candidates: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
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
  const result = await generate(
    budgeted,
    insightPrompts,
    effectiveTarget,
    model,
  );

  return {
    selected: result.selectedPosts.map((sp) => ({
      index: sp.index,
      relevanceScore: sp.relevanceScore,
      rationale: sp.rationale,
    })),
  };
}
