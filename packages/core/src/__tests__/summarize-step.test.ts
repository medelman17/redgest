import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@redgest/db";
import type { SummarizationPost, SummarizationComment } from "@redgest/llm";
import type { PostSummary } from "../pipeline/types.js";

vi.mock("@redgest/llm", () => ({
  generatePostSummary: vi.fn(),
}));

import { generatePostSummary } from "@redgest/llm";
import { summarizeStep } from "../pipeline/summarize-step.js";

const mockGeneratePostSummary = vi.mocked(generatePostSummary);

function makeSummary(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    summary: "This is a summary of the post.",
    keyTakeaways: ["Takeaway 1", "Takeaway 2"],
    insightNotes: "Relevant to AI engineering trends.",
    communityConsensus: "Generally positive",
    commentHighlights: [
      { author: "expert_user", insight: "Great analysis", score: 42 },
    ],
    sentiment: "positive",
    relevanceScore: 0.85,
    contentType: "text",
    notableLinks: ["https://example.com/paper"],
    ...overrides,
  };
}

function makePost(overrides: Partial<SummarizationPost> = {}): SummarizationPost {
  return {
    title: "Test Post Title",
    subreddit: "r/test",
    author: "test_author",
    score: 100,
    selftext: "This is the post body content.",
    ...overrides,
  };
}

function makeComment(
  score: number,
  body: string = "A comment",
): SummarizationComment {
  return { author: "commenter", score, body };
}

function makeMockDb() {
  return {
    postSummary: {
      create: vi.fn().mockResolvedValue({ id: "summary-id-1" }),
    },
  } as unknown as PrismaClient;
}

describe("summarizeStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies comments-first truncation via applySummarizationBudget", async () => {
    const summary = makeSummary();
    mockGeneratePostSummary.mockResolvedValue(summary);
    const db = makeMockDb();

    // Create a post with very long selftext and comments
    const post = makePost({ selftext: "x".repeat(50_000) });
    const comments = [
      makeComment(10, "x".repeat(10_000)),
      makeComment(5, "x".repeat(10_000)),
      makeComment(1, "x".repeat(10_000)),
    ];

    await summarizeStep(
      post,
      comments,
      ["insight1"],
      "job-1",
      "post-1",
      db,
    );

    // generatePostSummary should have been called with truncated content
    expect(mockGeneratePostSummary).toHaveBeenCalledOnce();
    const callArgs = mockGeneratePostSummary.mock.calls[0];
    expect(callArgs).toBeDefined();
    const [calledPost, calledComments] = callArgs ?? [];

    // The post selftext or comments should be truncated (total was way over budget)
    const totalOriginalLength =
      post.selftext.length +
      comments.reduce((sum, c) => sum + c.body.length, 0);
    const totalCalledLength =
      (calledPost as SummarizationPost).selftext.length +
      (calledComments as SummarizationComment[]).reduce(
        (sum: number, c: SummarizationComment) => sum + c.body.length,
        0,
      );
    expect(totalCalledLength).toBeLessThan(totalOriginalLength);
  });

  it("calls generatePostSummary with truncated post and budgeted comments", async () => {
    const summary = makeSummary();
    mockGeneratePostSummary.mockResolvedValue(summary);
    const db = makeMockDb();

    const post = makePost({ selftext: "Short selftext" });
    const comments = [makeComment(10, "Short comment")];
    const insightPrompts = ["What are the key trends?"];

    await summarizeStep(
      post,
      comments,
      insightPrompts,
      "job-1",
      "post-1",
      db,
    );

    expect(mockGeneratePostSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Test Post Title",
        subreddit: "r/test",
        author: "test_author",
        score: 100,
        selftext: "Short selftext", // unchanged because within budget
      }),
      expect.arrayContaining([
        expect.objectContaining({ author: "commenter", score: 10 }),
      ]),
      insightPrompts,
      undefined, // no model passed
    );
  });

  it("saves PostSummary to database with correct field mapping", async () => {
    const summary = makeSummary();
    mockGeneratePostSummary.mockResolvedValue(summary);
    const db = makeMockDb();

    await summarizeStep(
      makePost(),
      [makeComment(5)],
      ["insight"],
      "job-42",
      "post-99",
      db,
    );

    expect(db.postSummary.create).toHaveBeenCalledWith({
      data: {
        postId: "post-99",
        jobId: "job-42",
        summary: summary.summary,
        keyTakeaways: summary.keyTakeaways,
        insightNotes: summary.insightNotes,
        commentHighlights: summary.commentHighlights,
        selectionRationale: "",
        llmProvider: "anthropic",
        llmModel: "claude-sonnet-4-20250514",
      },
    });
  });

  it("returns the DB record ID and the summary object", async () => {
    const summary = makeSummary();
    mockGeneratePostSummary.mockResolvedValue(summary);
    const db = makeMockDb();
    vi.mocked(db.postSummary.create).mockResolvedValue({
      id: "db-record-xyz",
    } as any);

    const result = await summarizeStep(
      makePost(),
      [],
      ["insight"],
      "job-1",
      "post-1",
      db,
    );

    expect(result.postSummaryId).toBe("db-record-xyz");
    expect(result.summary).toBe(summary);
  });

  it("passes model parameter through to generatePostSummary", async () => {
    const summary = makeSummary();
    mockGeneratePostSummary.mockResolvedValue(summary);
    const db = makeMockDb();

    const mockModel = {
      specificationVersion: "v3" as const,
      provider: "openai",
      modelId: "gpt-4.1",
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(),
    };

    await summarizeStep(
      makePost(),
      [makeComment(10)],
      ["insight"],
      "job-1",
      "post-1",
      db,
      mockModel,
    );

    expect(mockGeneratePostSummary).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      ["insight"],
      mockModel,
    );
  });

  it("records provider and model from model parameter when provided", async () => {
    const summary = makeSummary();
    mockGeneratePostSummary.mockResolvedValue(summary);
    const db = makeMockDb();

    const mockModel = {
      specificationVersion: "v3" as const,
      provider: "openai",
      modelId: "gpt-4.1",
      supportedUrls: {},
      doGenerate: vi.fn(),
      doStream: vi.fn(),
    };

    await summarizeStep(
      makePost(),
      [],
      ["insight"],
      "job-1",
      "post-1",
      db,
      mockModel,
    );

    expect(db.postSummary.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        llmProvider: "openai",
        llmModel: "gpt-4.1",
      }),
    });
  });

  it("preserves all post metadata except selftext through truncation", async () => {
    const summary = makeSummary();
    mockGeneratePostSummary.mockResolvedValue(summary);
    const db = makeMockDb();

    const post = makePost({
      title: "Specific Title",
      subreddit: "r/programming",
      author: "specific_author",
      score: 999,
      selftext: "x".repeat(100_000),
    });

    await summarizeStep(post, [], ["insight"], "job-1", "post-1", db);

    const callArgs2 = mockGeneratePostSummary.mock.calls[0];
    expect(callArgs2).toBeDefined();
    const [calledPost] = callArgs2 ?? [];
    const p = calledPost as SummarizationPost;
    expect(p.title).toBe("Specific Title");
    expect(p.subreddit).toBe("r/programming");
    expect(p.author).toBe("specific_author");
    expect(p.score).toBe(999);
    // Selftext should be truncated
    expect(p.selftext.length).toBeLessThan(100_000);
  });
});
