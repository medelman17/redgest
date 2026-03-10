import { describe, it, expect, vi } from "vitest";

// Mock bootstrap to avoid real DB/Reddit connections
vi.mock("../bootstrap.js", () => ({
  bootstrap: vi.fn().mockResolvedValue({
    execute: vi.fn(),
    query: vi.fn(),
    ctx: {
      db: {},
      eventBus: { on: vi.fn(), emitEvent: vi.fn() },
      config: {},
    },
    config: {
      MCP_SERVER_PORT: 3100,
      MCP_SERVER_API_KEY: "a".repeat(32),
    },
    db: { $disconnect: vi.fn() },
  }),
}));

// Mock tools to avoid McpServer creation issues in test
vi.mock("../tools.js", () => ({
  createToolServer: vi.fn().mockReturnValue({
    connect: vi.fn(),
  }),
}));

import { createApp } from "../http.js";

describe("HTTP server", () => {
  it("GET /health returns 200 without auth", async () => {
    const { app } = await createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("POST /mcp without auth returns 401", async () => {
    const { app } = await createApp();
    const res = await app.request("/mcp", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /mcp with valid auth does not return 401", async () => {
    const { app } = await createApp();
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"a".repeat(32)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {},
      }),
    });
    // May not be 200 (MCP protocol handling), but should NOT be 401
    expect(res.status).not.toBe(401);
  });
});
