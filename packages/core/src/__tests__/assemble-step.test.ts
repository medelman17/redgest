import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@redgest/db";
import { assembleStep, renderDigestMarkdown } from "../pipeline/assemble-step";
import type { SubredditPipelineResult, PostSummary } from "../pipeline/types";

function makeSummary(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    summary: "A great post about testing.",
    keyTakeaways: ["Tests are important", "Vitest is fast"],
    insightNotes: "Relevant to TDD practices",
    communityConsensus: "Strongly agree on testing value",
    commentHighlights: [
      { author: "tester1", insight: "Great breakdown", score: 42 },
    ],
    sentiment: "positive",
    relevanceScore: 8,
    contentType: "text",
    notableLinks: ["https://example.com/article"],
    ...overrides,
  };
}

function makeSubredditResult(
  overrides: Partial<SubredditPipelineResult> = {},
): SubredditPipelineResult {
  return {
    subreddit: "typescript",
    posts: [
      {
        postId: "post-1",
        redditId: "abc123",
        title: "TypeScript 6.0 Released",
        summary: makeSummary(),
        selectionRationale: "Highly relevant to user interests",
      },
    ],
    ...overrides,
  };
}

describe("renderDigestMarkdown", () => {
  it("produces correct markdown structure with date header", () => {
    const results = [makeSubredditResult()];
    const md = renderDigestMarkdown(results, "2026-03-09");

    expect(md).toContain("# Reddit Digest — 2026-03-09");
  });

  it("defaults to today's date when none provided", () => {
    const results = [makeSubredditResult()];
    const md = renderDigestMarkdown(results);

    const today = new Date().toISOString().split("T")[0];
    expect(md).toContain(`# Reddit Digest — ${today}`);
  });

  it("creates subreddit sections with ## r/{name} headers", () => {
    const results = [
      makeSubredditResult({ subreddit: "typescript" }),
      makeSubredditResult({ subreddit: "rust" }),
    ];
    const md = renderDigestMarkdown(results);

    expect(md).toContain("## r/typescript");
    expect(md).toContain("## r/rust");
  });

  it("creates post sections with title, sentiment, and summary", () => {
    const results = [makeSubredditResult()];
    const md = renderDigestMarkdown(results);

    expect(md).toContain("### TypeScript 6.0 Released");
    expect(md).toContain("**Sentiment:** positive | **Relevance:** 8/10");
    expect(md).toContain("A great post about testing.");
  });

  it("includes key takeaways, insight notes, and community highlights", () => {
    const results = [makeSubredditResult()];
    const md = renderDigestMarkdown(results);

    expect(md).toContain("**Key Takeaways:**");
    expect(md).toContain("- Tests are important");
    expect(md).toContain("- Vitest is fast");
    expect(md).toContain("**Interest Notes:** Relevant to TDD practices");
    expect(md).toContain(
      "**Community Consensus:** Strongly agree on testing value",
    );
    expect(md).toContain("**Community Highlights:**");
    expect(md).toContain("> Great breakdown — u/tester1 (42)");
  });

  it("skips subreddits with zero posts", () => {
    const results = [
      makeSubredditResult({ subreddit: "empty", posts: [] }),
      makeSubredditResult({ subreddit: "notempty" }),
    ];
    const md = renderDigestMarkdown(results);

    expect(md).not.toContain("## r/empty");
    expect(md).toContain("## r/notempty");
  });

  it("skips notable links section when empty", () => {
    const results = [
      makeSubredditResult({
        posts: [
          {
            postId: "post-1",
            redditId: "abc123",
            title: "No Links Post",
            summary: makeSummary({ notableLinks: [] }),
            selectionRationale: "relevant",
          },
        ],
      }),
    ];
    const md = renderDigestMarkdown(results);

    expect(md).not.toContain("**Notable Links:**");
  });

  it("includes notable links when present", () => {
    const results = [makeSubredditResult()];
    const md = renderDigestMarkdown(results);

    expect(md).toContain("**Notable Links:**");
    expect(md).toContain("- https://example.com/article");
  });

  it("skips key takeaways section when empty", () => {
    const results = [
      makeSubredditResult({
        posts: [
          {
            postId: "post-1",
            redditId: "abc123",
            title: "Minimal Post",
            summary: makeSummary({
              keyTakeaways: [],
              insightNotes: "",
              communityConsensus: null,
              commentHighlights: [],
              notableLinks: [],
            }),
            selectionRationale: "relevant",
          },
        ],
      }),
    ];
    const md = renderDigestMarkdown(results);

    expect(md).not.toContain("**Key Takeaways:**");
    expect(md).not.toContain("**Interest Notes:**");
    expect(md).not.toContain("**Community Consensus:**");
    expect(md).not.toContain("**Community Highlights:**");
    expect(md).not.toContain("**Notable Links:**");
  });
});

