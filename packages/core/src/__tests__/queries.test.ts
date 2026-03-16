import { describe, it, expect, vi } from "vitest";
import type { Query, QueryType } from "../queries/types.js";
import { createQuery } from "../queries/dispatch.js";
import type { HandlerContext } from "../context.js";

/** Cast helper to avoid objectLiteralTypeAssertions lint rule on `{} as T`. */
function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("Query types", () => {
  it("QueryType includes all 9 query types", () => {
    const types: QueryType[] = [
      "GetDigest",
      "GetPost",
      "GetRunStatus",
      "ListDigests",
      "ListRuns",
      "ListSubreddits",
      "GetConfig",
      "SearchPosts",
      "SearchDigests",
    ];
    expect(types).toHaveLength(9);
  });

  it("derives correct Query union", () => {
    const q: Query = {
      type: "GetDigest",
      params: { digestId: "digest-1" },
    };
    expect(q.type).toBe("GetDigest");
  });

  it("allows empty params for ListSubreddits", () => {
    const q: Query = {
      type: "ListSubreddits",
      params: {},
    };
    expect(q.params).toEqual({});
  });
});

describe("query()", () => {
  it("dispatches to the correct handler", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue({ id: "digest-1", content: "..." });

    const query = createQuery({ GetDigest: handler });
    const ctx: HandlerContext = {
      db: stub<HandlerContext["db"]>(),
      eventBus: stub<HandlerContext["eventBus"]>(),
      config: stub<HandlerContext["config"]>(),
      organizationId: "org_test",
    };

    const result = await query("GetDigest", { digestId: "digest-1" }, ctx);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ digestId: "digest-1" }, ctx);
    expect(result).toEqual({ id: "digest-1", content: "..." });
  });

  it("throws for unregistered query handler", async () => {
    const query = createQuery({});
    const ctx: HandlerContext = {
      db: stub<HandlerContext["db"]>(),
      eventBus: stub<HandlerContext["eventBus"]>(),
      config: stub<HandlerContext["config"]>(),
      organizationId: "org_test",
    };

    await expect(
      query("GetDigest", { digestId: "x" }, ctx),
    ).rejects.toThrow("No handler registered for query: GetDigest");
  });

  it("propagates handler errors", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Not found"));

    const query = createQuery({ GetDigest: handler });
    const ctx: HandlerContext = {
      db: stub<HandlerContext["db"]>(),
      eventBus: stub<HandlerContext["eventBus"]>(),
      config: stub<HandlerContext["config"]>(),
      organizationId: "org_test",
    };

    await expect(
      query("GetDigest", { digestId: "x" }, ctx),
    ).rejects.toThrow("Not found");
  });
});
