import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../provider", () => ({
  getModel: vi.fn(() => ({ provider: "mock", modelId: "mock-model" })),
}));

vi.mock("../cache", () => ({
  withCache: vi.fn(
    async (
      _taskType: string,
      _inputs: unknown,
      fn: () => Promise<unknown>,
    ) => ({ data: await fn(), cached: false }),
  ),
}));

import { generateDeliveryProse } from "../generate-delivery-prose";
import { withCache } from "../cache";
import type { DeliveryDigestInput } from "../prompts/delivery";

const sampleInput: DeliveryDigestInput = {
  subreddits: [
    {
      name: "typescript",
      posts: [
        {
          title: "TypeScript 6.0 Released",
          score: 500,
          summary: "TypeScript 6.0 brings major performance improvements.",
          keyTakeaways: ["50% faster compilation", "New type inference"],
          insightNotes: "Relevant to your TypeScript workflow.",
          commentHighlights: [
            { author: "tsdev", insight: "Game changer for monorepos", score: 120 },
          ],
        },
      ],
    },
  ],
};

const sampleProseResult = {
  headline: "TypeScript 6.0 drops with massive performance wins.",
  sections: [
    {
      subreddit: "typescript",
      body: "The big news is TypeScript 6.0, which brings 50% faster compilation.",
    },
  ],
};

describe("generateDeliveryProse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateText with the correct system prompt for email channel", async () => {
    mockGenerateText.mockResolvedValue({ output: sampleProseResult });

    const result = await generateDeliveryProse(sampleInput, "email");

    expect(result.data).toEqual(sampleProseResult);
    expect(result.log).not.toBeNull();
    expect(result.log?.task).toBe("delivery-email");
    expect(mockGenerateText).toHaveBeenCalledOnce();

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBeDefined();
    expect(callArgs.system).toContain("newsletter");
    expect(callArgs.prompt).toContain("TypeScript 6.0 Released");
    expect(callArgs.output).toBeDefined();
  });

  it("calls generateText with the correct system prompt for slack channel", async () => {
    mockGenerateText.mockResolvedValue({ output: sampleProseResult });

    const result = await generateDeliveryProse(sampleInput, "slack");

    expect(result.data).toEqual(sampleProseResult);
    expect(result.log).not.toBeNull();
    expect(result.log?.task).toBe("delivery-slack");

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.system).toContain("ultra-concise");
  });

  it("includes channel name in cache key", async () => {
    mockGenerateText.mockResolvedValue({ output: sampleProseResult });

    await generateDeliveryProse(sampleInput, "email");

    const mockWithCache = vi.mocked(withCache);
    expect(mockWithCache).toHaveBeenCalledOnce();
    const cacheKey = mockWithCache.mock.calls[0]?.[0] as string;
    expect(cacheKey).toBe("delivery-email");

    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({ output: sampleProseResult });

    await generateDeliveryProse(sampleInput, "slack");

    expect(mockWithCache).toHaveBeenCalledOnce();
    const slackCacheKey = mockWithCache.mock.calls[0]?.[0] as string;
    expect(slackCacheKey).toBe("delivery-slack");
  });

  it("accepts custom model override", async () => {
    mockGenerateText.mockResolvedValue({ output: sampleProseResult });

    const customModel = { provider: "custom", modelId: "custom-model" };
    await generateDeliveryProse(
      sampleInput,
      "email",
      customModel as Parameters<typeof generateDeliveryProse>[2],
    );

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArgs.model).toBe(customModel);
  });
});
