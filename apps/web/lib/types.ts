import type { Config, SubredditView, RunView, DigestView, ProfileView } from "@redgest/db";

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
    nextCrawlAt: sub.nextCrawlAt?.toISOString() ?? null,
  };
}

export type SerializedConfig = Serialized<Config>;

export function serializeConfig(config: Config): SerializedConfig {
  return {
    ...config,
    updatedAt: config.updatedAt.toISOString(),
  };
}

export type SerializedRun = Serialized<RunView>;

export function serializeRun(run: RunView): SerializedRun {
  return {
    ...run,
    lastEventAt: run.lastEventAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

export type SerializedDigest = Serialized<DigestView>;

export function serializeDigest(digest: DigestView): SerializedDigest {
  return {
    ...digest,
    startedAt: digest.startedAt?.toISOString() ?? null,
    completedAt: digest.completedAt?.toISOString() ?? null,
    createdAt: digest.createdAt.toISOString(),
  };
}

export type SerializedProfile = Serialized<ProfileView>;

export function serializeProfile(profile: ProfileView): SerializedProfile {
  return {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export type ProfileOptimisticAction =
  | { type: "add"; profile: SerializedProfile }
  | { type: "remove"; id: string }
  | { type: "update"; id: string; changes: Partial<SerializedProfile> };

/** Shape of items in the subredditList JSON column on ProfileView / DigestView. */
export type SubredditListItem = { id: string; name: string };

/** Extract an array of SubredditListItem from a Prisma JsonValue field. */
export function parseSubredditList(value: unknown): SubredditListItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is SubredditListItem =>
      item !== null &&
      typeof item === "object" &&
      "id" in item &&
      "name" in item &&
      typeof (item as SubredditListItem).id === "string" &&
      typeof (item as SubredditListItem).name === "string",
  );
}

/** Format subreddit list items as "r/foo, r/bar". Returns "—" if empty. */
export function formatSubredditNames(value: unknown): string {
  const items = parseSubredditList(value);
  return items.length > 0 ? items.map((s) => `r/${s.name}`).join(", ") : "—";
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
