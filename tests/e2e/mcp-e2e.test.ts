import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getTestDb, truncateAll, teardownTestDb } from "../helpers/db.js";
import type { PrismaClient } from "@redgest/db";
import { resolve } from "node:path";

let client: Client;
let transport: StdioClientTransport;
let db: PrismaClient;

// ── Helpers ──────────────────────────────────────────────────

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  const textContent = result.content as Array<{ type: string; text: string }>;
  const text = textContent.find((c) => c.type === "text")?.text ?? "";
  return JSON.parse(text);
}

// ── Setup / Teardown ─────────────────────────────────────────

beforeAll(async () => {
  db = await getTestDb();
  await truncateAll(db);

  // Spawn MCP server as child process with test mode enabled.
  // tsx runs TypeScript directly — the bootstrap swaps in fake content
  // source and fake LLM when REDGEST_TEST_MODE=1.
  const serverPath = resolve("packages/mcp-server/src/stdio.ts");

  transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", serverPath],
    env: {
      ...process.env,
      REDGEST_TEST_MODE: "1",
      // loadConfig() validates these — provide placeholders since
      // test mode never actually calls Reddit or Anthropic APIs.
      REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID || "test-client-id",
      REDDIT_CLIENT_SECRET:
        process.env.REDDIT_CLIENT_SECRET || "test-client-secret",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "test-anthropic-key",
      TRIGGER_SECRET_KEY:
        process.env.TRIGGER_SECRET_KEY || "test-trigger-secret",
      MCP_SERVER_API_KEY:
        process.env.MCP_SERVER_API_KEY ||
        "test-mcp-api-key-that-is-at-least-32-chars-long",
    },
  });

  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  try {
    await client.close();
  } catch {
    // Child process may already be gone
  }
  await teardownTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
});

// ── Tests ────────────────────────────────────────────────────

describe("MCP server E2E via stdio", () => {
  it("lists all 15 tools", async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(15);

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("generate_digest");
    expect(toolNames).toContain("add_subreddit");
    expect(toolNames).toContain("get_digest");
    expect(toolNames).toContain("get_run_status");
    expect(toolNames).toContain("list_subreddits");
    expect(toolNames).toContain("list_digests");
    expect(toolNames).toContain("use_redgest");
    expect(toolNames).toContain("search_posts");
    expect(toolNames).toContain("search_digests");
    expect(toolNames).toContain("get_post");
    expect(toolNames).toContain("list_runs");
    expect(toolNames).toContain("remove_subreddit");
    expect(toolNames).toContain("update_subreddit");
    expect(toolNames).toContain("get_config");
    expect(toolNames).toContain("update_config");
  });

  it("full pipeline: add_subreddit -> generate_digest -> poll status -> get_digest", async () => {
    // 1. Add a subreddit
    const addResult = await callTool("add_subreddit", {
      name: "typescript",
      insightPrompt: "Focus on new TypeScript features and patterns",
    });
    expect(addResult.ok).toBe(true);
    const subredditId = addResult.data.subredditId;
    expect(subredditId).toBeDefined();

    // 2. Generate digest
    const genResult = await callTool("generate_digest", {
      subreddits: [subredditId],
    });
    expect(genResult.ok).toBe(true);
    const jobId = genResult.data.jobId;
    expect(jobId).toBeDefined();

    // 3. Poll run status until complete (or timeout)
    let status = "QUEUED";
    for (let i = 0; i < 30; i++) {
      const statusResult = await callTool("get_run_status", { jobId });
      expect(statusResult.ok).toBe(true);
      status = statusResult.data.status;
      if (
        status === "COMPLETED" ||
        status === "FAILED" ||
        status === "PARTIAL"
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(status).toBe("COMPLETED");

    // 4. Get the latest digest (no digestId = latest)
    const digestResult = await callTool("get_digest");
    expect(digestResult.ok).toBe(true);
    expect(digestResult.data.contentMarkdown).toContain("Test Post");
    expect(digestResult.data.jobId).toBe(jobId);

    // 5. List digests
    const listResult = await callTool("list_digests");
    expect(listResult.ok).toBe(true);
    expect(listResult.data.length).toBeGreaterThanOrEqual(1);

    // 6. List subreddits
    const subsResult = await callTool("list_subreddits");
    expect(subsResult.ok).toBe(true);
    expect(subsResult.data.length).toBe(1);
    expect(subsResult.data[0].name).toBe("typescript");
  }, 60_000);
});
