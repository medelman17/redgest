import type { LanguageModel } from "ai";
import { TriageResultSchema } from "./schemas.js";
import type { TriageResult } from "./schemas.js";
import {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
} from "./prompts/index.js";
import type { TriagePostCandidate } from "./prompts/index.js";
import { getModel } from "./provider.js";
import { withCache } from "./cache.js";
import { generateWithLogging } from "./middleware.js";

export async function generateTriageResult(
  posts: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: LanguageModel,
): Promise<TriageResult> {
  const resolvedModel = model ?? getModel("triage");
  const system = buildTriageSystemPrompt(insightPrompts);
  const prompt = buildTriageUserPrompt(posts, targetCount);

  const { data, cached } = await withCache(
    "triage",
    { posts, insightPrompts, targetCount },
    async () => {
      const { output } = await generateWithLogging({
        task: "triage",
        model: resolvedModel,
        system,
        prompt,
        schema: TriageResultSchema,
      });
      return output;
    },
  );

  if (cached) {
    // eslint-disable-next-line no-console -- structured LLM call log for observability
    console.log(
      JSON.stringify({ type: "llm_call", task: "triage", cached: true, durationMs: 0 }),
    );
  }

  return data;
}
