import type { LanguageModel } from "ai";
import { PostSummarySchema } from "./schemas";
import type { PostSummary } from "./schemas";
import {
  buildSummarizationSystemPrompt,
  buildSummarizationUserPrompt,
} from "./prompts/index";
import type {
  SummarizationPost,
  SummarizationComment,
} from "./prompts/index";
import { getModel } from "./provider";
import { withCache } from "./cache";
import { generateWithLogging } from "./middleware";
import type { GenerateResult, LlmCallLog } from "./middleware";

export async function generatePostSummary(
  post: SummarizationPost,
  comments: SummarizationComment[],
  insightPrompts: string[],
  model?: LanguageModel,
): Promise<GenerateResult<PostSummary>> {
  const resolvedModel = model ?? getModel("summarize");
  const system = buildSummarizationSystemPrompt(insightPrompts);
  const prompt = buildSummarizationUserPrompt(post, comments);

  let llmLog: LlmCallLog | null = null;

  const { data, cached } = await withCache(
    "summary",
    { post, comments, insightPrompts },
    async () => {
      const { output, log } = await generateWithLogging({
        task: "summarize",
        model: resolvedModel,
        system,
        prompt,
        schema: PostSummarySchema,
      });
      llmLog = log;
      return output;
    },
  );

  if (cached) {
    // eslint-disable-next-line no-console -- structured LLM call log for observability
    console.log(
      JSON.stringify({ type: "llm_call", task: "summarize", cached: true, durationMs: 0 }),
    );
  }

  return { data, log: llmLog };
}
