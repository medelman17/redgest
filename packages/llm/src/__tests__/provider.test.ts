import { describe, it, expect, vi } from "vitest";

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn((model: string) => ({
    provider: "anthropic",
    modelId: model,
  })),
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn((model: string) => ({
    provider: "openai",
    modelId: model,
  })),
}));

import { getModel } from "../provider.js";

describe("getModel", () => {
  it("returns anthropic model for triage task", () => {
    const model = getModel("triage");
    expect(model).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
    });
  });

  it("returns anthropic model for summarize task", () => {
    const model = getModel("summarize");
    expect(model).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
    });
  });

  it("accepts custom override", () => {
    const model = getModel("triage", {
      provider: "openai",
      model: "gpt-4.1",
    });
    expect(model).toEqual({
      provider: "openai",
      modelId: "gpt-4.1",
    });
  });

  it("throws for unknown task without override", () => {
    expect(() => getModel("nonexistent")).toThrow(
      "No model configured for task: nonexistent",
    );
  });
});
