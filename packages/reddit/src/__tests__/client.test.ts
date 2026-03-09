import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RedditClient } from "../client.js";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const USER_AGENT = "redgest:test:v0.0.1";

function mockTokenResponse() {
  return new Response(
    JSON.stringify({
      access_token: "mock-access-token",
      token_type: "bearer",
      expires_in: 3600,
    }),
    { status: 200, statusText: "OK" },
  );
}

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

describe("RedditClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let client: RedditClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new RedditClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      userAgent: USER_AGENT,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("authenticate", () => {
    it("obtains access token via script-type OAuth2", async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await client.authenticate();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://www.reddit.com/api/v1/access_token",
        expect.objectContaining({
          method: "POST",
          body: "grant_type=client_credentials",
        }),
      );
    });

    it("sets Authorization header with Basic auth", async () => {
      mockFetch.mockResolvedValueOnce(mockTokenResponse());

      await client.authenticate();

      const callArgs = mockFetch.mock.calls[0];
      if (!callArgs) throw new Error("Expected fetch to have been called");
      const headers = callArgs[1].headers;
      const expectedCredentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
      expect(headers["Authorization"]).toBe(`Basic ${expectedCredentials}`);
      expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      expect(headers["User-Agent"]).toBe(USER_AGENT);
    });

    it("stores token so isAuthenticated() returns true", async () => {
      expect(client.isAuthenticated()).toBe(false);

      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await client.authenticate();

      expect(client.isAuthenticated()).toBe(true);
    });
  });

  describe("error handling", () => {
    it("throws REDDIT_API_ERROR on 403", async () => {
      // Authenticate first
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await client.authenticate();

      // Then return 403 on API call
      mockFetch.mockResolvedValueOnce(mockErrorResponse(403, "Forbidden"));

      await expect(client.get("/r/test/hot")).rejects.toThrow(
        expect.objectContaining({ code: "REDDIT_API_ERROR" }),
      );
    });

    it("throws RATE_LIMITED on 429", async () => {
      // Authenticate first
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await client.authenticate();

      // Then return 429 on API call
      mockFetch.mockResolvedValueOnce(mockErrorResponse(429, "Too Many Requests"));

      await expect(client.get("/r/test/hot")).rejects.toThrow(
        expect.objectContaining({ code: "RATE_LIMITED" }),
      );
    });

    it("re-authenticates on 401 and retries once", async () => {
      // Initial authenticate
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      await client.authenticate();

      // API call returns 401
      mockFetch.mockResolvedValueOnce(mockErrorResponse(401, "Unauthorized"));
      // Re-authenticate
      mockFetch.mockResolvedValueOnce(mockTokenResponse());
      // Retry API call succeeds
      mockFetch.mockResolvedValueOnce(mockApiResponse({ data: "success" }));

      const result = await client.get("/r/test/hot");

      expect(result).toEqual({ data: "success" });
      // 1 initial auth + 1 failed API call + 1 re-auth + 1 retry = 4 total
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });
});
