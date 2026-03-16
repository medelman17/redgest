import { describe, it, expect, vi } from "vitest";
import type { DomainEvent, DomainEventType } from "../events/types";
import { InProcessEventBus } from "../events/transports/in-process";

describe("DomainEvent types", () => {
  it("derives correct type for DigestRequested", () => {
    const event: DomainEvent = {
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: ["sub-1"] },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };
    expect(event.type).toBe("DigestRequested");
    expect(event.payload.jobId).toBe("job-1");
  });

  it("narrows payload via type discriminant", () => {
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

    if (event.type === "SubredditAdded") {
      expect(event.payload.name).toBe("typescript");
    }
  });

  it("DomainEventType includes all 16 event types", () => {
    const types: DomainEventType[] = [
      "DigestRequested",
      "DigestCompleted",
      "DigestFailed",
      "DigestCanceled",
      "PostsFetched",
      "PostsTriaged",
      "PostsSummarized",
      "SubredditAdded",
      "SubredditRemoved",
      "ConfigUpdated",
      "DeliverySucceeded",
      "DeliveryFailed",
      "ProfileCreated",
      "ProfileDeleted",
      "CrawlCompleted",
      "CrawlFailed",
    ];
    expect(types).toHaveLength(16);
  });
});

describe("InProcessEventBus", () => {
  it("publish delivers to subscriber", async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();

    bus.subscribe("DigestRequested", handler);

    const event: DomainEvent & { type: "DigestRequested" } = {
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: ["sub-1"] },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    await bus.publish(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not fire handler for different event type", async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();

    bus.subscribe("DigestCompleted", handler);

    const event: DomainEvent & { type: "DigestRequested" } = {
      type: "DigestRequested",
      payload: { jobId: "job-1", subredditIds: [] },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };

    await bus.publish(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it("removes handler with unsubscribe()", async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();

    bus.subscribe("ConfigUpdated", handler);
    bus.unsubscribe("ConfigUpdated", handler);

    await bus.publish({
      type: "ConfigUpdated",
      payload: { changes: { llmModel: "gpt-4.1" } },
      aggregateId: "config-1",
      aggregateType: "config",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("multiple subscribers all receive the event", async () => {
    const bus = new InProcessEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe("SubredditAdded", handler1);
    bus.subscribe("SubredditAdded", handler2);

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

    await bus.publish(event);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("close() removes all registered handlers", async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();

    bus.subscribe("DigestCompleted", handler);
    await bus.close();

    await bus.publish({
      type: "DigestCompleted",
      payload: { jobId: "job-1", digestId: "dig-1" },
      aggregateId: "job-1",
      aggregateType: "job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("publish with no subscribers does not throw", async () => {
    const bus = new InProcessEventBus();

    await expect(
      bus.publish({
        type: "DigestFailed",
        payload: { jobId: "job-1", error: "boom" },
        aggregateId: "job-1",
        aggregateType: "job",
        version: 1,
        correlationId: null,
        causationId: null,
        metadata: {},
        occurredAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});
