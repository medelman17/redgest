import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

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

import { generateWithLogging } from "../middleware.js";
import type { LlmCallLog } from "../middleware.js";

const TestSchema = z.object({
  answer: z.string(),
});

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test mock
const mockModel = {
  provider: "mock",
  modelId: "mock-model-v1",
} as Parameters<typeof generateWithLogging>[0]["model"];

describe("generateWithLogging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("returns output and log with correct structure", async () => {
    mockGenerateText.mockResolvedValue({
      output: { answer: "42" },
      usage: { inputTokens: 100, outputTokens: 50 },
      finishReason: "stop",
    });

    const { output, log } = await generateWithLogging({
      task: "test-task",
      model: mockModel,
      system: "You are a test.",
      prompt: "What is the answer?",
      schema: TestSchema,
    });

    expect(output).toEqual({ answer: "42" });
    expect(log.task).toBe("test-task");
    expect(log.model).toBe("mock-model-v1");
    expect(log.inputTokens).toBe(100);
    expect(log.outputTokens).toBe(50);
    expect(log.totalTokens).toBe(150);
    expect(log.finishReason).toBe("stop");
    expect(log.cached).toBe(false);
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles missing usage gracefully", async () => {
    mockGenerateText.mockResolvedValue({
      output: { answer: "no usage" },
    });

    const { log } = await generateWithLogging({
      task: "test",
      model: mockModel,
      system: "sys",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(log.inputTokens).toBe(0);
    expect(log.outputTokens).toBe(0);
    expect(log.totalTokens).toBe(0);
    expect(log.finishReason).toBe("unknown");
  });

  it("handles missing modelId gracefully", async () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test mock
    const modelWithoutId = { provider: "custom" } as Parameters<
      typeof generateWithLogging
    >[0]["model"];
    mockGenerateText.mockResolvedValue({
      output: { answer: "ok" },
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
    });

    const { log } = await generateWithLogging({
      task: "test",
      model: modelWithoutId,
      system: "sys",
      prompt: "prompt",
      schema: TestSchema,
    });

    expect(log.model).toBe("unknown");
  });

  it("respects cached flag when provided", async () => {
    mockGenerateText.mockResolvedValue({
      output: { answer: "cached" },
      usage: { inputTokens: 0, outputTokens: 0 },
      finishReason: "stop",
    });

    const { log } = await generateWithLogging({
      task: "test",
      model: mockModel,
      system: "sys",
      prompt: "prompt",
      schema: TestSchema,
      cached: true,
    });

    expect(log.cached).toBe(true);
  });

  it("logs structured JSON to console", async () => {
    mockGenerateText.mockResolvedValue({
      output: { answer: "logged" },
      usage: { inputTokens: 200, outputTokens: 100 },
      finishReason: "stop",
    });

    await generateWithLogging({
      task: "summarize",
      model: mockModel,
      system: "sys",
      prompt: "prompt",
      schema: TestSchema,
    });

    // eslint-disable-next-line no-console -- verifying structured log output
    expect(console.log).toHaveBeenCalledOnce();
    // eslint-disable-next-line no-console -- verifying structured log output
    const logArg = (console.log as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    const parsed = JSON.parse(logArg) as LlmCallLog & { type: string };
    expect(parsed.type).toBe("llm_call");
    expect(parsed.task).toBe("summarize");
    expect(parsed.inputTokens).toBe(200);
    expect(parsed.outputTokens).toBe(100);
  });

  it("passes correct arguments to generateText", async () => {
    mockGenerateText.mockResolvedValue({
      output: { answer: "ok" },
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    });

    await generateWithLogging({
      task: "test",
      model: mockModel,
      system: "system-prompt",
      prompt: "user-prompt",
      schema: TestSchema,
    });

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBe(mockModel);
    expect(callArgs.system).toBe("system-prompt");
    expect(callArgs.prompt).toBe("user-prompt");
    expect(callArgs.output).toBeDefined();
  });
});
