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

  await mcpServer.connect(transport);

  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.use("/mcp", bearerAuthMiddleware(deps.config.MCP_SERVER_API_KEY));
  app.all("/mcp", (c) => transport.handleRequest(c));

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
