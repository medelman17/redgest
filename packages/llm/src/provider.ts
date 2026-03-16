import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

const PROVIDERS = { anthropic, openai } as const;

export interface ModelConfig {
  provider: keyof typeof PROVIDERS;
  model: string;
}

const DEFAULT_MODELS: Record<string, ModelConfig> = {
  triage: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  summarize: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  delivery: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
};

export function getModel(
  taskName: string,
  override?: ModelConfig,
): LanguageModel {
  const config = override ?? DEFAULT_MODELS[taskName];
  if (!config) {
    throw new Error(`No model configured for task: ${taskName}`);
  }
  const factory = PROVIDERS[config.provider];
  return factory(config.model);
}
