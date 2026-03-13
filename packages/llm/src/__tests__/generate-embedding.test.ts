import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEmbed } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
}));

vi.mock("ai", () => ({
  embed: mockEmbed,
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: {
    embedding: vi.fn((modelId: string) => ({
      provider: "openai",
      modelId,
    })),
  },
}));

import { generateEmbedding } from "../generate-embedding.js";
import type { LlmCallLog } from "../middleware.js";
import * as openaiModule from "@ai-sdk/openai";

const SAMPLE_EMBEDDING = Array.from({ length: 1536 }, (_, i) => i * 0.001);

describe("generateEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("returns embedding array and a well-formed LlmCallLog", async () => {
    mockEmbed.mockResolvedValue({
      value: "hello world",
      embedding: SAMPLE_EMBEDDING,
      usage: { tokens: 3 },
      warnings: [],
    });

    const result = await generateEmbedding("hello world");

    expect(result.data).toEqual(SAMPLE_EMBEDDING);
    expect(result.data).toHaveLength(1536);
    expect(result.log).not.toBeNull();

    const log = result.log as LlmCallLog;
    expect(log.task).toBe("embed");
    expect(log.model).toBe("text-embedding-3-small");
    expect(log.inputTokens).toBe(3);
    expect(log.outputTokens).toBe(0);
    expect(log.totalTokens).toBe(3);
    expect(log.cached).toBe(false);
    expect(log.finishReason).toBe("complete");
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("uses default model name when none is provided", async () => {
    mockEmbed.mockResolvedValue({
      value: "test",
      embedding: [0.1, 0.2, 0.3],
      usage: { tokens: 1 },
      warnings: [],
    });

    const result = await generateEmbedding("test");

    expect(result.log?.model).toBe("text-embedding-3-small");
    expect(vi.mocked(openaiModule.openai.embedding)).toHaveBeenCalledWith(
      "text-embedding-3-small",
    );
  });

  it("uses custom model name when provided", async () => {
    mockEmbed.mockResolvedValue({
      value: "test",
      embedding: [0.5, 0.6],
      usage: { tokens: 2 },
      warnings: [],
    });

    const result = await generateEmbedding("test", "text-embedding-3-large");

    expect(result.log?.model).toBe("text-embedding-3-large");
    expect(vi.mocked(openaiModule.openai.embedding)).toHaveBeenCalledWith(
      "text-embedding-3-large",
    );
  });

  it("captures token usage from result", async () => {
    mockEmbed.mockResolvedValue({
      value: "a long sentence to embed",
      embedding: [0.1],
      usage: { tokens: 42 },
      warnings: [],
    });

    const result = await generateEmbedding("a long sentence to embed");

    expect(result.log?.inputTokens).toBe(42);
    expect(result.log?.totalTokens).toBe(42);
    expect(result.log?.outputTokens).toBe(0);
  });

  it("captures duration in the log", async () => {
    mockEmbed.mockResolvedValue({
      value: "timing test",
      embedding: [0.1],
      usage: { tokens: 5 },
      warnings: [],
    });

    const result = await generateEmbedding("timing test");

    expect(result.log?.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.log?.durationMs).toBe("number");
  });

  it("logs structured JSON to console", async () => {
    mockEmbed.mockResolvedValue({
      value: "log test",
      embedding: [0.1, 0.2],
      usage: { tokens: 7 },
      warnings: [],
    });

    await generateEmbedding("log test");

    // eslint-disable-next-line no-console -- verifying structured log output
    expect(console.log).toHaveBeenCalledOnce();
    // eslint-disable-next-line no-console -- verifying structured log output
    const logArg = (console.log as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    const parsed = JSON.parse(logArg) as LlmCallLog & { type: string };
    expect(parsed.type).toBe("llm_call");
    expect(parsed.task).toBe("embed");
    expect(parsed.model).toBe("text-embedding-3-small");
    expect(parsed.inputTokens).toBe(7);
    expect(parsed.cached).toBe(false);
  });

  it("passes correct arguments to embed", async () => {
    mockEmbed.mockResolvedValue({
      value: "arg test",
      embedding: [0.3],
      usage: { tokens: 2 },
      warnings: [],
    });

    await generateEmbedding("arg test");

    expect(mockEmbed).toHaveBeenCalledOnce();
    const callArgs = mockEmbed.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs.model).toBeDefined();
    expect(callArgs.value).toBe("arg test");
  });
});
