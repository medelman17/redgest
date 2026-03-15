import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FormattedDigest } from "../types.js";

const mockSend = vi.fn();

// Mock resend with a class-based implementation
vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      apiKey: string;
      emails = { send: mockSend };
      constructor(apiKey: string) {
        this.apiKey = apiKey;
      }
    },
  };
});

// Mock the render module (send.ts now delegates rendering to render.ts)
vi.mock("../render.js", () => ({
  renderDigestHtml: vi.fn().mockResolvedValue("<html>rendered</html>"),
}));

function makeDigest(): FormattedDigest {
  return {
    createdAt: new Date("2026-03-10T12:00:00Z"),
    headline: "Today's top posts across your subreddits.",
    sections: [
      {
        subreddit: "typescript",
        body: "TypeScript community highlights.",
        posts: [
          {
            title: "Test Post",
            permalink: "/r/typescript/comments/abc/test",
            score: 100,
          },
        ],
      },
    ],
  };
}

describe("sendDigestEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends email via Resend with correct params", async () => {
    mockSend.mockResolvedValueOnce({
      data: { id: "email-123" },
      error: null,
    });

    const { sendDigestEmail } = await import("../send.js");
    const result = await sendDigestEmail(
      makeDigest(),
      "user@example.com",
      "re_test_key",
    );

    expect(result).toEqual({ id: "email-123" });
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Redgest <redgest@mail.edel.sh>",
        to: "user@example.com",
        subject: "Reddit Digest — 2026-03-10",
        html: "<html>rendered</html>",
      }),
    );
  });

  it("throws when Resend returns an error", async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid API key", name: "validation_error" },
    });

    const { sendDigestEmail } = await import("../send.js");
    await expect(
      sendDigestEmail(makeDigest(), "user@example.com", "bad-key"),
    ).rejects.toThrow("Resend error: Invalid API key");
  });

  it("throws when Resend returns no data", async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const { sendDigestEmail } = await import("../send.js");
    await expect(
      sendDigestEmail(makeDigest(), "user@example.com", "re_test_key"),
    ).rejects.toThrow("Resend returned no data");
  });
});
