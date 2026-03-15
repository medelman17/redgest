import type { LanguageModel } from "ai";
import { DeliveryProseSchema } from "./schemas.js";
import type { DeliveryProse } from "./schemas.js";
import {
  buildDeliverySystemPrompt,
  buildDeliveryUserPrompt,
} from "./prompts/index.js";
import type { DeliveryDigestInput, DeliveryChannel } from "./prompts/index.js";
import { getModel } from "./provider.js";
import { withCache } from "./cache.js";
import { generateWithLogging } from "./middleware.js";
import type { GenerateResult, LlmCallLog } from "./middleware.js";

export async function generateDeliveryProse(
  input: DeliveryDigestInput,
  channel: DeliveryChannel,
  model?: LanguageModel,
): Promise<GenerateResult<DeliveryProse>> {
  const resolvedModel = model ?? getModel("delivery");
  const system = buildDeliverySystemPrompt(channel);
  const prompt = buildDeliveryUserPrompt(input);

  let llmLog: LlmCallLog | null = null;

  const { data, cached } = await withCache(
    `delivery-${channel}`,
    { input, channel },
    async () => {
      const { output, log } = await generateWithLogging({
        task: `delivery-${channel}`,
        model: resolvedModel,
        system,
        prompt,
        schema: DeliveryProseSchema,
      });
      llmLog = log;
      return output;
    },
  );

  if (cached) {
    // eslint-disable-next-line no-console -- structured LLM call log for observability
    console.log(
      JSON.stringify({ type: "llm_call", task: `delivery-${channel}`, cached: true, durationMs: 0 }),
    );
  }

  return { data, log: llmLog };
}
