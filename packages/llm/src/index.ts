export {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  buildSummarizationSystemPrompt,
  buildSummarizationUserPrompt,
  buildDeliverySystemPrompt,
  buildDeliveryUserPrompt,
  sanitizeForPrompt,
} from "./prompts/index.js";

export type {
  TriagePostCandidate,
  SummarizationPost,
  SummarizationComment,
  DeliveryDigestInput,
  DeliveryChannel,
} from "./prompts/index.js";

export { TriageResultSchema, PostSummarySchema, DeliveryProseSchema } from "./schemas.js";
export type { TriageResult, PostSummary, DeliveryProse } from "./schemas.js";
export type { CandidatePost, SummarizationInput } from "./types.js";

export { getModel, type ModelConfig } from "./provider.js";
export { generateTriageResult } from "./generate-triage.js";
export { generatePostSummary } from "./generate-summary.js";
export { generateDeliveryProse } from "./generate-delivery-prose.js";

export { withCache, disconnectCache, type CacheResult } from "./cache.js";
export { generateWithLogging, type LlmCallLog, type GenerateResult } from "./middleware.js";
export { generateEmbedding } from "./generate-embedding.js";
