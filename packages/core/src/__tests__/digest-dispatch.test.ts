import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRunDigestPipeline,
  mockTasksTrigger,
} = vi.hoisted(() => ({
  mockRunDigestPipeline: vi.fn(),
  mockTasksTrigger: vi.fn(),
}));

vi.mock("../pipeline/orchestrator.js", () => ({
  runDigestPipeline: mockRunDigestPipeline,
}));

vi.mock("@trigger.dev/sdk/v3", () => ({
  tasks: { trigger: mockTasksTrigger },
}));

import { wireDigestDispatch } from "../digest-dispatch.js";
import type { DomainEventBus } from "../events/bus.js";
import type { PipelineDeps } from "../pipeline/types.js";

function createMockDeps(triggerSecretKey?: string) {
  const mockDb = {
    job: { update: vi.fn() },
  };

  type EventHandler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, EventHandler>();
  const mockEventBus = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    }),
    off: vi.fn(),
    emit: vi.fn(),
    emitEvent: vi.fn(),
  } as unknown as DomainEventBus;

  const mockPipelineDeps = {
    db: mockDb,
    eventBus: mockEventBus,
    contentSource: { fetchContent: vi.fn() },
    config: {},
  } as unknown as PipelineDeps;

  return { mockDb, mockEventBus, mockPipelineDeps, handlers, triggerSecretKey };
}

function getHandler(handlers: Map<string, (...args: unknown[]) => unknown>) {
  const handler = handlers.get("DigestRequested");
  if (!handler) throw new Error("DigestRequested handler not registered");
  return handler as (event: {
    type: "DigestRequested";
    payload: { jobId: string; subredditIds: string[] };
  }) => Promise<void>;
}

describe("wireDigestDispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a DigestRequested handler on the event bus", () => {
    const { mockEventBus, mockPipelineDeps } = createMockDeps();
    wireDigestDispatch({ eventBus: mockEventBus, pipelineDeps: mockPipelineDeps });

    expect(mockEventBus.on).toHaveBeenCalledWith(
      "DigestRequested",
      expect.any(Function),
    );
  });

  describe("with triggerSecretKey", () => {
    it("dispatches via Trigger.dev", async () => {
      const deps = createMockDeps("tr_test");
      wireDigestDispatch({
        eventBus: deps.mockEventBus,
        pipelineDeps: deps.mockPipelineDeps,
        triggerSecretKey: deps.triggerSecretKey,
      });

      const handler = getHandler(deps.handlers);
      await handler({
        type: "DigestRequested",
        payload: { jobId: "job-1", subredditIds: ["sub-1"] },
      });

      expect(mockTasksTrigger).toHaveBeenCalledWith("generate-digest", {
        jobId: "job-1",
        subredditIds: ["sub-1"],
      });
      expect(mockRunDigestPipeline).not.toHaveBeenCalled();
    });

    it("falls back to in-process when Trigger.dev dispatch fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockTasksTrigger.mockRejectedValueOnce(new Error("dispatch failed"));

      const deps = createMockDeps("tr_test");
      wireDigestDispatch({
        eventBus: deps.mockEventBus,
        pipelineDeps: deps.mockPipelineDeps,
        triggerSecretKey: deps.triggerSecretKey,
      });

      const handler = getHandler(deps.handlers);
      await handler({
        type: "DigestRequested",
        payload: { jobId: "job-1", subredditIds: ["sub-1"] },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("dispatch failed"),
      );
      expect(mockRunDigestPipeline).toHaveBeenCalledWith(
        "job-1",
        ["sub-1"],
        deps.mockPipelineDeps,
      );
      consoleSpy.mockRestore();
    });
  });

  describe("without triggerSecretKey", () => {
    it("runs pipeline in-process", async () => {
      const deps = createMockDeps();
      wireDigestDispatch({
        eventBus: deps.mockEventBus,
        pipelineDeps: deps.mockPipelineDeps,
      });

      const handler = getHandler(deps.handlers);
      await handler({
        type: "DigestRequested",
        payload: { jobId: "job-1", subredditIds: ["sub-1", "sub-2"] },
      });

      expect(mockRunDigestPipeline).toHaveBeenCalledWith(
        "job-1",
        ["sub-1", "sub-2"],
        deps.mockPipelineDeps,
      );
      expect(mockTasksTrigger).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("marks job as FAILED when pipeline throws", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRunDigestPipeline.mockRejectedValueOnce(new Error("pipeline boom"));

      const deps = createMockDeps();
      wireDigestDispatch({
        eventBus: deps.mockEventBus,
        pipelineDeps: deps.mockPipelineDeps,
      });

      const handler = getHandler(deps.handlers);
      await handler({
        type: "DigestRequested",
        payload: { jobId: "job-fail", subredditIds: [] },
      });

      expect(deps.mockDb.job.update).toHaveBeenCalledWith({
        where: { id: "job-fail" },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "pipeline boom",
        },
      });
      consoleSpy.mockRestore();
    });

    it("logs but does not throw when job update also fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRunDigestPipeline.mockRejectedValueOnce(new Error("pipeline boom"));

      const deps = createMockDeps();
      deps.mockDb.job.update.mockRejectedValueOnce(new Error("db down"));

      wireDigestDispatch({
        eventBus: deps.mockEventBus,
        pipelineDeps: deps.mockPipelineDeps,
      });

      const handler = getHandler(deps.handlers);
      // Should not throw
      await handler({
        type: "DigestRequested",
        payload: { jobId: "job-fail", subredditIds: [] },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update job job-fail"),
      );
      consoleSpy.mockRestore();
    });
  });
});
