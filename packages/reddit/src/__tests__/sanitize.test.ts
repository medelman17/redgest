import { describe, it, expect } from "vitest";
import { sanitizeContent } from "../sanitize.js";

describe("sanitizeContent", () => {
  it("strips opening HTML/XML tags", () => {
    expect(sanitizeContent("hello <system> world")).toBe("hello  world");
  });

  it("strips closing tags", () => {
    expect(sanitizeContent("hello </tool_use> world")).toBe("hello  world");
  });

  it("strips self-closing tags", () => {
    expect(sanitizeContent("hello <br/> world")).toBe("hello  world");
  });

  it("strips tags with attributes", () => {
    expect(sanitizeContent('<div class="foo">content</div>')).toBe("content");
  });

  it("preserves angle brackets in non-tag contexts", () => {
    expect(sanitizeContent("x < y and y > z")).toBe("x < y and y > z");
  });

  it("preserves markdown", () => {
    const md = "**bold** and `code` and [link](url)";
    expect(sanitizeContent(md)).toBe(md);
  });

  it("preserves URLs", () => {
    expect(sanitizeContent("https://example.com/path?a=1&b=2")).toBe(
      "https://example.com/path?a=1&b=2",
    );
  });

  it("handles empty string", () => {
    expect(sanitizeContent("")).toBe("");
  });

  it("strips multiple tags in sequence", () => {
    expect(sanitizeContent("<b><i>text</i></b>")).toBe("text");
  });
});
