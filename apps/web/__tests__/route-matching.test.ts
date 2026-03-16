import { describe, it, expect } from "vitest";
import { isPublicPath, isAuthOnlyPath } from "../lib/route-matching";

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

describe("isAuthOnlyPath", () => {
  it("matches login/signup/forgot-password", () => {
    expect(isAuthOnlyPath("/login")).toBe(true);
    expect(isAuthOnlyPath("/signup")).toBe(true);
    expect(isAuthOnlyPath("/forgot-password")).toBe(true);
  });

  it("does not match reset-password or invite (may need auth)", () => {
    expect(isAuthOnlyPath("/reset-password")).toBe(false);
    expect(isAuthOnlyPath("/invite/abc")).toBe(false);
  });

  it("does not match protected routes", () => {
    expect(isAuthOnlyPath("/dashboard")).toBe(false);
    expect(isAuthOnlyPath("/settings")).toBe(false);
  });
});
