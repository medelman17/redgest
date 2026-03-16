// Errors
export { RedgestError, ErrorCode, type ErrorCodeType } from "./errors.js";

// Events
export type {
  DomainEventMap,
  DomainEventType,
  DomainEvent,
} from "./events/types.js";
export type { EventBus } from "./events/bus.js";
export { InProcessEventBus } from "./events/transports/in-process.js";
export {
  createEventBus,
  type EventBusTransport,
  type EventBusOptions,
} from "./events/factory.js";
export { persistEvent, type EventCreateClient } from "./events/persist.js";
export { emitDomainEvent } from "./events/emit.js";
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
  DigestComparisonResult,
  DigestSummaryInfo,
  ComparisonPost,
  SubredditDelta,
  DeliveryStatusResult,
  DeliveryStatusDigest,
  DeliveryStatusChannel,
  TrendingTopic,
  PeriodSummary,
  PeriodComparisonResult,
  CrawlStatusItem,
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
  handleCreateProfile,
  handleUpdateProfile,
  handleDeleteProfile,
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
  handleCompareDigests,
  handleGetDeliveryStatus,
  handleFindSimilar,
  handleAskHistory,
  handleGetTrendingTopics,
  handleComparePeriods,
  handleListProfiles,
  handleGetProfile,
  handleGetCrawlStatus,
} from "./queries/handlers/index.js";

// Context
export type { HandlerContext, DbClient } from "./context.js";

// Delivery recording
export { recordDeliveryPending, recordDeliveryResult } from "./delivery/record.js";
export type { DeliveryClient, DeliveryTransactionClient } from "./delivery/record.js";

// Digest dispatch
export {
  wireDigestDispatch,
  type DigestDispatchDeps,
} from "./digest-dispatch.js";

// Crawl dispatch
export {
  wireCrawlDispatch,
  type CrawlDispatchDeps,
} from "./crawl-dispatch.js";

// Crawl pipeline
export { runCrawl, type CrawlResult, type CrawlDeps } from "./crawl-pipeline.js";
// Pipeline
export {
  runDigestPipeline,
  fetchStep,
  selectPostsStep,
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

// Search
export { createSearchService } from "./search/index.js";
export type { SearchService, SearchResult, SearchOptions } from "./search/index.js";

// Utils
export { parseDuration } from "./utils/index.js";
