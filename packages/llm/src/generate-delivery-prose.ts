import type { LanguageModel } from "ai";
import { DeliveryProseSchema } from "./schemas";
import type { DeliveryProse } from "./schemas";
import {
  buildDeliverySystemPrompt,
  buildDeliveryUserPrompt,
} from "./prompts/index";
import type { DeliveryDigestInput, DeliveryChannel } from "./prompts/index";
import { getModel } from "./provider";
import { withCache } from "./cache";
import { generateWithLogging } from "./middleware";
import type { GenerateResult, LlmCallLog } from "./middleware";

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
