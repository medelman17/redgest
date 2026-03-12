import { describe, it, expect } from "vitest";
import { parseEventPayload, eventPayloadSchemas } from "../events/schemas.js";
import type { DomainEventType } from "../events/types.js";

describe("eventPayloadSchemas", () => {
  it("has a schema for every DomainEventType", () => {
    const expectedTypes: DomainEventType[] = [
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
    ];
    for (const type of expectedTypes) {
      expect(eventPayloadSchemas[type]).toBeDefined();
    }
  });

  it("validates DigestRequested payload", () => {
    const result = parseEventPayload("DigestRequested", {
      jobId: "job-1",
      subredditIds: ["sub-1", "sub-2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid DigestRequested payload", () => {
    const result = parseEventPayload("DigestRequested", {
      jobId: 123, // should be string
    });
    expect(result.success).toBe(false);
  });

  it("validates DigestCompleted payload", () => {
    const result = parseEventPayload("DigestCompleted", {
      jobId: "job-1",
      digestId: "digest-1",
    });
    expect(result.success).toBe(true);
  });

  it("validates DigestFailed payload", () => {
    const result = parseEventPayload("DigestFailed", {
      jobId: "job-1",
      error: "something went wrong",
    });
    expect(result.success).toBe(true);
  });

  it("validates PostsFetched payload", () => {
    const result = parseEventPayload("PostsFetched", {
      jobId: "job-1",
      subreddit: "typescript",
      count: 25,
    });
    expect(result.success).toBe(true);
  });

  it("validates PostsTriaged payload", () => {
    const result = parseEventPayload("PostsTriaged", {
      jobId: "job-1",
      subreddit: "typescript",
      selectedCount: 5,
    });
    expect(result.success).toBe(true);
  });

  it("validates PostsSummarized payload", () => {
    const result = parseEventPayload("PostsSummarized", {
      jobId: "job-1",
      subreddit: "typescript",
      summaryCount: 5,
    });
    expect(result.success).toBe(true);
  });

  it("validates SubredditAdded payload", () => {
    const result = parseEventPayload("SubredditAdded", {
      subredditId: "sub-1",
      name: "typescript",
    });
    expect(result.success).toBe(true);
  });

  it("validates SubredditRemoved payload", () => {
    const result = parseEventPayload("SubredditRemoved", {
      subredditId: "sub-1",
      name: "typescript",
    });
    expect(result.success).toBe(true);
  });

  it("validates ConfigUpdated payload", () => {
    const result = parseEventPayload("ConfigUpdated", {
      changes: { llmModel: "gpt-4.1" },
    });
    expect(result.success).toBe(true);
  });

  it("validates DigestCanceled payload", () => {
    const result = parseEventPayload("DigestCanceled", { jobId: "job-123" });
    expect(result.success).toBe(true);
  });

  it("rejects DigestCanceled with missing jobId", () => {
    const result = parseEventPayload("DigestCanceled", {});
    expect(result.success).toBe(false);
  });

  it("rejects SubredditAdded with missing name", () => {
    const result = parseEventPayload("SubredditAdded", {
      subredditId: "sub-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects PostsFetched with non-numeric count", () => {
    const result = parseEventPayload("PostsFetched", {
      jobId: "job-1",
      subreddit: "typescript",
      count: "not-a-number",
    });
    expect(result.success).toBe(false);
  });

  it("validates DeliverySucceeded payload", () => {
    const result = parseEventPayload("DeliverySucceeded", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
    });
    expect(result.success).toBe(true);
  });

  it("validates DeliverySucceeded with optional externalId", () => {
    const result = parseEventPayload("DeliverySucceeded", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "SLACK",
      externalId: "msg-abc123",
    });
    expect(result.success).toBe(true);
  });

  it("validates DeliverySucceeded without externalId", () => {
    const result = parseEventPayload("DeliverySucceeded", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        jobId: "job-1",
        digestId: "digest-1",
        channel: "EMAIL",
      });
    }
  });

  it("rejects DeliverySucceeded with invalid channel", () => {
    const result = parseEventPayload("DeliverySucceeded", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "TELEGRAM",
    });
    expect(result.success).toBe(false);
  });

  it("rejects DeliverySucceeded with missing digestId", () => {
    const result = parseEventPayload("DeliverySucceeded", {
      jobId: "job-1",
      channel: "EMAIL",
    });
    expect(result.success).toBe(false);
  });

  it("validates DeliveryFailed payload", () => {
    const result = parseEventPayload("DeliveryFailed", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "SLACK",
      error: "Webhook returned 500",
    });
    expect(result.success).toBe(true);
  });

  it("rejects DeliveryFailed with missing error", () => {
    const result = parseEventPayload("DeliveryFailed", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
    });
    expect(result.success).toBe(false);
  });

  it("rejects DeliveryFailed with invalid channel", () => {
    const result = parseEventPayload("DeliveryFailed", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "PUSH",
      error: "not supported",
    });
    expect(result.success).toBe(false);
  });

  it("rejects DeliveryFailed with non-string error", () => {
    const result = parseEventPayload("DeliveryFailed", {
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
      error: 500,
    });
    expect(result.success).toBe(false);
  });
});
