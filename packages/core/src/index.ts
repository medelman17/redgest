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
} from "./queries/types.js";
export { createQuery } from "./queries/dispatch.js";

// Command handlers
export { commandHandlers } from "./commands/handlers/index.js";
export {
  handleGenerateDigest,
  handleAddSubreddit,
  handleRemoveSubreddit,
  handleUpdateSubreddit,
  handleUpdateConfig,
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
} from "./queries/handlers/index.js";

// Context
export type { HandlerContext, DbClient } from "./context.js";
