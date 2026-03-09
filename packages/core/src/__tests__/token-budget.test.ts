import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  truncateText,
  applyTriageBudget,
  applySummarizationBudget,
  TRIAGE_TOKEN_BUDGET,
  SUMMARIZATION_TOKEN_BUDGET,
} from "../pipeline/token-budget.js";
import type {
  TriagePostCandidate,
  SummarizationComment,
} from "@redgest/llm";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates ~286 tokens for 1000-char string", () => {
    const text = "x".repeat(1000);
    // Math.ceil(1000 / 3.5) = Math.ceil(285.714...) = 286
    expect(estimateTokens(text)).toBe(286);
  });

  it("rounds up for non-integer results", () => {
    // 7 chars => Math.ceil(7/3.5) = 2
    expect(estimateTokens("abcdefg")).toBe(2);
    // 8 chars => Math.ceil(8/3.5) = Math.ceil(2.285...) = 3
    expect(estimateTokens("abcdefgh")).toBe(3);
  });
});

describe("truncateText", () => {
  it("returns text unchanged when under budget", () => {
    const text = "short text";
    const result = truncateText(text, 1000);
    expect(result).toBe(text);
  });

  it("truncates and appends [truncated] marker when over budget", () => {
    // 10 tokens = 35 chars max
    const text = "x".repeat(100);
    const result = truncateText(text, 10);
    expect(result.length).toBeLessThanOrEqual(35);
    expect(result).toContain("[truncated]");
    expect(result.endsWith("\n\n[truncated]")).toBe(true);
  });

  it("handles empty string", () => {
    expect(truncateText("", 10)).toBe("");
  });

  it("returns text at exact boundary", () => {
    // 3.5 chars/token * 10 tokens = 35 chars
    const text = "x".repeat(35);
    expect(truncateText(text, 10)).toBe(text);
  });

  it("truncates text just over the boundary", () => {
    const text = "x".repeat(36);
    const result = truncateText(text, 10);
    expect(result).toContain("[truncated]");
    expect(result.length).toBeLessThanOrEqual(35);
  });
});

describe("applyTriageBudget", () => {
  function makeCandidate(
    overrides: Partial<TriagePostCandidate> = {},
  ): TriagePostCandidate {
    return {
      index: 0,
      subreddit: "r/test",
      title: "Test Post",
      score: 100,
      numComments: 50,
      createdUtc: Date.now() / 1000,
      selftext: "Some content",
      ...overrides,
    };
  }

  it("returns empty array for empty input", () => {
    expect(applyTriageBudget([])).toEqual([]);
  });

  it("returns candidates unchanged when within budget", () => {
    const candidates = [
      makeCandidate({ index: 0, selftext: "short" }),
      makeCandidate({ index: 1, selftext: "also short" }),
    ];
    const result = applyTriageBudget(candidates);
    expect(result[0]?.selftext).toBe("short");
    expect(result[1]?.selftext).toBe("also short");
  });

  it("truncates selftext when candidates exceed budget", () => {
    // Create candidates with very large selftext that exceeds the budget
    const largeSelftext = "x".repeat(50_000);
    const candidates = [
      makeCandidate({ index: 0, selftext: largeSelftext }),
      makeCandidate({ index: 1, selftext: largeSelftext }),
    ];
    const result = applyTriageBudget(candidates, 100);
    // With maxTokens=100, metadata=50*2=100, selftext budget=0
    // So selftext should be empty
    expect(result[0]?.selftext).toBe("");
    expect(result[1]?.selftext).toBe("");
  });

  it("distributes budget evenly across candidates", () => {
    const largeSelftext = "x".repeat(10_000);
    const candidates = [
      makeCandidate({ index: 0, selftext: largeSelftext }),
      makeCandidate({ index: 1, selftext: largeSelftext }),
    ];
    // 500 tokens total, 50*2=100 for metadata, 400 for selftext, 200 each
    const result = applyTriageBudget(candidates, 500);
    // Each gets 200 tokens = 700 chars max
    expect(result[0]?.selftext.length).toBeLessThanOrEqual(700);
    expect(result[1]?.selftext.length).toBeLessThanOrEqual(700);
  });

  it("preserves all metadata fields", () => {
    const candidate = makeCandidate({
      index: 3,
      subreddit: "r/programming",
      title: "My Title",
      score: 42,
      numComments: 17,
      createdUtc: 1700000000,
      selftext: "x".repeat(100_000),
    });
    const result = applyTriageBudget([candidate], 200);
    const first = result[0];
    expect(first).toBeDefined();
    expect(first?.index).toBe(3);
    expect(first?.subreddit).toBe("r/programming");
    expect(first?.title).toBe("My Title");
    expect(first?.score).toBe(42);
    expect(first?.numComments).toBe(17);
    expect(first?.createdUtc).toBe(1700000000);
  });

  it("clears selftext when metadata alone exceeds budget", () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate({ index: i, selftext: "some text" }),
    );
    // 10 candidates * 50 tokens metadata = 500 tokens needed for metadata alone
    // Budget of 100 means no room for selftext
    const result = applyTriageBudget(candidates, 100);
    for (const c of result) {
      expect(c.selftext).toBe("");
    }
  });
});

