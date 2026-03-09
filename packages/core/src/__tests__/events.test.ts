import { describe, it, expect, vi } from "vitest";
import type {
  DomainEvent,
  DomainEventType,
} from "../events/types.js";
import { DomainEventBus } from "../events/bus.js";

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
      // TypeScript narrows payload to { subredditId: string; name: string }
      expect(event.payload.name).toBe("typescript");
    }
  });

  it("DomainEventType includes all 9 event types", () => {
    const types: DomainEventType[] = [
      "DigestRequested",
      "DigestCompleted",
      "DigestFailed",
      "PostsFetched",
      "PostsTriaged",
      "PostsSummarized",
      "SubredditAdded",
      "SubredditRemoved",
      "ConfigUpdated",
    ];
    expect(types).toHaveLength(9);
  });
});

describe("DomainEventBus", () => {
  it("emits and receives typed events", () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();

    bus.on("DigestRequested", handler);

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

    bus.emit("DigestRequested", event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not fire handler for different event type", () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();

    bus.on("DigestCompleted", handler);

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

    bus.emit("DigestRequested", event);

    expect(handler).not.toHaveBeenCalled();
  });

  it("removes handler with off()", () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();

    bus.on("ConfigUpdated", handler);
    bus.off("ConfigUpdated", handler);

    bus.emit("ConfigUpdated", {
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

  it("emitEvent() dispatches without generic constraint", () => {
    const bus = new DomainEventBus();
    const handler = vi.fn();

    bus.on("SubredditAdded", handler);

    // emitEvent accepts DomainEvent union — useful when type isn't known statically
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

    bus.emitEvent(event);

    expect(handler).toHaveBeenCalledOnce();
  });
});