describe("assembleStep", () => {
  let mockDb: {
    digest: { create: ReturnType<typeof vi.fn> };
    digestPost: { createMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      digest: { create: vi.fn().mockResolvedValue({ id: "digest-1" }) },
      digestPost: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
  });

  it("creates Digest record with markdown and null HTML", async () => {
    const results = [makeSubredditResult()];
    await assembleStep("job-1", results, mockDb as unknown as PrismaClient);

    expect(mockDb.digest.create).toHaveBeenCalledWith({
      data: {
        jobId: "job-1",
        contentMarkdown: expect.any(String),
        contentHtml: null,
      },
    });
  });

  it("creates DigestPost records with correct rank ordering", async () => {
    const results = [
      makeSubredditResult({
        subreddit: "typescript",
        posts: [
          {
            postId: "post-1",
            redditId: "r1",
            title: "Post 1",
            summary: makeSummary(),
            selectionRationale: "good",
          },
          {
            postId: "post-2",
            redditId: "r2",
            title: "Post 2",
            summary: makeSummary(),
            selectionRationale: "also good",
          },
        ],
      }),
    ];

    await assembleStep("job-1", results, mockDb as unknown as PrismaClient);

    expect(mockDb.digestPost.createMany).toHaveBeenCalledWith({
      data: [
        { digestId: "digest-1", postId: "post-1", subreddit: "typescript", rank: 1 },
        { digestId: "digest-1", postId: "post-2", subreddit: "typescript", rank: 2 },
      ],
    });
  });

  it("returns correct digestId and postCount", async () => {
    const results = [
      makeSubredditResult({
        posts: [
          {
            postId: "post-1",
            redditId: "r1",
            title: "Post 1",
            summary: makeSummary(),
            selectionRationale: "good",
          },
        ],
      }),
    ];

    const result = await assembleStep("job-1", results, mockDb as unknown as PrismaClient);

    expect(result.digestId).toBe("digest-1");
    expect(result.postCount).toBe(1);
    expect(result.contentMarkdown).toContain("# Reddit Digest");
  });

  it("handles multiple subreddits with global rank ordering", async () => {
    const results = [
      makeSubredditResult({
        subreddit: "typescript",
        posts: [
          {
            postId: "p1",
            redditId: "r1",
            title: "TS Post",
            summary: makeSummary(),
            selectionRationale: "relevant",
          },
        ],
      }),
      makeSubredditResult({
        subreddit: "rust",
        posts: [
          {
            postId: "p2",
            redditId: "r2",
            title: "Rust Post 1",
            summary: makeSummary(),
            selectionRationale: "relevant",
          },
          {
            postId: "p3",
            redditId: "r3",
            title: "Rust Post 2",
            summary: makeSummary(),
            selectionRationale: "also relevant",
          },
        ],
      }),
    ];

    const result = await assembleStep("job-1", results, mockDb as unknown as PrismaClient);

    expect(result.postCount).toBe(3);
    expect(mockDb.digestPost.createMany).toHaveBeenCalledWith({
      data: [
        { digestId: "digest-1", postId: "p1", subreddit: "typescript", rank: 1 },
        { digestId: "digest-1", postId: "p2", subreddit: "rust", rank: 2 },
        { digestId: "digest-1", postId: "p3", subreddit: "rust", rank: 3 },
      ],
    });
  });

  it("handles empty subreddit results", async () => {
    const result = await assembleStep("job-1", [], mockDb as unknown as PrismaClient);

    expect(result.postCount).toBe(0);
    expect(result.digestId).toBe("digest-1");
    expect(mockDb.digestPost.createMany).not.toHaveBeenCalled();
  });
});
