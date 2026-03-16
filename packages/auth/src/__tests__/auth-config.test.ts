import { describe, it, expect, vi } from "vitest";

vi.mock("@redgest/db", () => ({ prisma: {} }));

describe("auth config", () => {
  it("exports auth instance with expected shape", async () => {
    const mod = await import("../auth.js");
    expect(mod.auth).toBeDefined();
    expect(mod.auth.handler).toBeDefined();
  });

  it("exports type helpers — auth has $Infer as compile-time type only", async () => {
    const mod = await import("../auth.js");
    // $Infer is a type-level property only; at runtime the auth instance
    // exposes api, handler, and options
    expect(mod.auth.api).toBeDefined();
    expect(mod.auth.options).toBeDefined();
  });
});
