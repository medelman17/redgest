import { describe, it, expect, vi } from "vitest";
import { persistEvent } from "../events/persist.js";
import type { DomainEvent } from "../events/types.js";

/** Safely extract the first call's first arg, typed with a `data` field. */
function firstCallArg(mock: ReturnType<typeof vi.fn>): {
  data: Record<string, unknown>;
} {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("Expected at least one call");
  const arg = call[0] as { data: Record<string, unknown> } | undefined;
  if (!arg) throw new Error("Expected first argument");
  return arg;
}

function makeEvent(overrides?: Partial<DomainEvent>): DomainEvent {
  const base: DomainEvent = {
    type: "DigestRequested",
    payload: { jobId: "job-1", subredditIds: ["sub-1"] },
    aggregateId: "job-1",
    aggregateType: "job",
    version: 1,
    correlationId: "corr-1",
    causationId: null,
    metadata: { source: "test" },
    occurredAt: new Date("2026-03-09T12:00:00Z"),
  };
  if (!overrides) return base;
  const merged = { ...base, ...overrides };
  return merged as DomainEvent;
}

describe("persistEvent", () => {
  it("calls tx.event.create with correct data", async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    const mockTx: Parameters<typeof persistEvent>[0] = {
      event: { create: mockCreate },
    };

    const event = makeEvent();
    await persistEvent(mockTx, event);

    expect(mockCreate).toHaveBeenCalledOnce();
    const { data } = firstCallArg(mockCreate);
    expect(data.type).toBe("DigestRequested");
    expect(data.aggregateId).toBe("job-1");
    expect(data.aggregateType).toBe("job");
    expect(data.version).toBe(1);
    expect(data.correlationId).toBe("corr-1");
    expect(data.causationId).toBeNull();
    expect(data.payload).toEqual({ jobId: "job-1", subredditIds: ["sub-1"] });
    expect(data.metadata).toEqual({ source: "test" });
  });

  it("passes null correlationId and causationId", async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    const mockTx: Parameters<typeof persistEvent>[0] = {
      event: { create: mockCreate },
    };

    const event = makeEvent({ correlationId: null, causationId: null });
    await persistEvent(mockTx, event);

    const { data } = firstCallArg(mockCreate);
    expect(data.correlationId).toBeNull();
    expect(data.causationId).toBeNull();
  });

  it("serializes metadata as-is", async () => {
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    const mockTx: Parameters<typeof persistEvent>[0] = {
      event: { create: mockCreate },
    };

    const event = makeEvent({
      metadata: { source: "api", requestId: "req-123" },
    });
    await persistEvent(mockTx, event);

    const { data } = firstCallArg(mockCreate);
    expect(data.metadata).toEqual({ source: "api", requestId: "req-123" });
  });
});
