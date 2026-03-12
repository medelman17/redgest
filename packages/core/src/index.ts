// Errors
export { RedgestError, ErrorCode, type ErrorCodeType } from "./errors.js";

// Events
export type {
  DomainEventMap,
  DomainEventType,
  DomainEvent,
} from "./events/types.js";
export { DomainEventBus } from "./events/bus.js";
export { persistEvent, type EventCreateClient } from "./events/persist.js";
export { eventPayloadSchemas, parseEventPayload } from "./events/schemas.js";

// Commands
export type {
  CommandMap,
  CommandResultMap,
  CommandEventMap,
  CommandType,
  Command,
  CommandHandler,
} from "./commands/types.js";
export {
  createExecute,
  type ExecuteContext,
  type TransactableClient,
  type TransactionArg,
} from "./commands/dispatch.js";

// Queries
export type {
  QueryMap,
  QueryResultMap,
  QueryType,
  Query,
  QueryHandler,
  Paginated,
  LlmMetrics,
  LlmTaskMetrics,
  RunStatusDetail,
  RunStatusSteps,
  SubredditStepDetail,
  StructuredError,
} from "./queries/types.js";
export { DEFAULT_PAGE_SIZE } from "./queries/types.js";
export { paginate } from "./queries/paginate.js";
export { createQuery } from "./queries/dispatch.js";

// Command handlers
export { commandHandlers } from "./commands/handlers/index.js";
export {
  handleGenerateDigest,
  handleAddSubreddit,
  handleRemoveSubreddit,
  handleUpdateSubreddit,
  handleUpdateConfig,
  handleCancelRun,
} from "./commands/handlers/index.js";

// Query handlers
export { queryHandlers } from "./queries/handlers/index.js";
export {
  handleGetDigest,
  handleListDigests,
  handleSearchDigests,
  handleGetPost,
  handleSearchPosts,
  handleGetRunStatus,
  handleListRuns,
  handleListSubreddits,
  handleGetConfig,
  handleGetLlmMetrics,
  handleGetSubredditStats,
} from "./queries/handlers/index.js";

// Context
export type { HandlerContext, DbClient } from "./context.js";

// Digest dispatch
export {
  wireDigestDispatch,
  type DigestDispatchDeps,
} from "./digest-dispatch.js";
// Pipeline
export {
  runDigestPipeline,
  fetchStep,
  triageStep,
  summarizeStep,
  assembleStep,
  renderDigestMarkdown,
  estimateTokens,
  truncateText,
  applyTriageBudget,
  applySummarizationBudget,
  findPreviousPostIds,
  TRIAGE_TOKEN_BUDGET,
  SUMMARIZATION_TOKEN_BUDGET,
} from "./pipeline/index.js";
export type {
  ContentSource,
  FetchOptions,
  FetchedContent,
  PipelineDeps,
  PipelineResult,
  PipelineModelConfig,
  SubredditPipelineResult,
  FetchStepResult,
  TriageStepResult,
  SummarizeStepResult,
  AssembleStepResult,
} from "./pipeline/index.js";
