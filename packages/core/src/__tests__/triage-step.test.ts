import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";
import type { PrismaClient } from "@redgest/db";
import type { TriagePostCandidate, TriageResult } from "@redgest/llm";

vi.mock("@redgest/llm", () => ({
  generateTriageResult: vi.fn(),
}));

vi.mock("../pipeline/token-budget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../pipeline/token-budget")>();
  return {
    ...actual,
    applyTriageBudget: vi.fn(actual.applyTriageBudget),
  };
});

import { triageStep } from "../pipeline/triage-step";
import { generateTriageResult } from "@redgest/llm";
import { applyTriageBudget } from "../pipeline/token-budget";

const mockGenerateTriage = vi.mocked(generateTriageResult);
const mockApplyBudget = vi.mocked(applyTriageBudget);

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

function makeTriageResult(
  selectedPosts: TriageResult["selectedPosts"],
): { data: TriageResult; log: null } {
  return { data: { selectedPosts }, log: null };
}

interface MockDb {
  llmCall: { create: ReturnType<typeof vi.fn> };
}

function makeMockDb(): MockDb {
  return {
    llmCall: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe("triageStep", () => {
  let mockDb: MockDb;
  const jobId = "job-test-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = makeMockDb();
  });

  it("returns empty selected for empty candidates", async () => {
    const result = await triageStep(
      [],
      ["prompt1"],
      5,
      mockDb as unknown as PrismaClient,
      jobId,
    );
    expect(result).toEqual({ selected: [] });
    expect(mockGenerateTriage).not.toHaveBeenCalled();
  });

  it("caps effectiveTarget at candidates.length when fewer than targetCount", async () => {
    const candidates = [
      makeCandidate({ index: 0 }),
      makeCandidate({ index: 1 }),
    ];
    mockGenerateTriage.mockResolvedValue(
      makeTriageResult([
        { index: 0, relevanceScore: 0.9, rationale: "Good" },
        { index: 1, relevanceScore: 0.8, rationale: "Also good" },
      ]),
    );

    await triageStep(
      candidates,
      ["prompt1"],
      10,
      mockDb as unknown as PrismaClient,
      jobId,
    );

    // targetCount=10 but only 2 candidates, so effectiveTarget should be 2
    expect(mockGenerateTriage).toHaveBeenCalledWith(
      expect.anything(),
      ["prompt1"],
      2,
      undefined,
    );
  });

  it("applies token budget before calling LLM", async () => {
    const candidates = [
      makeCandidate({ index: 0, selftext: "long content" }),
    ];
    mockGenerateTriage.mockResolvedValue(
      makeTriageResult([
        { index: 0, relevanceScore: 0.9, rationale: "Relevant" },
      ]),
    );

    await triageStep(
      candidates,
      ["prompt1"],
      5,
      mockDb as unknown as PrismaClient,
      jobId,
    );

    expect(mockApplyBudget).toHaveBeenCalledWith(candidates);
    // applyTriageBudget should be called before generateTriageResult
    const budgetCallOrder = mockApplyBudget.mock.invocationCallOrder[0];
    const triageCallOrder = mockGenerateTriage.mock.invocationCallOrder[0];
    expect(budgetCallOrder).toBeLessThan(
      triageCallOrder != null ? triageCallOrder : Infinity,
    );
  });

  it("maps TriageResult.selectedPosts to TriageStepResult.selected", async () => {
    const candidates = [
      makeCandidate({ index: 0 }),
      makeCandidate({ index: 1 }),
      makeCandidate({ index: 2 }),
    ];
    mockGenerateTriage.mockResolvedValue(
      makeTriageResult([
        { index: 0, relevanceScore: 0.95, rationale: "Very relevant" },
        { index: 2, relevanceScore: 0.7, rationale: "Somewhat relevant" },
      ]),
    );

    const result = await triageStep(
      candidates,
      ["insight1", "insight2"],
      2,
      mockDb as unknown as PrismaClient,
      jobId,
    );

    expect(result.selected).toEqual([
      { index: 0, relevanceScore: 0.95, rationale: "Very relevant" },
      { index: 2, relevanceScore: 0.7, rationale: "Somewhat relevant" },
    ]);
  });

  it("passes model parameter through to generateTriageResult", async () => {
    const candidates = [makeCandidate({ index: 0 })];
    const fakeModel = { modelId: "test-model" } as unknown as LanguageModel;
    mockGenerateTriage.mockResolvedValue(
      makeTriageResult([
        { index: 0, relevanceScore: 0.8, rationale: "Ok" },
      ]),
    );

    await triageStep(
      candidates,
      ["prompt1"],
      5,
      mockDb as unknown as PrismaClient,
      jobId,
      fakeModel,
    );

    expect(mockGenerateTriage).toHaveBeenCalledWith(
      expect.anything(),
      ["prompt1"],
      1, // effectiveTarget = min(5, 1)
      fakeModel,
    );
  });

  it("passes budgeted candidates (not originals) to LLM", async () => {
    const candidates = [
      makeCandidate({ index: 0, selftext: "original text" }),
    ];
    const budgetedCandidates = [
      makeCandidate({ index: 0, selftext: "budgeted text" }),
    ];
    mockApplyBudget.mockReturnValue(budgetedCandidates);
    mockGenerateTriage.mockResolvedValue(
      makeTriageResult([
        { index: 0, relevanceScore: 0.9, rationale: "Good" },
      ]),
    );

    await triageStep(
      candidates,
      ["prompt1"],
      5,
      mockDb as unknown as PrismaClient,
      jobId,
    );

    expect(mockGenerateTriage).toHaveBeenCalledWith(
      budgetedCandidates,
      ["prompt1"],
      1,
      undefined,
    );
  });

  it("does not persist llmCall when log is null", async () => {
    const candidates = [makeCandidate({ index: 0 })];
    mockGenerateTriage.mockResolvedValue(
      makeTriageResult([
        { index: 0, relevanceScore: 0.9, rationale: "Good" },
      ]),
    );

    await triageStep(
      candidates,
      ["prompt1"],
      5,
      mockDb as unknown as PrismaClient,
      jobId,
    );

    expect(mockDb.llmCall.create).not.toHaveBeenCalled();
  });

  it("persists llmCall when log is non-null", async () => {
    const candidates = [makeCandidate({ index: 0 })];
    mockGenerateTriage.mockResolvedValue({
      data: {
        selectedPosts: [
          { index: 0, relevanceScore: 0.9, rationale: "Good" },
        ],
      },
      log: {
        task: "triage",
        model: "claude-sonnet-4-20250514",
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        durationMs: 500,
        cached: false,
        finishReason: "stop",
      },
    });

    await triageStep(
      candidates,
      ["prompt1"],
      5,
      mockDb as unknown as PrismaClient,
      jobId,
    );

    expect(mockDb.llmCall.create).toHaveBeenCalledWith({
      data: {
        jobId,
        postId: null,
        task: "triage",
        model: "claude-sonnet-4-20250514",
        inputTokens: 1000,
        outputTokens: 200,
        durationMs: 500,
        cached: false,
        finishReason: "stop",
      },
    });
  });
});
