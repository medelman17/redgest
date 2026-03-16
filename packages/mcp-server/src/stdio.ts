import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bootstrap } from "./bootstrap";
import { createToolServer } from "./tools";

async function main() {
  const deps = await bootstrap();
  const server = createToolServer(deps);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
      await deps.db.$disconnect();
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start MCP stdio server:", err);
  process.exit(1);
});
