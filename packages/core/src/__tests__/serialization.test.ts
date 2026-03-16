import { describe, it, expect } from "vitest";
import { serializeEvent, deserializeEvent } from "../events/serialization";
import type { DomainEvent } from "../events/types";

describe("serializeEvent / deserializeEvent", () => {
  it("roundtrips a DomainEvent with Date preservation", () => {
    const now = new Date("2026-03-16T12:00:00.000Z");
    const event: DomainEvent = {
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: ["sub-1"] },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: now,
    };

    const json = serializeEvent(event);
    const parsed = deserializeEvent(json);

    expect(parsed).toEqual(event);
    expect(parsed.occurredAt).toBeInstanceOf(Date);
    expect(parsed.occurredAt.toISOString()).toBe("2026-03-16T12:00:00.000Z");
  });

  it("serializes to valid JSON string", () => {
    const event: DomainEvent = {
      type: "SubredditAdded",
      payload: { subredditId: "sub-1", name: "typescript" },
      aggregateId: "sub-1",
      aggregateType: "subreddit",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    const json = serializeEvent(event);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('"type":"SubredditAdded"');
  });

  it("does not coerce non-ISO strings named occurredAt", () => {
    const json = JSON.stringify({
      type: "ConfigUpdated",
      payload: { changes: { occurredAt: "not-a-date" } },
      aggregateId: "config-1",
      aggregateType: "config",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: "2026-03-16T12:00:00.000Z",
    });

    const parsed = deserializeEvent(json);
    expect(parsed.occurredAt).toBeInstanceOf(Date);
    const payload = parsed.payload as { changes: Record<string, unknown> };
    expect(payload.changes.occurredAt).toBe("not-a-date");
  });

  it("handles events with all payload types", () => {
    const event: DomainEvent = {
      type: "CrawlCompleted",
      payload: {
        subredditId: "sub-1",
        subreddit: "typescript",
        postCount: 42,
        newPostCount: 10,
        updatedPostCount: 32,
      },
      aggregateId: "sub-1",
      aggregateType: "subreddit",
      version: 1,
      organizationId: "org-1",
      correlationId: "corr-1",
      causationId: "cause-1",
      metadata: { source: "crawl" },
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const roundtripped = deserializeEvent(serializeEvent(event));
    expect(roundtripped).toEqual(event);
  });
});
