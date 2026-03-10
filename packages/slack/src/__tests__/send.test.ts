import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DigestDeliveryData } from "@redgest/email";
import { sendDigestSlack } from "../send.js";

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
            summary: "A test post summary.",
            keyTakeaways: ["takeaway"],
            insightNotes: "notes",
            commentHighlights: [],
          },
        ],
      },
    ],
  };
}

const mockFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();

describe("sendDigestSlack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("calls fetch with correct URL, method, headers, and body", async () => {
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await sendDigestSlack(makeDigest(), "https://hooks.slack.com/test");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/test");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(init.body as string) as { blocks: unknown[] };
    expect(body.blocks).toBeDefined();
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("channel_not_found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      sendDigestSlack(makeDigest(), "https://hooks.slack.com/bad"),
    ).rejects.toThrow("Slack webhook error: 404 Not Found");
  });

  it("resolves without error on successful response", async () => {
    mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await expect(
      sendDigestSlack(makeDigest(), "https://hooks.slack.com/test"),
    ).resolves.toBeUndefined();
  });
});
