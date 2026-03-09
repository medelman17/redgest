import { describe, it, expect, vi } from "vitest";
import type { ContentSource, PipelineResult } from "../pipeline/types.js";

describe("pipeline types", () => {
  it("ContentSource interface is implementable", async () => {
    const mockSource: ContentSource = {
      fetchContent: vi.fn().mockResolvedValue({
        subreddit: "test",
        posts: [],
        fetchedAt: new Date(),
      }),
    };

    const result = await mockSource.fetchContent("test", {
      sorts: ["hot"],
      limit: 10,
      commentsPerPost: 5,
    });

    expect(result.subreddit).toBe("test");
    expect(result.posts).toEqual([]);
  });

  it("PipelineResult has correct status literals", () => {
    const completed: PipelineResult = {
      jobId: "j1",
      status: "COMPLETED",
      digestId: "d1",
      subredditResults: [],
      errors: [],
    };
    const partial: PipelineResult = {
      jobId: "j2",
      status: "PARTIAL",
      subredditResults: [],
      errors: ["some error"],
    };
    const failed: PipelineResult = {
      jobId: "j3",
      status: "FAILED",
      subredditResults: [],
      errors: ["total failure"],
    };

    expect(completed.status).toBe("COMPLETED");
    expect(partial.status).toBe("PARTIAL");
    expect(failed.status).toBe("FAILED");
  });
});
