import { z } from "zod";
import type { DomainEventType } from "./types.js";

const deliveryChannelEnum = z.enum(["EMAIL", "SLACK"]);

/**
 * Zod schemas for each event payload — used for DB deserialization.
 * The `satisfies` ensures this map stays in sync with DomainEventMap.
 * Adding an event to the map without a schema here is a compile error.
 */
export const eventPayloadSchemas = {
  DigestRequested: z.object({
    jobId: z.string(),
    subredditIds: z.array(z.string()),
    forceRefresh: z.boolean().optional(),
  }),
  DigestCompleted: z.object({
    jobId: z.string(),
    digestId: z.string(),
  }),
  DigestFailed: z.object({
    jobId: z.string(),
    error: z.string(),
  }),
  DigestCanceled: z.object({
    jobId: z.string(),
  }),
  PostsFetched: z.object({
    jobId: z.string(),
    subreddit: z.string(),
    count: z.number(),
  }),
  PostsTriaged: z.object({
    jobId: z.string(),
    subreddit: z.string(),
    selectedCount: z.number(),
  }),
  PostsSummarized: z.object({
    jobId: z.string(),
    subreddit: z.string(),
    summaryCount: z.number(),
  }),
  SubredditAdded: z.object({
    subredditId: z.string(),
    name: z.string(),
  }),
  SubredditRemoved: z.object({
    subredditId: z.string(),
    name: z.string(),
  }),
  ConfigUpdated: z.object({
    changes: z.record(z.string(), z.unknown()),
  }),
  DeliverySucceeded: z.object({
    jobId: z.string(),
    digestId: z.string(),
    channel: deliveryChannelEnum,
    externalId: z.string().optional(),
  }),
  DeliveryFailed: z.object({
    jobId: z.string(),
    digestId: z.string(),
    channel: deliveryChannelEnum,
    error: z.string(),
  }),
} as const satisfies Record<DomainEventType, z.ZodType>;

/**
 * Parse an event payload from untrusted source (e.g., DB jsonb column).
 * Returns a discriminated result with `success: true/false`.
 */
export function parseEventPayload<K extends DomainEventType>(
  type: K,
  payload: unknown,
) {
  return eventPayloadSchemas[type].safeParse(payload);
}
