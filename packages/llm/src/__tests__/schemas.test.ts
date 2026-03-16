import { describe, it, expect } from "vitest";
import { TriageResultSchema, PostSummarySchema, DeliveryProseSchema } from "../schemas.js";

describe("TriageResultSchema", () => {
  it("validates correct triage result", () => {
    const valid = {
      selectedPosts: [
        { index: 0, relevanceScore: 8.5, rationale: "Highly relevant to AI interests" },
        { index: 3, relevanceScore: 6, rationale: "Tangentially related to TypeScript tooling" },
      ],
    };
    const result = TriageResultSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selectedPosts).toHaveLength(2);
      const first = result.data.selectedPosts[0];
      if (!first) throw new Error("Expected at least one selected post");
      expect(first.index).toBe(0);
    }
  });

  it("accepts non-integer index (Anthropic structured output cannot enforce int constraint)", () => {
    const valid = {
      selectedPosts: [{ index: 1.5, relevanceScore: 7, rationale: "Some reason" }],
    };
    const result = TriageResultSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects missing rationale", () => {
    const invalid = {
      selectedPosts: [{ index: 0, relevanceScore: 7 }],
    };
    const result = TriageResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("accepts empty selectedPosts array", () => {
    const valid = { selectedPosts: [] };
    const result = TriageResultSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selectedPosts).toHaveLength(0);
    }
  });

  it("rejects missing selectedPosts", () => {
    const invalid = {};
    const result = TriageResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("PostSummarySchema", () => {
  const validSummary = {
    summary: "This post discusses a new TypeScript compiler optimization. The author demonstrates a 40% build speed improvement.",
    keyTakeaways: [
      "TypeScript 5.8 introduces incremental type-checking at the module level",
      "Build times reduced by 40% in large monorepos",
      "No configuration changes needed for existing projects",
    ],
    insightNotes: "The module-level caching directly addresses the Turborepo build bottleneck mentioned in your workflow interests",
    communityConsensus: "Commenters broadly agree this is the most impactful TS release in years, though some note it requires Node 22+",
    commentHighlights: [
      { author: "ts_expert", insight: "This pairs well with project references for even larger gains", score: 245 },
      { author: "monorepo_dev", insight: "Tested in our 200-package monorepo, confirmed 38% improvement", score: 189 },
    ],
    sentiment: "positive" as const,
    relevanceScore: 9,
    contentType: "text" as const,
    notableLinks: ["https://github.com/microsoft/TypeScript/pull/12345"],
  };

  it("validates complete post summary", () => {
    const result = PostSummarySchema.safeParse(validSummary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary).toContain("TypeScript");
      expect(result.data.keyTakeaways).toHaveLength(3);
      expect(result.data.commentHighlights).toHaveLength(2);
      expect(result.data.sentiment).toBe("positive");
      expect(result.data.contentType).toBe("text");
    }
  });

  it("accepts null communityConsensus", () => {
    const withNull = { ...validSummary, communityConsensus: null };
    const result = PostSummarySchema.safeParse(withNull);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.communityConsensus).toBeNull();
    }
  });

  it("accepts empty arrays", () => {
    const withEmpty = {
      ...validSummary,
      keyTakeaways: [],
      insightNotes: "",
      commentHighlights: [],
      notableLinks: [],
    };
    const result = PostSummarySchema.safeParse(withEmpty);
    expect(result.success).toBe(true);
  });

  it("rejects invalid sentiment", () => {
    const invalid = { ...validSummary, sentiment: "angry" };
    const result = PostSummarySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid contentType", () => {
    const invalid = { ...validSummary, contentType: "podcast" };
    const result = PostSummarySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const invalid = { summary: "Just a summary" };
    const result = PostSummarySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects commentHighlight without author", () => {
    const invalid = {
      ...validSummary,
      commentHighlights: [{ insight: "Good point", score: 10 }],
    };
    const result = PostSummarySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("DeliveryProseSchema", () => {
  const validProse = {
    headline: "TypeScript 6.0 dominates this week's digest with massive performance improvements across the board.",
    sections: [
      {
        subreddit: "typescript",
        body: "The TypeScript 6.0 release brought 50% faster compilation and improved type inference, generating significant community excitement.",
      },
      {
        subreddit: "golang",
        body: "Go 2.0's generics deep dive revealed practical patterns for type constraints that mirror TypeScript's approach.",
      },
    ],
  };

  it("validates complete delivery prose", () => {
    const result = DeliveryProseSchema.safeParse(validProse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headline).toContain("TypeScript");
      expect(result.data.sections).toHaveLength(2);
      const first = result.data.sections[0];
      if (!first) throw new Error("Expected at least one section");
      expect(first.subreddit).toBe("typescript");
      expect(first.body).toContain("compilation");
    }
  });

  it("accepts empty sections array", () => {
    const withEmpty = { headline: "Nothing notable this period.", sections: [] };
    const result = DeliveryProseSchema.safeParse(withEmpty);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sections).toHaveLength(0);
    }
  });

  it("rejects missing headline", () => {
    const invalid = {
      sections: [
        { subreddit: "typescript", body: "Some content." },
      ],
    };
    const result = DeliveryProseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects section without subreddit", () => {
    const invalid = {
      headline: "A headline.",
      sections: [{ body: "Some content without subreddit." }],
    };
    const result = DeliveryProseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects section without body", () => {
    const invalid = {
      headline: "A headline.",
      sections: [{ subreddit: "typescript" }],
    };
    const result = DeliveryProseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
