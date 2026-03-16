import { describe, it, expect } from "vitest";
import { extractTopicNames, STOP_WORDS } from "../pipeline/topic-step";
import type { PostSummary } from "../pipeline/types";

function makeSummary(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    summary: "",
    keyTakeaways: [],
    insightNotes: "",
    communityConsensus: null,
    commentHighlights: [],
    sentiment: "neutral",
    relevanceScore: 0.5,
    contentType: "text",
    notableLinks: [],
    ...overrides,
  };
}

describe("STOP_WORDS", () => {
  it("contains common English stopwords reported in issue #39", () => {
    for (const word of ["the", "and", "for", "are", "was", "not", "but"]) {
      expect(STOP_WORDS.has(word), `missing stopword: "${word}"`).toBe(true);
    }
  });

  it("contains at least 100 entries", () => {
    expect(STOP_WORDS.size).toBeGreaterThanOrEqual(100);
  });

  it("does not contain meaningful technical terms", () => {
    for (const word of ["model", "local", "coding", "inference", "quantization"]) {
      expect(STOP_WORDS.has(word), `should not block: "${word}"`).toBe(false);
    }
  });
});

describe("extractTopicNames", () => {
  it("filters out stopwords from results", () => {
    const summary = makeSummary({
      summary:
        "The model uses local inference for quantization and the approach was very effective",
      keyTakeaways: ["The local model runs fast"],
      insightNotes: "For the community this was a breakthrough",
    });

    const topics = extractTopicNames(summary);

    // Should NOT include stopwords
    for (const stopword of ["the", "and", "for", "was", "very", "this"]) {
      expect(topics).not.toContain(stopword);
    }

    // Should include meaningful terms
    expect(topics).toContain("model");
    expect(topics).toContain("local");
  });

  it("returns up to 5 topics", () => {
    const summary = makeSummary({
      summary:
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima",
    });

    const topics = extractTopicNames(summary);
    expect(topics.length).toBeLessThanOrEqual(5);
  });

  it("ranks by frequency descending", () => {
    const summary = makeSummary({
      summary: "inference inference inference model model quantization",
      keyTakeaways: ["inference model"],
      insightNotes: "inference",
    });

    const topics = extractTopicNames(summary);
    expect(topics[0]).toBe("inference");
    expect(topics[1]).toBe("model");
  });

  it("returns empty array when only stopwords are present", () => {
    const summary = makeSummary({
      summary: "the and for are was not but has had can",
      keyTakeaways: ["they were being very much"],
      insightNotes: "this that with from have been",
    });

    const topics = extractTopicNames(summary);
    expect(topics).toEqual([]);
  });

  it("filters words with 2 or fewer characters", () => {
    const summary = makeSummary({
      summary: "AI is ok to do it on an up",
    });

    const topics = extractTopicNames(summary);
    for (const topic of topics) {
      expect(topic.length).toBeGreaterThan(2);
    }
  });

  it("lowercases all topics", () => {
    const summary = makeSummary({
      summary: "Python RUST TypeScript",
    });

    const topics = extractTopicNames(summary);
    for (const topic of topics) {
      expect(topic).toBe(topic.toLowerCase());
    }
  });

  it("strips punctuation before matching", () => {
    const summary = makeSummary({
      summary: "model, model! model? inference... quantization;",
    });

    const topics = extractTopicNames(summary);
    expect(topics[0]).toBe("model");
    expect(topics).toContain("inference");
    expect(topics).toContain("quantization");
  });
});