describe("applySummarizationBudget", () => {
  function makeComment(
    score: number,
    bodyLength: number = 100,
  ): SummarizationComment {
    return {
      author: "user",
      score,
      body: "x".repeat(bodyLength),
    };
  }

  it("returns unchanged when within budget", () => {
    const selftext = "short post";
    const comments = [makeComment(10, 20), makeComment(5, 20)];
    const result = applySummarizationBudget(selftext, comments);
    expect(result.selftext).toBe(selftext);
    expect(result.comments).toHaveLength(2);
  });

  it("removes lowest-score comments first", () => {
    // Create a scenario that's over budget
    const selftext = "short post";
    const comments = [
      makeComment(100, 500), // high score - should be kept
      makeComment(1, 500), // low score - removed first
      makeComment(50, 500), // medium score - removed second if needed
    ];
    // Each comment: ~500/3.5 + "user"/3.5 + 10 ~= 144 + 2 + 10 = 156 tokens
    // Post: ~10/3.5 ~= 3 tokens
    // Total: ~3 + 3*156 = 471 tokens
    // With a tight budget, lowest-score comment should be removed first
    const result = applySummarizationBudget(selftext, comments, 320);
    // The low-score comment (score=1) should be removed first
    const keptScores = result.comments.map((c) => c.score);
    expect(keptScores).not.toContain(1);
    expect(keptScores).toContain(100);
  });

  it("preserves high-score comments over low-score ones", () => {
    const selftext = "post";
    const comments = [
      makeComment(200, 300),
      makeComment(5, 300),
      makeComment(150, 300),
      makeComment(3, 300),
      makeComment(100, 300),
    ];
    // Very tight budget -- should remove lowest scores first
    const result = applySummarizationBudget(selftext, comments, 300);
    const keptScores = result.comments.map((c) => c.score);
    // If any comments are kept, they should be high-score ones
    for (const score of keptScores) {
      expect(score).toBeGreaterThanOrEqual(100);
    }
  });

  it("truncates post body only after removing all comments still isn't enough", () => {
    const selftext = "x".repeat(50_000);
    const comments = [makeComment(10, 100)];
    // Very tight budget: should remove comments AND truncate selftext
    const result = applySummarizationBudget(selftext, comments, 100);
    expect(result.comments).toHaveLength(0);
    expect(result.selftext.length).toBeLessThan(selftext.length);
    expect(result.selftext).toContain("[truncated]");
  });

  it("handles empty comments array", () => {
    const selftext = "just a post with no comments";
    const result = applySummarizationBudget(selftext, []);
    expect(result.selftext).toBe(selftext);
    expect(result.comments).toHaveLength(0);
  });

  it("handles empty comments array with oversized post", () => {
    const selftext = "x".repeat(100_000);
    const result = applySummarizationBudget(selftext, [], 100);
    expect(result.selftext.length).toBeLessThan(selftext.length);
    expect(result.selftext).toContain("[truncated]");
    expect(result.comments).toHaveLength(0);
  });
});

describe("budget constants", () => {
  it("exports TRIAGE_TOKEN_BUDGET as 8000", () => {
    expect(TRIAGE_TOKEN_BUDGET).toBe(8_000);
  });

  it("exports SUMMARIZATION_TOKEN_BUDGET as 9700", () => {
    expect(SUMMARIZATION_TOKEN_BUDGET).toBe(9_700);
  });
});
