import { describe, it, expect, vi, beforeEach } from "vitest";
import { DomainEventBus } from "../events/bus.js";
import { wireDigestDispatch } from "../digest-dispatch.js";
import type { PipelineDeps } from "../pipeline/types.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("wireDigestDispatch — delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers DigestCompleted handler when deliverDigest callback provided", () => {
    const eventBus = new DomainEventBus();
    const onSpy = vi.spyOn(eventBus, "on");
    const pipelineDeps = stub<PipelineDeps>();

    wireDigestDispatch({
      eventBus,
      pipelineDeps,
      deliverDigest: vi.fn(),
    });

    // Verify DigestCompleted listener was registered
    expect(onSpy).toHaveBeenCalledWith("DigestCompleted", expect.any(Function));
  });

  it("does NOT register DigestCompleted handler when triggerSecretKey is set", () => {
    const eventBus = new DomainEventBus();
    const onSpy = vi.spyOn(eventBus, "on");
    const pipelineDeps = stub<PipelineDeps>();

    wireDigestDispatch({
      eventBus,
      pipelineDeps,
      triggerSecretKey: "some-key",
    });

    // Should only register DigestRequested, not DigestCompleted
    const digestCompletedCalls = onSpy.mock.calls.filter(
      (args) => args[0] === "DigestCompleted",
    );
    expect(digestCompletedCalls).toHaveLength(0);
  });

  it("calls deliverDigest with digestId and jobId on DigestCompleted event", async () => {
    const eventBus = new DomainEventBus();
    const pipelineDeps = stub<PipelineDeps>();
    const deliverDigest = vi.fn().mockResolvedValue(undefined);

    wireDigestDispatch({
      eventBus,
      pipelineDeps,
      deliverDigest,
    });

    eventBus.emit("DigestCompleted", {
      type: "DigestCompleted",
      payload: { jobId: "job-1", digestId: "digest-1" },
      aggregateId: "job-1",
      aggregateType: "Job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    });

    // Allow async handler to settle
    await vi.waitFor(() => {
      expect(deliverDigest).toHaveBeenCalledWith("digest-1", "job-1");
    });
  });

  it("logs error but does not throw when deliverDigest fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const eventBus = new DomainEventBus();
    const pipelineDeps = stub<PipelineDeps>();
    const deliverDigest = vi.fn().mockRejectedValue(new Error("delivery boom"));

    wireDigestDispatch({
      eventBus,
      pipelineDeps,
      deliverDigest,
    });

    eventBus.emit("DigestCompleted", {
      type: "DigestCompleted",
      payload: { jobId: "job-2", digestId: "digest-2" },
      aggregateId: "job-2",
      aggregateType: "Job",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    });

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("delivery boom"),
      );
    });

    consoleSpy.mockRestore();
  });

  it("does NOT register DigestCompleted handler when no deliverDigest provided", () => {
    const eventBus = new DomainEventBus();
    const onSpy = vi.spyOn(eventBus, "on");
    const pipelineDeps = stub<PipelineDeps>();

    wireDigestDispatch({
      eventBus,
      pipelineDeps,
    });

    const digestCompletedCalls = onSpy.mock.calls.filter(
      (args) => args[0] === "DigestCompleted",
    );
    expect(digestCompletedCalls).toHaveLength(0);
  });
});
