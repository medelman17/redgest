import type { DomainEventMap, DomainEventType } from "../events/types.js";

/**
 * CommandMap — all commands the system accepts.
 * Each key is a command name, value is the params type.
 */
export interface CommandMap {
  GenerateDigest: {
    subredditIds?: string[];
    lookbackHours?: number;
  };
  AddSubreddit: {
    name: string;
    displayName: string;
    insightPrompt?: string;
    maxPosts?: number;
    nsfw?: boolean;
  };
  RemoveSubreddit: {
    subredditId: string;
  };
  UpdateSubreddit: {
    subredditId: string;
    insightPrompt?: string;
    maxPosts?: number;
    active?: boolean;
  };
  UpdateConfig: {
    globalInsightPrompt?: string;
    defaultLookbackHours?: number;
    llmProvider?: string;
    llmModel?: string;
    defaultDelivery?: import("@redgest/db").DeliveryChannel;
    schedule?: string | null;
  };
}

/**
 * CommandResultMap — what each command returns on success.
 */
export interface CommandResultMap {
  GenerateDigest: { jobId: string; status: string };
  AddSubreddit: { subredditId: string };
  RemoveSubreddit: { subredditId: string };
  UpdateSubreddit: { subredditId: string };
  UpdateConfig: { success: true };
}

/**
 * CommandEventMap — which event each command emits.
 * `never` means the command doesn't emit an event.
 */
export interface CommandEventMap {
  GenerateDigest: "DigestRequested";
  AddSubreddit: "SubredditAdded";
  RemoveSubreddit: "SubredditRemoved";
  UpdateSubreddit: never;
  UpdateConfig: "ConfigUpdated";
}

// Derived types
export type CommandType = keyof CommandMap;

export type Command = {
  [K in CommandType]: { type: K; params: CommandMap[K] };
}[CommandType];

/**
 * CommandHandler — plain async function, receives params + context.
 * Returns data + event (null if CommandEventMap[K] is never).
 */
export type CommandHandler<K extends CommandType> = (
  params: CommandMap[K],
  ctx: import("../context.js").HandlerContext,
) => Promise<{
  data: CommandResultMap[K];
  event: CommandEventMap[K] extends never
    ? null
    : CommandEventMap[K] extends DomainEventType
      ? DomainEventMap[CommandEventMap[K]]
      : never;
}>;
