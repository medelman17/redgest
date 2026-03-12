/**
 * DomainEventMap — single source of truth for all domain events.
 * Adding a new event here automatically updates the DomainEvent union,
 * the DomainEventBus type signatures, and the Zod schema requirements.
 */
export interface DomainEventMap {
  DigestRequested: { jobId: string; subredditIds: string[] };
  DigestCompleted: { jobId: string; digestId: string };
  DigestFailed: { jobId: string; error: string };
  DigestCanceled: { jobId: string };
  PostsFetched: { jobId: string; subreddit: string; count: number };
  PostsTriaged: { jobId: string; subreddit: string; selectedCount: number };
  PostsSummarized: { jobId: string; subreddit: string; summaryCount: number };
  SubredditAdded: { subredditId: string; name: string };
  SubredditRemoved: { subredditId: string; name: string };
  ConfigUpdated: { changes: Record<string, unknown> };
  DeliverySucceeded: {
    jobId: string;
    digestId: string;
    channel: "EMAIL" | "SLACK";
    externalId?: string;
  };
  DeliveryFailed: {
    jobId: string;
    digestId: string;
    channel: "EMAIL" | "SLACK";
    error: string;
  };
}

export type DomainEventType = keyof DomainEventMap;

/**
 * Discriminated union of all domain events — derived from DomainEventMap.
 * Includes the event envelope fields (aggregateId, correlation, etc.).
 * Narrows payload via `event.type` discriminant.
 */
export type DomainEvent = {
  [K in DomainEventType]: {
    type: K;
    payload: DomainEventMap[K];
    aggregateId: string;
    aggregateType: string;
    version: number;
    correlationId: string | null;
    causationId: string | null;
    metadata: Record<string, unknown>;
    occurredAt: Date;
  };
}[DomainEventType];
