import type { LanguageModel } from "ai";
import { TriageResultSchema } from "./schemas";
import type { TriageResult } from "./schemas";
import {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
} from "./prompts/index";
import type { TriagePostCandidate } from "./prompts/index";
import { getModel } from "./provider";
import { withCache } from "./cache";
import { generateWithLogging } from "./middleware";
import type { GenerateResult, LlmCallLog } from "./middleware";

export async function generateTriageResult(
  posts: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: LanguageModel,
): Promise<GenerateResult<TriageResult>> {
  const resolvedModel = model ?? getModel("triage");
  const system = buildTriageSystemPrompt(insightPrompts);
  const prompt = buildTriageUserPrompt(posts, targetCount);

  let llmLog: LlmCallLog | null = null;

  const { data, cached } = await withCache(
    "triage",
    { posts, insightPrompts, targetCount },
    async () => {
      const { output, log } = await generateWithLogging({
        task: "triage",
        model: resolvedModel,
        system,
        prompt,
        schema: TriageResultSchema,
      });
      llmLog = log;
      return output;
    },
  );

  if (cached) {
    // eslint-disable-next-line no-console -- structured LLM call log for observability
    console.log(
      JSON.stringify({ type: "llm_call", task: "triage", cached: true, durationMs: 0 }),
    );
  }

  return { data, log: llmLog };
}
