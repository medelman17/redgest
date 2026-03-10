// packages/mcp-server/src/stdio.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bootstrap } from "./bootstrap.js";
import { createToolServer } from "./tools.js";

async function main() {
  const deps = await bootstrap();
  const server = createToolServer(deps);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await deps.db.$disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await deps.db.$disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start MCP stdio server:", err);
  process.exit(1);
});
