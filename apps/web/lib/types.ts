import type { Config, SubredditView } from "@redgest/db";

/** Convert Date fields to strings for crossing the RSC → client boundary. */
type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};

export type SerializedSubreddit = Serialized<SubredditView>;

export function serializeSubreddit(sub: SubredditView): SerializedSubreddit {
  return {
    ...sub,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    lastDigestDate: sub.lastDigestDate?.toISOString() ?? null,
  };
}

export type SerializedConfig = Serialized<Config>;

export function serializeConfig(config: Config): SerializedConfig {
  return {
    ...config,
    updatedAt: config.updatedAt.toISOString(),
  };
}

/** Shared action result type -- matches Server Action return shapes in actions.ts */
export type ActionResult<T = { subredditId: string }> =
  | { ok: true; data: T }
  | { ok: false; error: string }
  | null;

export type OptimisticAction =
  | { type: "add"; subreddit: SerializedSubreddit }
  | { type: "remove"; id: string }
  | { type: "update"; id: string; changes: Partial<SerializedSubreddit> };
