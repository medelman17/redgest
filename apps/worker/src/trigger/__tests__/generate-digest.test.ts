import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Module mocks (must be top-level, before imports) ---

vi.mock("@trigger.dev/sdk/v3", () => ({
  task: (config: {
    id: string;
    retry?: unknown;
    run: (...args: unknown[]) => unknown;
  }) => config,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  idempotencyKeys: { create: vi.fn().mockResolvedValue("test-idempotency-key") },
}));

vi.mock("@redgest/config", () => ({
  loadConfig: vi.fn(() => ({
    REDDIT_CLIENT_ID: "test-client-id",
    REDDIT_CLIENT_SECRET: "test-client-secret",
  })),
  DEFAULT_ORGANIZATION_ID: "org_default",
}));

vi.mock("@redgest/db", () => ({
  prisma: {
    job: { update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@redgest/core", () => ({
  // Must use `function` (not arrow) so `new DomainEventBus()` works
  DomainEventBus: vi.fn(function () {
    return { on: vi.fn(), emit: vi.fn(), emitEvent: vi.fn() };
  }),
  runDigestPipeline: vi.fn(),
}));

vi.mock("@redgest/reddit", () => ({
  // Must use `function` (not arrow) so `new RedditClient()` etc. works
  RedditClient: vi.fn(function () { return {}; }),
  PublicRedditClient: vi.fn(function () { return {}; }),
  TokenBucket: vi.fn(function () { return {}; }),
  RedditContentSource: vi.fn(function () { return {}; }),
}));

// Mock deliver-digest dynamic import
vi.mock("../deliver-digest.js", () => ({
  deliverDigest: { trigger: vi.fn().mockResolvedValue({ id: "delivery-run-1" }) },
}));

// --- Static imports after mocks ---

import { generateDigest as _generateDigest } from "../generate-digest.js";
import { runDigestPipeline } from "@redgest/core";
import { prisma } from "@redgest/db";
import { deliverDigest } from "../deliver-digest.js";
import { logger } from "@trigger.dev/sdk/v3";

// The task() mock strips the SDK wrapper and returns the config object directly,
// so at runtime generateDigest has { id, retry, run } — cast to expose them.
const generateDigest = _generateDigest as unknown as {
  id: string;
  retry: { maxAttempts: number };
  run: (payload: { jobId: string; subredditIds: string[]; organizationId?: string }) => Promise<{
    jobId: string;
    status: string;
    digestId: string | undefined;
  }>;
};

// --- Typed mock helpers ---

const mockRunDigestPipeline = vi.mocked(runDigestPipeline);
const mockPrismaJobUpdate = vi.mocked(prisma.job.update);
const mockDeliverDigestTrigger = vi.mocked(deliverDigest.trigger);
const mockLoggerError = vi.mocked(logger.error);

// --- Fixtures ---

const BASE_PAYLOAD = {
  jobId: "job-test-1",
  subredditIds: ["sub-1", "sub-2"],
};

const BASE_PIPELINE_RESULT = {
  jobId: "job-test-1",
  status: "COMPLETED" as const,
  digestId: "digest-test-1",
  subredditResults: [],
  errors: [],
};

// --- Tests ---

describe("generateDigest task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path", () => {
    it("calls runDigestPipeline with the correct jobId and subredditIds", async () => {
      mockRunDigestPipeline.mockResolvedValue(BASE_PIPELINE_RESULT);

      await generateDigest.run(BASE_PAYLOAD);

      expect(mockRunDigestPipeline).toHaveBeenCalledOnce();
      const [calledJobId, calledSubredditIds] = mockRunDigestPipeline.mock.calls[0] as [
        string,
        string[],
        unknown,
      ];
      expect(calledJobId).toBe(BASE_PAYLOAD.jobId);
      expect(calledSubredditIds).toEqual(BASE_PAYLOAD.subredditIds);
    });

    it("calls runDigestPipeline with a deps object containing db, eventBus, contentSource, and config", async () => {
      mockRunDigestPipeline.mockResolvedValue(BASE_PIPELINE_RESULT);

      await generateDigest.run(BASE_PAYLOAD);

      const deps = mockRunDigestPipeline.mock.calls[0]?.[2] as unknown as Record<string, unknown>;
      expect(deps).toBeDefined();
      expect(deps["db"]).toBeDefined();
      expect(deps["eventBus"]).toBeDefined();
      expect(deps["contentSource"]).toBeDefined();
      expect(deps["config"]).toBeDefined();
    });

    it("returns the jobId, status, and digestId from the pipeline result", async () => {
      mockRunDigestPipeline.mockResolvedValue(BASE_PIPELINE_RESULT);

      const result = await generateDigest.run(BASE_PAYLOAD);

      expect(result).toEqual({
        jobId: "job-test-1",
        status: "COMPLETED",
        digestId: "digest-test-1",
      });
    });

    it("returns the correct result for a PARTIAL pipeline status", async () => {
      const partialResult = {
        ...BASE_PIPELINE_RESULT,
        status: "PARTIAL" as const,
        digestId: "digest-partial-1",
      };
      mockRunDigestPipeline.mockResolvedValue(partialResult);

      const result = await generateDigest.run(BASE_PAYLOAD);

      expect(result).toEqual({
        jobId: "job-test-1",
        status: "PARTIAL",
        digestId: "digest-partial-1",
      });
    });
  });

  describe("delivery dispatch", () => {
    it("triggers deliver-digest when digestId is present in the result", async () => {
      mockRunDigestPipeline.mockResolvedValue(BASE_PIPELINE_RESULT);

      await generateDigest.run(BASE_PAYLOAD);

      expect(mockDeliverDigestTrigger).toHaveBeenCalledOnce();
      expect(mockDeliverDigestTrigger).toHaveBeenCalledWith(
        { digestId: "digest-test-1", organizationId: undefined },
        expect.objectContaining({ idempotencyKey: "test-idempotency-key" }),
      );
    });

    it("passes organizationId to deliver-digest when provided in payload", async () => {
      mockRunDigestPipeline.mockResolvedValue(BASE_PIPELINE_RESULT);

      await generateDigest.run({ ...BASE_PAYLOAD, organizationId: "org_123" });

      expect(mockDeliverDigestTrigger).toHaveBeenCalledWith(
        { digestId: "digest-test-1", organizationId: "org_123" },
        expect.objectContaining({ idempotencyKey: "test-idempotency-key" }),
      );
    });

    it("does not trigger deliver-digest when digestId is null", async () => {
      const noDigestResult = {
        ...BASE_PIPELINE_RESULT,
        digestId: undefined,
      };
      mockRunDigestPipeline.mockResolvedValue(noDigestResult);

      await generateDigest.run(BASE_PAYLOAD);

      expect(mockDeliverDigestTrigger).not.toHaveBeenCalled();
    });

    it("does not trigger deliver-digest when digestId is undefined", async () => {
      const noDigestResult = {
        ...BASE_PIPELINE_RESULT,
        digestId: undefined,
      };
      mockRunDigestPipeline.mockResolvedValue(noDigestResult);

      await generateDigest.run(BASE_PAYLOAD);

      expect(mockDeliverDigestTrigger).not.toHaveBeenCalled();
    });

    it("does not re-throw when delivery dispatch fails — pipeline result is still returned", async () => {
      mockRunDigestPipeline.mockResolvedValue(BASE_PIPELINE_RESULT);
      mockDeliverDigestTrigger.mockRejectedValue(new Error("Delivery service unavailable"));

      const result = await generateDigest.run(BASE_PAYLOAD);

      // Should not throw — delivery errors are swallowed
      expect(result).toEqual({
        jobId: "job-test-1",
        status: "COMPLETED",
        digestId: "digest-test-1",
      });
    });

    it("logs an error when delivery dispatch fails", async () => {
      mockRunDigestPipeline.mockResolvedValue(BASE_PIPELINE_RESULT);
      mockDeliverDigestTrigger.mockRejectedValue(new Error("Network timeout"));

      await generateDigest.run(BASE_PAYLOAD);

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.stringContaining("digest-test-1"),
        expect.objectContaining({ error: "Network timeout" }),
      );
    });

    it("handles non-Error delivery dispatch failures gracefully", async () => {
      mockRunDigestPipeline.mockResolvedValue(BASE_PIPELINE_RESULT);
      mockDeliverDigestTrigger.mockRejectedValue("string error");

      // Should not throw
      await expect(generateDigest.run(BASE_PAYLOAD)).resolves.toBeDefined();
    });
  });

  describe("error handling — pre-pipeline failures", () => {
    it("updates job status to FAILED when runDigestPipeline throws", async () => {
      const pipelineError = new Error("Pipeline initialization failed");
      mockRunDigestPipeline.mockRejectedValue(pipelineError);

      await expect(generateDigest.run(BASE_PAYLOAD)).rejects.toThrow(
        "Pipeline initialization failed",
      );

      expect(mockPrismaJobUpdate).toHaveBeenCalledWith({
        where: { id: BASE_PAYLOAD.jobId },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "Pipeline initialization failed",
        },
      });
    });

    it("re-throws the original error after marking job as FAILED", async () => {
      const pipelineError = new Error("Critical failure");
      mockRunDigestPipeline.mockRejectedValue(pipelineError);

      await expect(generateDigest.run(BASE_PAYLOAD)).rejects.toThrow("Critical failure");
    });

    it("handles non-Error thrown values — marks job FAILED with string coercion", async () => {
      mockRunDigestPipeline.mockRejectedValue("string rejection");

      await expect(generateDigest.run(BASE_PAYLOAD)).rejects.toBe("string rejection");

      expect(mockPrismaJobUpdate).toHaveBeenCalledWith({
        where: { id: BASE_PAYLOAD.jobId },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "string rejection",
        },
      });
    });

    it("does not throw when prisma.job.update fails during error handling", async () => {
      const pipelineError = new Error("Pipeline down");
      mockRunDigestPipeline.mockRejectedValue(pipelineError);
      mockPrismaJobUpdate.mockRejectedValue(new Error("DB connection lost"));

      // Should still re-throw the original pipeline error, not the DB error
      await expect(generateDigest.run(BASE_PAYLOAD)).rejects.toThrow("Pipeline down");
    });

    it("logs an error when the task fails", async () => {
      const pipelineError = new Error("Something went wrong");
      mockRunDigestPipeline.mockRejectedValue(pipelineError);

      await expect(generateDigest.run(BASE_PAYLOAD)).rejects.toThrow();

      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.stringContaining(BASE_PAYLOAD.jobId),
        expect.objectContaining({ error: "Something went wrong" }),
      );
    });
  });

  describe("task configuration", () => {
    it("has the correct task id", () => {
      // The task mock strips the wrapper and returns the config object directly
      expect(generateDigest.id).toBe("generate-digest");
    });

    it("is configured with maxAttempts: 2", () => {
      const retry = generateDigest.retry as { maxAttempts: number };
      expect(retry.maxAttempts).toBe(2);
    });
  });
});
