import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import { PostSummarySchema } from "./schemas.js";
import type { PostSummary } from "./schemas.js";
import {
  buildSummarizationSystemPrompt,
  buildSummarizationUserPrompt,
} from "./prompts/index.js";
import type {
  SummarizationPost,
  SummarizationComment,
} from "./prompts/index.js";
import { getModel } from "./provider.js";

export async function generatePostSummary(
  post: SummarizationPost,
  comments: SummarizationComment[],
  insightPrompts: string[],
  model?: LanguageModel,
): Promise<PostSummary> {
  const result = await generateText({
    model: model ?? getModel("summarize"),
    system: buildSummarizationSystemPrompt(insightPrompts),
    prompt: buildSummarizationUserPrompt(post, comments),
    output: Output.object({ schema: PostSummarySchema }),
  });

  return result.output;
}
