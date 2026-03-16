import { describe, it, expect } from "vitest";
import { RedgestError, ErrorCode } from "../errors";

describe("ErrorCode", () => {
  it("contains all expected error codes", () => {
    const codes = Object.values(ErrorCode);
    expect(codes).toContain("NOT_FOUND");
    expect(codes).toContain("VALIDATION_ERROR");
    expect(codes).toContain("CONFLICT");
    expect(codes).toContain("INTERNAL_ERROR");
    expect(codes).toContain("REDDIT_API_ERROR");
    expect(codes).toContain("SCHEMA_VALIDATION_FAILED");
    expect(codes).toContain("JSON_PARSE_FAILED");
    expect(codes).toContain("INVALID_POST_INDICES");
    expect(codes).toContain("WRONG_SELECTION_COUNT");
    expect(codes).toContain("CONTENT_POLICY_REFUSAL");
    expect(codes).toContain("API_TIMEOUT");
    expect(codes).toContain("RATE_LIMITED");
    expect(codes).toContain("PROVIDER_ERROR");
    expect(codes).toContain("ALL_RETRIES_EXHAUSTED");
  });
});

describe("RedgestError", () => {
  it("creates an error with code and message", () => {
    const err = new RedgestError(ErrorCode.NOT_FOUND, "Subreddit not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Subreddit not found");
    expect(err.name).toBe("RedgestError");
  });

  it("includes optional details", () => {
    const err = new RedgestError(ErrorCode.VALIDATION_ERROR, "Invalid input", {
      field: "name",
      reason: "too short",
    });
    expect(err.details).toEqual({ field: "name", reason: "too short" });
  });

  it("includes optional cause", () => {
    const cause = new Error("original");
    const err = new RedgestError(ErrorCode.INTERNAL_ERROR, "Wrapped", undefined, cause);
    expect(err.cause).toBe(cause);
  });

  it("serializes to JSON for MCP response envelope", () => {
    const err = new RedgestError(ErrorCode.NOT_FOUND, "Digest not found", { id: "abc" });
    const json = err.toJSON();
    expect(json).toEqual({
      code: "NOT_FOUND",
      message: "Digest not found",
      details: { id: "abc" },
    });
  });
});
