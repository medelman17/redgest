import { describe, it, expect, vi, beforeEach } from "vitest";
import { createExecute } from "../commands/dispatch.js";
import type {
  ExecuteContext,
  TransactableClient,
  TransactionArg,
} from "../commands/dispatch.js";
import { DomainEventBus } from "../events/bus.js";
import type { CommandHandler } from "../commands/types.js";
import type { HandlerContext } from "../context.js";

/** Cast helper to avoid objectLiteralTypeAssertions lint rule on `{} as T`. */
function stub<T>(): T {
  const empty = {};
  return empty as T;
}

/**
 * Create a mock TransactionArg with event.create spy.
 */
function createMockTx(): TransactionArg & {
  event: { create: ReturnType<typeof vi.fn> };
} {
  const mockCreate = vi.fn().mockResolvedValue(undefined);
  const tx: TransactionArg = {
    event: { create: mockCreate },
  };
  return tx as TransactionArg & {
    event: { create: ReturnType<typeof vi.fn> };
  };
}

/**
 * Create a mock TransactableClient whose $transaction calls fn with the given tx.
 */
function createMockDb(tx: TransactionArg): TransactableClient {
  return {
    $transaction: vi.fn(async (fn: (t: TransactionArg) => Promise<unknown>) =>
      fn(tx),
    ) as TransactableClient["$transaction"],
  };
}

describe("execute()", () => {
  let eventBus: DomainEventBus;
  let mockTx: ReturnType<typeof createMockTx>;
  let mockDb: TransactableClient;
  let ctx: ExecuteContext;

  beforeEach(() => {
    eventBus = new DomainEventBus();
    mockTx = createMockTx();
    mockDb = createMockDb(mockTx);
    ctx = {
      db: mockDb,
      eventBus,
      config: stub<HandlerContext["config"]>(),
      organizationId: "org_test",
    };
  });

  it("calls handler with params and transactional context", async () => {
    const handler = vi.fn().mockResolvedValue({
      data: { jobId: "job-1", status: "queued" },
      event: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    const execute = createExecute({
      GenerateDigest: handler as CommandHandler<"GenerateDigest">,
    });

    await execute("GenerateDigest", { subredditIds: ["sub-1"] }, ctx);

    expect(handler).toHaveBeenCalledOnce();
    // Handler receives mockTx as db (inside transaction), not mockDb
    const handlerCtx = handler.mock.calls[0]?.[1] as HandlerContext;
    expect(handlerCtx.db).toBe(mockTx);
  });

  it("returns handler result data", async () => {
    const handler = vi.fn().mockResolvedValue({
      data: { jobId: "job-1", status: "queued" },
      event: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    const execute = createExecute({
      GenerateDigest: handler as CommandHandler<"GenerateDigest">,
    });
    const result = await execute("GenerateDigest", {}, ctx);

    expect(result).toEqual({ jobId: "job-1", status: "queued" });
  });

  it("persists event inside transaction", async () => {
    const handler = vi.fn().mockResolvedValue({
      data: { jobId: "job-1", status: "queued" },
      event: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    const execute = createExecute({
      GenerateDigest: handler as CommandHandler<"GenerateDigest">,
    });
    await execute("GenerateDigest", {}, ctx);

    expect(mockTx.event.create).toHaveBeenCalledOnce();
    const createArg = mockTx.event.create.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(createArg?.data?.type).toBe("DigestRequested");
    expect(createArg?.data?.payload).toEqual({
      jobId: "job-1",
      subredditIds: ["sub-1"],
    });
  });

  it("emits event on bus AFTER transaction", async () => {
    const emitted: string[] = [];
    eventBus.on("DigestRequested", () => {
      emitted.push("DigestRequested");
    });

    const handler = vi.fn().mockResolvedValue({
      data: { jobId: "job-1", status: "queued" },
      event: { jobId: "job-1", subredditIds: ["sub-1"] },
    });

    const execute = createExecute({
      GenerateDigest: handler as CommandHandler<"GenerateDigest">,
    });
    await execute("GenerateDigest", {}, ctx);

    expect(emitted).toEqual(["DigestRequested"]);
  });

  it("does not persist or emit event when handler returns null event", async () => {
    const handler = vi.fn().mockResolvedValue({
      data: { subredditId: "sub-1" },
      event: null,
    });

    const emitted: string[] = [];
    eventBus.on("SubredditAdded", () => {
      emitted.push("fired");
    });

    const execute = createExecute({
      UpdateSubreddit: handler as CommandHandler<"UpdateSubreddit">,
    });
    await execute("UpdateSubreddit", { subredditId: "sub-1" }, ctx);

    expect(mockTx.event.create).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });

  it("throws for unregistered command handler", async () => {
    const execute = createExecute({});

    await expect(
      execute("GenerateDigest", {}, ctx),
    ).rejects.toThrow("No handler registered for command: GenerateDigest");
  });

  it("propagates handler errors", async () => {
    const handler = vi
      .fn()
      .mockRejectedValue(new Error("DB constraint violation"));

    const execute = createExecute({
      GenerateDigest: handler as CommandHandler<"GenerateDigest">,
    });

    await expect(execute("GenerateDigest", {}, ctx)).rejects.toThrow(
      "DB constraint violation",
    );
  });
});
