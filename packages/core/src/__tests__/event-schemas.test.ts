import { describe, it, expect } from "vitest";
import { parseEventPayload, eventPayloadSchemas } from "../events/schemas.js";
import type { DomainEventType } from "../events/types.js";

describe("eventPayloadSchemas", () => {
  it("has a schema for every DomainEventType", () => {
    const expectedTypes: DomainEventType[] = [
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
});
