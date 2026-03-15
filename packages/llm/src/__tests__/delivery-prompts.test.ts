import { describe, it, expect } from "vitest";
import {
  buildDeliverySystemPrompt,
  buildDeliveryUserPrompt,
} from "../prompts/delivery.js";
import type { DeliveryDigestInput } from "../prompts/delivery.js";

describe("buildDeliverySystemPrompt", () => {
  it("produces email-specific instructions mentioning newsletter", () => {
    const prompt = buildDeliverySystemPrompt("email");
    expect(prompt).toContain("newsletter");
  });

  it("email prompt is longer than slack prompt", () => {
    const emailPrompt = buildDeliverySystemPrompt("email");
    const slackPrompt = buildDeliverySystemPrompt("slack");
    expect(emailPrompt.length).toBeGreaterThan(slackPrompt.length);
  });

  it("produces slack-specific instructions mentioning ultra-concise", () => {
    const prompt = buildDeliverySystemPrompt("slack");
    expect(prompt).toContain("ultra-concise");
  });

  it("email prompt includes structure guidance", () => {
    const prompt = buildDeliverySystemPrompt("email");
    expect(prompt).toContain("headline");
    expect(prompt).toContain("sections");
  });

  it("slack prompt includes structure guidance", () => {
    const prompt = buildDeliverySystemPrompt("slack");
    expect(prompt).toContain("headline");
    expect(prompt).toContain("sections");
  });
});

describe("buildDeliveryUserPrompt", () => {
  const fullInput: DeliveryDigestInput = {
    subreddits: [
      {
        name: "typescript",
        posts: [
          {
            title: "TypeScript 6.0 Released",
            score: 500,
            summary: "Major performance improvements in TypeScript 6.0.",
            keyTakeaways: [
              "50% faster compilation",
              "Improved type inference",
            ],
            insightNotes: "Directly relevant to your monorepo workflow.",
            commentHighlights: [
              {
                author: "tsdev",
                insight: "Game changer for large codebases",
                score: 120,
              },
            ],
          },
        ],
      },
      {
        name: "golang",
        posts: [
          {
            title: "Go 2.0 Generics Deep Dive",
            score: 320,
            summary: "Detailed analysis of Go 2.0 generics implementation.",
            keyTakeaways: ["Type parameters now support constraints"],
            insightNotes: "Interesting comparison to TypeScript generics.",
            commentHighlights: [],
          },
        ],
      },
    ],
  };

  it("includes subreddit names", () => {
    const prompt = buildDeliveryUserPrompt(fullInput);
    expect(prompt).toContain("r/typescript");
    expect(prompt).toContain("r/golang");
  });

  it("includes post titles", () => {
    const prompt = buildDeliveryUserPrompt(fullInput);
    expect(prompt).toContain("TypeScript 6.0 Released");
    expect(prompt).toContain("Go 2.0 Generics Deep Dive");
  });

  it("includes post summaries", () => {
    const prompt = buildDeliveryUserPrompt(fullInput);
    expect(prompt).toContain("Major performance improvements in TypeScript 6.0.");
    expect(prompt).toContain("Detailed analysis of Go 2.0 generics implementation.");
  });

  it("includes key takeaways", () => {
    const prompt = buildDeliveryUserPrompt(fullInput);
    expect(prompt).toContain("50% faster compilation");
    expect(prompt).toContain("Improved type inference");
    expect(prompt).toContain("Type parameters now support constraints");
  });

  it("includes insight notes", () => {
    const prompt = buildDeliveryUserPrompt(fullInput);
    expect(prompt).toContain("Directly relevant to your monorepo workflow.");
    expect(prompt).toContain("Interesting comparison to TypeScript generics.");
  });

  it("includes comment highlights with author and insight", () => {
    const prompt = buildDeliveryUserPrompt(fullInput);
    expect(prompt).toContain("u/tsdev");
    expect(prompt).toContain("Game changer for large codebases");
    expect(prompt).toContain("120");
  });

  it("handles minimal input with empty subreddits array", () => {
    const emptyInput: DeliveryDigestInput = { subreddits: [] };
    const prompt = buildDeliveryUserPrompt(emptyInput);
    expect(prompt).toBeDefined();
    expect(typeof prompt).toBe("string");
  });

  it("handles subreddit with empty posts array", () => {
    const emptyPostsInput: DeliveryDigestInput = {
      subreddits: [{ name: "empty_sub", posts: [] }],
    };
    const prompt = buildDeliveryUserPrompt(emptyPostsInput);
    expect(prompt).toContain("r/empty_sub");
  });

  it("handles post with empty arrays for takeaways and highlights", () => {
    const minimalPostInput: DeliveryDigestInput = {
      subreddits: [
        {
          name: "minimal",
          posts: [
            {
              title: "Minimal Post",
              score: 10,
              summary: "A minimal post.",
              keyTakeaways: [],
              insightNotes: "",
              commentHighlights: [],
            },
          ],
        },
      ],
    };
    const prompt = buildDeliveryUserPrompt(minimalPostInput);
    expect(prompt).toContain("Minimal Post");
    expect(prompt).toContain("A minimal post.");
  });
});
