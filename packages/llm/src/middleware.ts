import { generateText, Output } from "ai";
import type { LanguageModel } from "ai";
import type { ZodType } from "zod";

export interface LlmCallLog {
  task: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  cached: boolean;
  finishReason: string;
}

export interface GenerateResult<T> {
  data: T;
  log: LlmCallLog | null;
}

/**
 * Wrap generateText with logging. Returns the result and logs metrics.
 */
export async function generateWithLogging<T>(opts: {
  task: string;
  model: LanguageModel;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  cached?: boolean;
}): Promise<{ output: T; log: LlmCallLog }> {
  const start = performance.now();

  const result = await generateText({
    model: opts.model,
    system: opts.system,
    prompt: opts.prompt,
    output: Output.object({ schema: opts.schema }),
  });

  const durationMs = Math.round(performance.now() - start);

  const log: LlmCallLog = {
    task: opts.task,
    model: String(
      (opts.model as LanguageModel & { modelId?: string }).modelId ??
        "unknown",
    ),
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    totalTokens:
      (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
    durationMs,
    cached: opts.cached ?? false,
    finishReason: result.finishReason ?? "unknown",
  };

  // eslint-disable-next-line no-console -- structured LLM call log for observability
  console.log(JSON.stringify({ type: "llm_call", ...log }));

  return { output: result.output as T, log };
}
