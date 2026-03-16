import { describe, it, expect } from "vitest";
import { isPublicPath } from "../lib/route-matching";

describe("isPublicPath", () => {
  it("allows auth routes", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/signup")).toBe(true);
    expect(isPublicPath("/api/auth/session")).toBe(true);
    expect(isPublicPath("/api/auth/sign-in/email")).toBe(true);
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/invite/abc123")).toBe(true);
  });

  it("blocks protected routes", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/subreddits")).toBe(false);
  });
});
