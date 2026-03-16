// Errors
export { RedgestError, ErrorCode, type ErrorCodeType } from "./errors";

// Events
export type {
  DomainEventMap,
  DomainEventType,
  DomainEvent,
} from "./events/types";
export type { EventBus } from "./events/bus";
export { InProcessEventBus } from "./events/transports/in-process";
export {
  createEventBus,
  type EventBusTransport,
  type EventBusOptions,
} from "./events/factory";
export { persistEvent, type EventCreateClient } from "./events/persist";
export { emitDomainEvent } from "./events/emit";
export { eventPayloadSchemas, parseEventPayload } from "./events/schemas";

// Commands
export type {
  CommandMap,
  CommandResultMap,
  CommandEventMap,
  CommandType,
  Command,
  CommandHandler,
} from "./commands/types";
export {
  createExecute,
  type ExecuteContext,
  type TransactableClient,
  type TransactionArg,
} from "./commands/dispatch";

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
} from "./queries/types";
export { DEFAULT_PAGE_SIZE } from "./queries/types";
export { paginate } from "./queries/paginate";
export { createQuery } from "./queries/dispatch";

// Command handlers
export { commandHandlers } from "./commands/handlers/index";
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
} from "./commands/handlers/index";

// Query handlers
export { queryHandlers } from "./queries/handlers/index";
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
} from "./queries/handlers/index";

// Context
export type { HandlerContext, DbClient } from "./context";

// Delivery recording
export { recordDeliveryPending, recordDeliveryResult } from "./delivery/record";
export type { DeliveryClient, DeliveryTransactionClient } from "./delivery/record";

// Digest dispatch
export {
  wireDigestDispatch,
  type DigestDispatchDeps,
} from "./digest-dispatch";

// Crawl dispatch
export {
  wireCrawlDispatch,
  type CrawlDispatchDeps,
} from "./crawl-dispatch";

// Crawl pipeline
export { runCrawl, type CrawlResult, type CrawlDeps } from "./crawl-pipeline";
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
} from "./pipeline/index";
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
} from "./pipeline/index";

// Search
export { createSearchService } from "./search/index";
export type { SearchService, SearchResult, SearchOptions } from "./search/index";

// Utils
export { parseDuration } from "./utils/index";
