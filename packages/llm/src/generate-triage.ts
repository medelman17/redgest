import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { TriageResultSchema } from "./schemas.js";
import type { TriageResult } from "./schemas.js";
import {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
} from "./prompts/index.js";
import type { TriagePostCandidate } from "./prompts/index.js";
import { getModel } from "./provider.js";

export async function generateTriageResult(
  posts: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: LanguageModel,
): Promise<TriageResult> {
  const result = await generateText({
    model: model ?? getModel("triage"),
    system: buildTriageSystemPrompt(insightPrompts),
    prompt: buildTriageUserPrompt(posts, targetCount),
    output: Output.object({ schema: TriageResultSchema }),
  });

  return result.output;
}
