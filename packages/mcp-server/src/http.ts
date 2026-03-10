import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { bootstrap } from "./bootstrap.js";
import { createToolServer } from "./tools.js";
import { bearerAuthMiddleware } from "./auth.js";

/**
 * Create the Hono app with MCP server mounted.
 * Exported for testing; the bottom block starts the server when run directly.
 */
export async function createApp() {
  const deps = await bootstrap();
  const mcpServer = createToolServer(deps);
  const transport = new StreamableHTTPTransport();

  const app = new Hono();

  // Health check — no auth
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Auth on MCP routes
  app.use("/mcp", bearerAuthMiddleware(deps.config.MCP_SERVER_API_KEY));

  // MCP endpoint (Streamable HTTP transport handles POST/GET/DELETE)
  app.all("/mcp", async (c) => {
    if (!mcpServer.isConnected()) {
      await mcpServer.connect(transport);
    }
    const response = await transport.handleRequest(c);
    if (response) {
      return response;
    }
    return c.json(
      { ok: false, error: { code: "MCP_ERROR", message: "Transport returned no response" } },
      500,
    );
  });

  return app;
}

// Start server when run directly
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMainModule) {
  const { serve } = await import("@hono/node-server");
  const app = await createApp();
  const port = Number(process.env.MCP_SERVER_PORT ?? 3100);
  serve({ fetch: app.fetch, port }, () => {
    console.warn(`Redgest MCP server listening on port ${port}`);
  });
}
