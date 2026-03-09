import { describe, it, expect } from "vitest";
import { TriageResultSchema } from "../schemas.js";

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
      expect(result.data.selectedPosts[0].index).toBe(0);
    }
  });

  it("rejects non-integer index", () => {
    const invalid = {
      selectedPosts: [{ index: 1.5, relevanceScore: 7, rationale: "Some reason" }],
    };
    const result = TriageResultSchema.safeParse(invalid);
    expect(result.success).toBe(false);
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
