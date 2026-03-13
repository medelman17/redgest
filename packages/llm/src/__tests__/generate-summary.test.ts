import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  Output: {
    object: vi.fn((opts: { schema: unknown }) => ({
      type: "object",
      schema: opts.schema,
    })),
  },
}));

vi.mock("../provider.js", () => ({
  getModel: vi.fn(() => ({ provider: "mock", modelId: "mock-model" })),
}));

vi.mock("../cache.js", () => ({
  withCache: vi.fn(
    async (
      _taskType: string,
      _inputs: unknown,
      fn: () => Promise<unknown>,
    ) => ({ data: await fn(), cached: false }),
  ),
}));

import { generatePostSummary } from "../generate-summary.js";
import type {
  SummarizationPost,
  SummarizationComment,
} from "../prompts/summarization.js";

const samplePost: SummarizationPost = {
  title: "New TypeScript Feature",
  subreddit: "typescript",
  author: "tsdev",
  score: 500,
  selftext: "Check out this new feature for TypeScript 6.0...",
};

const sampleComments: SummarizationComment[] = [
  { author: "commenter1", score: 50, body: "This is great!" },
  { author: "commenter2", score: 30, body: "How does this compare to Go?" },
];

describe("generatePostSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateText with system prompt, user prompt, and output schema", async () => {
    const summaryResult = {
      summary: "A new TypeScript feature was announced.",
      keyTakeaways: ["Faster compilation"],
      insightNotes: "Relevant to TypeScript development",
      communityConsensus: "Generally positive",
      commentHighlights: [],
      sentiment: "positive" as const,
      relevanceScore: 8,
      contentType: "text" as const,
      notableLinks: [],
    };
    mockGenerateText.mockResolvedValue({ output: summaryResult });

    const result = await generatePostSummary(samplePost, sampleComments, [
      "typescript",
      "web development",
    ]);

    expect(result.data).toEqual(summaryResult);
    expect(result.log).not.toBeNull();
    expect(result.log?.task).toBe("summarize");
    expect(mockGenerateText).toHaveBeenCalledOnce();

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBeDefined();
    expect(callArgs.system).toContain("content summarizer");
    expect(callArgs.prompt).toContain("New TypeScript Feature");
    expect(callArgs.prompt).toContain("commenter1");
    expect(callArgs.output).toBeDefined();
  });

  it("handles empty comments", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        summary: "Summary",
        keyTakeaways: [],
        insightNotes: "",
        communityConsensus: null,
        commentHighlights: [],
        sentiment: "neutral",
        relevanceScore: 5,
        contentType: "text",
        notableLinks: [],
      },
    });

    await generatePostSummary(samplePost, [], ["tech"]);

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.prompt).toContain("No comments available");
  });

  it("accepts custom model override", async () => {
    mockGenerateText.mockResolvedValue({
      output: {
        summary: "s",
        keyTakeaways: [],
        insightNotes: "",
        communityConsensus: null,
        commentHighlights: [],
        sentiment: "neutral",
        relevanceScore: 1,
        contentType: "text",
        notableLinks: [],
      },
    });

    const customModel = { provider: "custom", modelId: "custom-model" };
    await generatePostSummary(
      samplePost,
      [],
      ["tech"],
      customModel as Parameters<typeof generatePostSummary>[3],
    );

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBe(customModel);
  });
});
