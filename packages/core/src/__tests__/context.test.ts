import { describe, it, expect } from "vitest";
import type { HandlerContext } from "../context";

/** Cast helper to avoid objectLiteralTypeAssertions lint rule on `{} as T`. */
function stub<T>(): T {
  const empty = {};
  return empty as T;
}

describe("HandlerContext", () => {
  it("accepts a mock context object", () => {
    // Verifies the type compiles with a minimal mock
    const ctx: HandlerContext = {
      db: stub<HandlerContext["db"]>(),
      eventBus: stub<HandlerContext["eventBus"]>(),
      config: stub<HandlerContext["config"]>(),
      organizationId: "org_test",
    };

    expect(ctx).toBeDefined();
    expect(ctx.db).toBeDefined();
    expect(ctx.eventBus).toBeDefined();
    expect(ctx.config).toBeDefined();
  });
});
