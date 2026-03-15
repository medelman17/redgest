import type {
  CommandType,
  CommandMap,
  CommandResultMap,
  CommandHandler,
} from "./types.js";
import type { HandlerContext } from "../context.js";
import type { DomainEvent, DomainEventType } from "../events/types.js";
import type { EventCreateClient } from "../events/persist.js";
import { persistEvent } from "../events/persist.js";

/**
 * Transaction callback argument — what execute() receives inside $transaction.
 * At runtime this is Prisma's TransactionClient (full model access + event table).
 * We model only what dispatch itself needs: event persistence via EventCreateClient.
 * Handlers receive this as HandlerContext["db"] via a narrowing cast in the
 * transaction body (safe because Prisma's $transaction always provides a full
 * TransactionClient). The index signature enables mock construction in tests.
 */
export interface TransactionArg extends EventCreateClient {
  [key: string]: unknown;
}

/**
 * Minimal interface for a DB client that supports interactive transactions.
 * Avoids importing PrismaClient directly — keeps dispatch testable with mocks.
 */
export interface TransactableClient {
  $transaction: <R>(
    fn: (tx: TransactionArg) => Promise<R>,
  ) => Promise<R>;
}

/**
 * Context for execute() — requires a TransactableClient instead of DbClient.
 * This is the call-site contract: execute() must receive a full PrismaClient
 * (which satisfies TransactableClient), not a TransactionClient.
 */
export interface ExecuteContext {
  db: TransactableClient;
  eventBus: HandlerContext["eventBus"];
  config: HandlerContext["config"];
  organizationId: string;
}

/**
 * Event type lookup — maps command type to its emitted event type.
 * Returns undefined for commands that don't emit events (CommandEventMap[K] = never).
 */
const COMMAND_EVENT_TYPES: Record<CommandType, DomainEventType | undefined> = {
  GenerateDigest: "DigestRequested",
  AddSubreddit: "SubredditAdded",
  RemoveSubreddit: "SubredditRemoved",
  UpdateSubreddit: undefined,
  UpdateConfig: "ConfigUpdated",
  CancelRun: "DigestCanceled",
  CreateProfile: "ProfileCreated",
  UpdateProfile: undefined,
  DeleteProfile: "ProfileDeleted",
};

/**
 * Aggregate type lookup — maps command type to its aggregate type for event envelope.
 */
const COMMAND_AGGREGATE_TYPES: Record<CommandType, string> = {
  GenerateDigest: "job",
  AddSubreddit: "subreddit",
  RemoveSubreddit: "subreddit",
  UpdateSubreddit: "subreddit",
  UpdateConfig: "config",
  CancelRun: "job",
  CreateProfile: "profile",
  UpdateProfile: "profile",
  DeleteProfile: "profile",
};

type HandlerRegistry = {
  [K in CommandType]?: CommandHandler<K>;
};

/**
 * Create the execute() dispatch function with a handler registry.
 * Handlers are registered at startup, not at runtime.
 *
 * Returns a typed dispatch function:
 *   execute('GenerateDigest', { subredditIds: [...] }, ctx) → { jobId, status }
 */
export function createExecute(handlers: HandlerRegistry) {
  return async function execute<K extends CommandType>(
    type: K,
    params: CommandMap[K],
    ctx: ExecuteContext,
  ): Promise<CommandResultMap[K]> {
    const handler = handlers[type] as CommandHandler<K> | undefined;
    if (!handler) {
      throw new Error(`No handler registered for command: ${type}`);
    }

    const eventType = COMMAND_EVENT_TYPES[type];
    const aggregateType = COMMAND_AGGREGATE_TYPES[type];

    const { data, event: eventPayload } = await ctx.db.$transaction(
      async (tx) => {
        // Handler receives tx as its db — inside the transaction boundary.
        // At runtime, Prisma's $transaction provides a full TransactionClient
        // which satisfies DbClient. Our TransactionArg models only what dispatch
        // needs (EventCreateClient). The double cast is safe and isolated here.
        const db: HandlerContext["db"] = tx as unknown as HandlerContext["db"];
        const handlerCtx: HandlerContext = {
          db,
          eventBus: ctx.eventBus,
          config: ctx.config,
          organizationId: ctx.organizationId,
        };
        const result = await handler(params, handlerCtx);

        if (result.event !== null && eventType !== undefined) {
          const fullEvent = buildEvent(
            eventType,
            result.event as Record<string, unknown>,
            extractAggregateId(type, result.data),
            aggregateType,
            ctx.organizationId,
          );

          await persistEvent(tx, fullEvent);
          return { data: result.data, event: fullEvent };
        }

        return { data: result.data, event: null };
      },
    );

    // Emit AFTER transaction commits
    if (eventPayload) {
      ctx.eventBus.emitEvent(eventPayload);
    }

    return data;
  };
}

/**
 * Build a DomainEvent from parts. Encapsulates the cast from
 * runtime-determined type+payload to the discriminated DomainEvent union.
 * Safe because COMMAND_EVENT_TYPES is the single source of truth.
 */
function buildEvent(
  eventType: DomainEventType,
  payload: Record<string, unknown>,
  aggregateId: string,
  aggregateType: string,
  organizationId?: string,
): DomainEvent {
  const envelope: Record<string, unknown> = {
    type: eventType,
    payload,
    aggregateId,
    aggregateType,
    version: 1,
    organizationId: organizationId ?? null,
    correlationId: null,
    causationId: null,
    metadata: {},
    occurredAt: new Date(),
  };
  return envelope as DomainEvent;
}

/**
 * Extract the aggregate ID from the command result.
 * Used to populate the event envelope's aggregateId field.
 */
function extractAggregateId(type: CommandType, data: unknown): string {
  const result = data as Record<string, unknown>;
  if ((type === "GenerateDigest" || type === "CancelRun") && typeof result.jobId === "string") {
    return result.jobId;
  }
  if (typeof result.subredditId === "string") {
    return result.subredditId;
  }
  if (typeof result.profileId === "string") {
    return result.profileId;
  }
  if (type === "UpdateConfig") {
    return "config-singleton";
  }
  return "unknown";
}
