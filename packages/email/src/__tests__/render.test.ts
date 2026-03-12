import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock react-email render
vi.mock("@react-email/components", () => ({
  render: vi.fn().mockResolvedValue("<html>rendered</html>"),
}));

// Mock the template module
vi.mock("../template.js", () => ({
  DigestEmail: vi.fn().mockReturnValue(null),
}));

import type { DigestDeliveryData } from "../types.js";

function makeDigest(): DigestDeliveryData {
  return {
    digestId: "digest-001",
    createdAt: new Date("2026-03-10T12:00:00Z"),
    subreddits: [
      {
        name: "typescript",
        posts: [
          {
            title: "Test Post",
            permalink: "/r/typescript/comments/abc/test",
            score: 100,
            summary: "A test post.",
            keyTakeaways: ["takeaway"],
            insightNotes: "notes",
            commentHighlights: [],
          },
        ],
      },
    ],
  };
}

describe("renderDigestHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rendered HTML string", async () => {
    const { renderDigestHtml } = await import("../render.js");
    const html = await renderDigestHtml(makeDigest());
    expect(typeof html).toBe("string");
    expect(html).toContain("html");
  });

  it("calls render with DigestEmail component", async () => {
    const { render } = await import("@react-email/components");
    const { renderDigestHtml } = await import("../render.js");
    await renderDigestHtml(makeDigest());
    expect(render).toHaveBeenCalledOnce();
  });
});
