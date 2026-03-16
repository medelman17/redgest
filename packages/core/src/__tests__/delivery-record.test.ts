import { describe, it, expect, vi } from "vitest";
import {
  recordDeliveryPending,
  recordDeliveryResult,
} from "../delivery/record";

/** Safely extract the Nth call's first arg from a mock, returning Record<string, unknown>. */
function callArg(mock: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  const call = mock.mock.calls[n];
  if (!call) throw new Error(`Expected call at index ${n}`);
  const arg = call[0];
  if (typeof arg !== "object" || arg === null) throw new Error("Expected object argument");
  return arg as Record<string, unknown>;
}

describe("recordDeliveryPending", () => {
  it("upserts a PENDING row for a single channel", async () => {
    const mockUpsert = vi.fn().mockResolvedValue(undefined);
    const db: Parameters<typeof recordDeliveryPending>[0] = {
      delivery: { upsert: mockUpsert },
    };

    await recordDeliveryPending(db, "digest-1", "job-1", ["EMAIL"]);

    expect(mockUpsert).toHaveBeenCalledOnce();
    const arg = callArg(mockUpsert);
    const where = arg.where as Record<string, unknown>;
    expect(where.digestId_channel).toEqual({
      digestId: "digest-1",
      channel: "EMAIL",
    });
    const create = arg.create as Record<string, unknown>;
    expect(create).toEqual({
      digestId: "digest-1",
      jobId: "job-1",
      channel: "EMAIL",
      status: "PENDING",
    });
    expect(arg.update).toEqual({
      status: "PENDING",
      error: null,
      externalId: null,
      sentAt: null,
    });
  });

  it("upserts PENDING rows for multiple channels", async () => {
    const mockUpsert = vi.fn().mockResolvedValue(undefined);
    const db: Parameters<typeof recordDeliveryPending>[0] = {
      delivery: { upsert: mockUpsert },
    };

    await recordDeliveryPending(db, "digest-1", "job-1", ["EMAIL", "SLACK"]);

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const firstCreate = callArg(mockUpsert, 0).create as Record<string, unknown>;
    expect(firstCreate.channel).toBe("EMAIL");

    const secondCreate = callArg(mockUpsert, 1).create as Record<string, unknown>;
    expect(secondCreate.channel).toBe("SLACK");
  });

  it("handles empty channels array (no-op)", async () => {
    const mockUpsert = vi.fn().mockResolvedValue(undefined);
    const db: Parameters<typeof recordDeliveryPending>[0] = {
      delivery: { upsert: mockUpsert },
    };

    await recordDeliveryPending(db, "digest-1", "job-1", []);

    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("recordDeliveryResult", () => {
  it("upserts SENT status and persists DeliverySucceeded event in transaction", async () => {
    const mockUpsert = vi.fn().mockResolvedValue(undefined);
    const mockEventCreate = vi.fn().mockResolvedValue(undefined);
    const tx: Parameters<typeof recordDeliveryResult>[0] = {
      delivery: { upsert: mockUpsert },
      event: { create: mockEventCreate },
    };

    await recordDeliveryResult(tx, "digest-1", "job-1", "EMAIL", {
      ok: true,
      externalId: "resend-abc",
    });

    // Check upsert
    expect(mockUpsert).toHaveBeenCalledOnce();
    const upsertArg = callArg(mockUpsert);
    const upsertWhere = upsertArg.where as Record<string, unknown>;
    expect(upsertWhere.digestId_channel).toEqual({
      digestId: "digest-1",
      channel: "EMAIL",
    });
    const upsertCreate = upsertArg.create as Record<string, unknown>;
    expect(upsertCreate.status).toBe("SENT");
    expect(upsertCreate.externalId).toBe("resend-abc");
    expect(upsertCreate.sentAt).toBeInstanceOf(Date);
    const upsertUpdate = upsertArg.update as Record<string, unknown>;
    expect(upsertUpdate.status).toBe("SENT");
    expect(upsertUpdate.externalId).toBe("resend-abc");
    expect(upsertUpdate.error).toBeNull();

    // Check event persist
    expect(mockEventCreate).toHaveBeenCalledOnce();
    const eventArg = callArg(mockEventCreate);
    const eventData = eventArg.data as Record<string, unknown>;
    expect(eventData.type).toBe("DeliverySucceeded");
    expect(eventData.payload).toEqual({
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
      externalId: "resend-abc",
    });
    expect(eventData.aggregateId).toBe("digest-1");
    expect(eventData.aggregateType).toBe("Delivery");
  });

  it("upserts FAILED status and persists DeliveryFailed event", async () => {
    const mockUpsert = vi.fn().mockResolvedValue(undefined);
    const mockEventCreate = vi.fn().mockResolvedValue(undefined);
    const tx: Parameters<typeof recordDeliveryResult>[0] = {
      delivery: { upsert: mockUpsert },
      event: { create: mockEventCreate },
    };

    await recordDeliveryResult(tx, "digest-1", "job-1", "SLACK", {
      ok: false,
      error: "Webhook returned 500",
    });

    // Check upsert
    expect(mockUpsert).toHaveBeenCalledOnce();
    const upsertCreate = callArg(mockUpsert).create as Record<string, unknown>;
    expect(upsertCreate.status).toBe("FAILED");
    expect(upsertCreate.error).toBe("Webhook returned 500");
    const upsertUpdate = callArg(mockUpsert).update as Record<string, unknown>;
    expect(upsertUpdate.status).toBe("FAILED");
    expect(upsertUpdate.error).toBe("Webhook returned 500");

    // Check event persist
    expect(mockEventCreate).toHaveBeenCalledOnce();
    const eventData = callArg(mockEventCreate).data as Record<string, unknown>;
    expect(eventData.type).toBe("DeliveryFailed");
    expect(eventData.payload).toEqual({
      jobId: "job-1",
      digestId: "digest-1",
      channel: "SLACK",
      error: "Webhook returned 500",
    });
  });

  it("omits externalId from event when not provided on success", async () => {
    const mockUpsert = vi.fn().mockResolvedValue(undefined);
    const mockEventCreate = vi.fn().mockResolvedValue(undefined);
    const tx: Parameters<typeof recordDeliveryResult>[0] = {
      delivery: { upsert: mockUpsert },
      event: { create: mockEventCreate },
    };

    await recordDeliveryResult(tx, "digest-1", "job-1", "EMAIL", {
      ok: true,
    });

    const eventData = callArg(mockEventCreate).data as Record<string, unknown>;
    expect(eventData.payload).toEqual({
      jobId: "job-1",
      digestId: "digest-1",
      channel: "EMAIL",
    });

    const upsertCreate = callArg(mockUpsert).create as Record<string, unknown>;
    expect(upsertCreate.externalId).toBeUndefined();
  });
});
