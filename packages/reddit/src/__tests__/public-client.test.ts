import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PublicRedditClient } from "../public-client.js";
import type { ConnectionTestResult } from "../client.js";

const USER_AGENT = "redgest:test:v0.0.1";

function mockApiResponse(data: unknown = { result: "ok" }) {
  return new Response(JSON.stringify(data), {
    status: 200,
    statusText: "OK",
  });
}

function mockErrorResponse(status: number, statusText: string = "Error") {
  return new Response(JSON.stringify({ error: statusText }), {
    status,
    statusText,
  });
}

describe("PublicRedditClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: PublicRedditClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new PublicRedditClient({ userAgent: USER_AGENT });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("authenticate", () => {
    it("resolves without error (no-op)", async () => {
      await expect(client.authenticate()).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("isAuthenticated", () => {
    it("returns true always", () => {
      expect(client.isAuthenticated()).toBe(true);
    });
  });

  describe("get", () => {
    it("builds correct .json URL for simple path", async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ data: "ok" }));

      await client.get("/r/typescript/hot");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/r/typescript/hot.json",
        expect.objectContaining({
          headers: { "User-Agent": USER_AGENT },
        }),
      );
    });

    it("inserts .json before query string", async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ data: "ok" }));

      await client.get("/r/typescript/hot?limit=25");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/r/typescript/hot.json?limit=25",
        expect.any(Object),
      );
    });

    it("handles comments path with query params", async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse([{}, {}]));

      await client.get("/r/typescript/comments/abc123?limit=10&sort=top");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/r/typescript/comments/abc123.json?limit=10&sort=top",
        expect.any(Object),
      );
    });

    it("passes through absolute URLs unchanged", async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ data: "ok" }));

      await client.get("https://example.com/some/path");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/some/path",
        expect.any(Object),
      );
    });

    it("returns parsed JSON response", async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ kind: "Listing" }));

      const result = await client.get<{ kind: string }>("/r/test/hot");

      expect(result).toEqual({ kind: "Listing" });
    });

    it("sets User-Agent header on all requests", async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse());

      await client.get("/r/test/hot");

      const callArgs = mockFetch.mock.calls[0];
      if (!callArgs) throw new Error("Expected fetch to have been called");
      expect(callArgs[1].headers["User-Agent"]).toBe(USER_AGENT);
    });
  });

  describe("error handling", () => {
    it("throws REDDIT_API_ERROR on 403", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));

      await expect(client.get("/r/test/hot")).rejects.toThrow(
        expect.objectContaining({ code: "REDDIT_API_ERROR" }),
      );
    });

    it("throws RATE_LIMITED on 429", async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(429, "Too Many Requests"),
      );

      await expect(client.get("/r/test/hot")).rejects.toThrow(
        expect.objectContaining({ code: "RATE_LIMITED" }),
      );
    });

    it("throws REDDIT_API_ERROR on other non-ok status", async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(500, "Internal Server Error"),
      );

      await expect(client.get("/r/test/hot")).rejects.toThrow(
        expect.objectContaining({ code: "REDDIT_API_ERROR" }),
      );
    });
  });

  describe("testConnection", () => {
    it("returns ok:true with authType 'public' when API responds", async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ kind: "Listing" }));

      const result: ConnectionTestResult = await client.testConnection();

      expect(result.ok).toBe(true);
      expect(result.authType).toBe("public");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("fetches r/all.json for connectivity test", async () => {
      mockFetch.mockResolvedValueOnce(mockApiResponse({ kind: "Listing" }));

      await client.testConnection();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/r/all.json?limit=1",
        expect.objectContaining({
          headers: { "User-Agent": USER_AGENT },
        }),
      );
    });

    it("returns ok:false with error when API call fails", async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));

      const result = await client.testConnection();

      expect(result.ok).toBe(false);
      expect(result.authType).toBe("public");
      expect(result.error).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns ok:false when fetch throws network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await client.testConnection();

      expect(result.ok).toBe(false);
      expect(result.authType).toBe("public");
      expect(result.error).toContain("Network error");
    });
  });
});
