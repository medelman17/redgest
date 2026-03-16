import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { bearerAuthMiddleware } from "../auth";

const TEST_API_KEY = "test-api-key-that-is-at-least-32-characters-long";

function createTestApp(apiKey: string) {
  const app = new Hono();
  app.use("/mcp/*", bearerAuthMiddleware(apiKey));
  app.post("/mcp/test", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  return app;
}

describe("bearerAuthMiddleware", () => {
  it("passes request with valid bearer token", async () => {
    const app = createTestApp(TEST_API_KEY);
    const res = await app.request("/mcp/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 401 when Authorization header is missing", async () => {
    const app = createTestApp(TEST_API_KEY);
    const res = await app.request("/mcp/test", {
      method: "POST",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid authorization",
      },
    });
  });

  it("returns 401 when token is wrong", async () => {
    const app = createTestApp(TEST_API_KEY);
    const res = await app.request("/mcp/test", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid authorization",
      },
    });
  });

  it("returns 401 when scheme is not Bearer", async () => {
    const app = createTestApp(TEST_API_KEY);
    const res = await app.request("/mcp/test", {
      method: "POST",
      headers: { Authorization: `Basic ${TEST_API_KEY}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid authorization",
      },
    });
  });

  it("does not affect routes outside /mcp/*", async () => {
    const app = createTestApp(TEST_API_KEY);
    const res = await app.request("/health", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
