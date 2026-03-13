import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import type { LlmCallLog, GenerateResult } from "./middleware.js";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Generate an embedding vector for the given text.
 * Returns the embedding and an LlmCallLog for observability.
 */
export async function generateEmbedding(
  text: string,
  modelName?: string,
): Promise<GenerateResult<number[]>> {
  const resolvedModelName = modelName ?? DEFAULT_EMBEDDING_MODEL;
  const model = openai.embedding(resolvedModelName);

  const start = performance.now();
  const result = await embed({ model, value: text });
  const durationMs = Math.round(performance.now() - start);

  const tokens = result.usage.tokens;

  const log: LlmCallLog = {
    task: "embed",
    model: resolvedModelName,
    inputTokens: tokens,
    outputTokens: 0,
    totalTokens: tokens,
    durationMs,
    cached: false,
    finishReason: "complete",
  };

  // eslint-disable-next-line no-console -- structured LLM call log
  console.log(JSON.stringify({ type: "llm_call", ...log }));

  return { data: result.embedding, log };
}
