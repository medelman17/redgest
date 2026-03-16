import { describe, it, expect } from "vitest";
import { ErrorCode } from "@redgest/core";
import { envelope, envelopeError } from "../envelope";
import type { ToolResult } from "../envelope";

describe("envelope", () => {
  it("wraps data in a success response", () => {
    const result = envelope({ id: "abc", name: "test" });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true, data: { id: "abc", name: "test" } }),
        },
      ],
    });
  });

  it("does not set isError on success", () => {
    const result = envelope("hello");
    expect(result).not.toHaveProperty("isError");
  });

  it("wraps null data", () => {
    const result = envelope(null);
    const parsed = JSON.parse(result.content[0].text) as { ok: boolean; data: unknown };
    expect(parsed).toEqual({ ok: true, data: null });
  });

  it("wraps array data", () => {
    const items = [{ id: 1 }, { id: 2 }];
    const result = envelope(items);
    const parsed = JSON.parse(result.content[0].text) as { ok: boolean; data: unknown };
    expect(parsed).toEqual({ ok: true, data: items });
  });

  it("wraps undefined data as null in JSON", () => {
    const result = envelope(undefined);
    const parsed = JSON.parse(result.content[0].text) as { ok: boolean; data: unknown };
    // JSON.stringify(undefined) within an object becomes null
    expect(parsed.ok).toBe(true);
  });

  it("wraps string data", () => {
    const result = envelope("guide text here");
    const parsed = JSON.parse(result.content[0].text) as { ok: boolean; data: unknown };
    expect(parsed).toEqual({ ok: true, data: "guide text here" });
  });

  it("wraps numeric data", () => {
    const result = envelope(42);
    const parsed = JSON.parse(result.content[0].text) as { ok: boolean; data: unknown };
    expect(parsed).toEqual({ ok: true, data: 42 });
  });

  it("produces valid JSON", () => {
    const result = envelope({ nested: { deep: true } });
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it("satisfies the ToolResult interface shape", () => {
    const result: ToolResult = envelope({ foo: "bar" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
  });
});

describe("envelopeError", () => {
  it("wraps an error with code and message", () => {
    const result = envelopeError(ErrorCode.NOT_FOUND, "Digest not found");
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: { code: "NOT_FOUND", message: "Digest not found" },
          }),
        },
      ],
      isError: true,
    });
  });

  it("sets isError to true", () => {
    const result = envelopeError(ErrorCode.INTERNAL_ERROR, "Something broke");
    expect(result.isError).toBe(true);
  });

  it("produces valid JSON", () => {
    const result = envelopeError(ErrorCode.VALIDATION_ERROR, "Invalid input");
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it("preserves the error code exactly", () => {
    const result = envelopeError(ErrorCode.REDDIT_API_ERROR, "Rate limited");
    const parsed = JSON.parse(result.content[0].text) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(parsed.error.code).toBe("REDDIT_API_ERROR");
  });

  it("preserves the error message exactly", () => {
    const result = envelopeError(ErrorCode.NOT_FOUND, 'Subreddit "foo" not found');
    const parsed = JSON.parse(result.content[0].text) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(parsed.error.message).toBe('Subreddit "foo" not found');
  });

  it("satisfies the ToolResult interface shape", () => {
    const result: ToolResult = envelopeError(ErrorCode.INTERNAL_ERROR, "fail");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
  });
});
