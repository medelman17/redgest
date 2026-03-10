import type { SubredditView } from "@redgest/db";

/**
 * SubredditView with Date fields converted to ISO strings
 * for crossing the RSC → client component boundary.
 */
export type SerializedSubreddit = {
  [K in keyof SubredditView]: SubredditView[K] extends Date
    ? string
    : SubredditView[K] extends Date | null
      ? string | null
      : SubredditView[K];
};

export function serializeSubreddit(sub: SubredditView): SerializedSubreddit {
  return {
    ...sub,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    lastDigestDate: sub.lastDigestDate?.toISOString() ?? null,
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
