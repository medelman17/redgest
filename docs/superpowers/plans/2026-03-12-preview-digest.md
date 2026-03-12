# preview_digest Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `preview_digest` MCP tool that renders a digest in markdown, email HTML, or Slack Block Kit format without sending it.

**Architecture:** Extract shared transform + render functions from the worker into `@redgest/email`, then add a tool-level handler in `@redgest/mcp-server` that loads digest relations, transforms, and renders per channel. No CQRS query changes needed.

**Tech Stack:** TypeScript, React Email (`@react-email/components`), Slack Block Kit, Prisma, Vitest

**Spec:** `docs/superpowers/specs/2026-03-12-preview-digest-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/email/src/transform.ts` | Create | `DigestWithRelations` type + `buildDeliveryData()` function |
| `packages/email/src/render.ts` | Create | `renderDigestHtml()` — React Email render without sending |
| `packages/email/src/send.ts` | Modify | Use `renderDigestHtml()` internally (DRY) |
| `packages/email/src/index.ts` | Modify | Export new functions/types |
| `packages/email/src/__tests__/transform.test.ts` | Create | Tests for `buildDeliveryData()` |
| `packages/email/src/__tests__/render.test.ts` | Create | Tests for `renderDigestHtml()` |
| `apps/worker/src/trigger/deliver-digest.ts` | Modify | Import `buildDeliveryData()` instead of inline logic |
| `packages/mcp-server/package.json` | Modify | Add `@redgest/email` + `@redgest/slack` deps |
| `packages/mcp-server/tsconfig.json` | Modify | Add `"jsx": "react-jsx"` |
| `packages/mcp-server/src/tools.ts` | Modify | Add `preview_digest` handler + server registration + USAGE_GUIDE |
| `packages/mcp-server/src/__tests__/tools.test.ts` | Modify | Add `preview_digest` tests |

---

## Task 1: Extract `buildDeliveryData()` into `@redgest/email`

**Files:**
- Create: `packages/email/src/transform.ts`
- Create: `packages/email/src/__tests__/transform.test.ts`
- Modify: `packages/email/src/index.ts`

### Step 1.1: Write failing tests for buildDeliveryData

- [ ] Create `packages/email/src/__tests__/transform.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildDeliveryData, type DigestWithRelations } from "../transform.js";

function makeDigestWithRelations(
  overrides?: Partial<DigestWithRelations>,
): DigestWithRelations {
  return {
    id: "digest-001",
    createdAt: new Date("2026-03-10T12:00:00Z"),
    digestPosts: [
      {
        rank: 1,
        subreddit: "typescript",
        post: {
          title: "TS 6.0 Released",
          permalink: "/r/typescript/comments/abc/ts-60",
          score: 250,
          summaries: [
            {
              summary: "TypeScript 6.0 adds new features.",
              keyTakeaways: JSON.stringify(["Better types", "Faster compiler"]),
              insightNotes: "Major release",
              commentHighlights: JSON.stringify([
                { author: "dev1", insight: "Great update", score: 50 },
              ]),
            },
          ],
        },
      },
      {
        rank: 2,
        subreddit: "typescript",
        post: {
          title: "TS Tips",
          permalink: "/r/typescript/comments/def/tips",
          score: 100,
          summaries: [
            {
              summary: "Helpful tips for TS.",
              keyTakeaways: JSON.stringify(["Use strict"]),
              insightNotes: "",
              commentHighlights: JSON.stringify([]),
            },
          ],
        },
      },
      {
        rank: 3,
        subreddit: "rust",
        post: {
          title: "Rust 2026",
          permalink: "/r/rust/comments/ghi/rust-2026",
          score: 300,
          summaries: [
            {
              summary: "Rust edition 2026.",
              keyTakeaways: JSON.stringify([]),
              insightNotes: "Edition release",
              commentHighlights: JSON.stringify([]),
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe("buildDeliveryData", () => {
  it("transforms digest with relations into DigestDeliveryData", () => {
    const input = makeDigestWithRelations();
    const result = buildDeliveryData(input);

    expect(result.digestId).toBe("digest-001");
    expect(result.createdAt).toEqual(new Date("2026-03-10T12:00:00Z"));
    expect(result.subreddits).toHaveLength(2);
  });

  it("groups posts by subreddit", () => {
    const input = makeDigestWithRelations();
    const result = buildDeliveryData(input);

    const ts = result.subreddits.find((s) => s.name === "typescript");
    expect(ts).toBeDefined();
    if (!ts) return;
    expect(ts.posts).toHaveLength(2);

    const rust = result.subreddits.find((s) => s.name === "rust");
    expect(rust).toBeDefined();
    if (!rust) return;
    expect(rust.posts).toHaveLength(1);
  });

  it("parses JSON fields from summaries", () => {
    const input = makeDigestWithRelations();
    const result = buildDeliveryData(input);

    const ts = result.subreddits.find((s) => s.name === "typescript");
    expect(ts).toBeDefined();
    if (!ts) return;
    const firstPost = ts.posts[0];
    expect(firstPost).toBeDefined();
    if (!firstPost) return;
    expect(firstPost.keyTakeaways).toEqual(["Better types", "Faster compiler"]);
    expect(firstPost.commentHighlights).toEqual([
      { author: "dev1", insight: "Great update", score: 50 },
    ]);
  });

  it("skips posts without summaries", () => {
    const input = makeDigestWithRelations({
      digestPosts: [
        {
          rank: 1,
          subreddit: "typescript",
          post: {
            title: "No Summary",
            permalink: "/r/typescript/comments/xyz/no-summary",
            score: 10,
            summaries: [],
          },
        },
      ],
    });
    const result = buildDeliveryData(input);

    // No subreddits should appear since the only post had no summary
    expect(result.subreddits).toHaveLength(0);
  });

  it("handles empty digestPosts", () => {
    const input = makeDigestWithRelations({ digestPosts: [] });
    const result = buildDeliveryData(input);

    expect(result.subreddits).toHaveLength(0);
  });

  it("maps post fields correctly", () => {
    const input = makeDigestWithRelations();
    const result = buildDeliveryData(input);

    const rust = result.subreddits.find((s) => s.name === "rust");
    expect(rust).toBeDefined();
    if (!rust) return;
    const post = rust.posts[0];
    expect(post).toBeDefined();
    if (!post) return;
    expect(post.title).toBe("Rust 2026");
    expect(post.permalink).toBe("/r/rust/comments/ghi/rust-2026");
    expect(post.score).toBe(300);
    expect(post.summary).toBe("Rust edition 2026.");
    expect(post.insightNotes).toBe("Edition release");
  });
});
```

### Step 1.2: Run tests to verify they fail

- [ ] Run: `pnpm --filter @redgest/email exec vitest run src/__tests__/transform.test.ts`
- Expected: FAIL — `Cannot find module '../transform.js'`

### Step 1.3: Implement buildDeliveryData

- [ ] Create `packages/email/src/transform.ts`:

```typescript
import type { DigestDeliveryData } from "./types.js";

/**
 * Input type for buildDeliveryData.
 * Mirrors the Prisma query shape from deliver-digest without importing @redgest/db.
 * If schema changes affect DigestPost, Post, or PostSummary, update this type.
 */
export interface DigestWithRelations {
  id: string;
  createdAt: Date;
  digestPosts: Array<{
    rank: number;
    subreddit: string;
    post: {
      title: string;
      permalink: string;
      score: number;
      summaries: Array<{
        summary: string;
        keyTakeaways: unknown;
        insightNotes: string;
        commentHighlights: unknown;
      }>;
    };
  }>;
}

/**
 * Transform a Prisma digest with full relations into the delivery data shape
 * used by both email and Slack rendering. Posts are grouped by subreddit.
 * Posts without summaries are skipped.
 */
export function buildDeliveryData(
  digest: DigestWithRelations,
): DigestDeliveryData {
  const subredditMap = new Map<
    string,
    DigestDeliveryData["subreddits"][number]
  >();

  for (const dp of digest.digestPosts) {
    const summary = dp.post.summaries[0];
    if (!summary) continue;

    let sub = subredditMap.get(dp.subreddit);
    if (!sub) {
      sub = { name: dp.subreddit, posts: [] };
      subredditMap.set(dp.subreddit, sub);
    }

    sub.posts.push({
      title: dp.post.title,
      permalink: dp.post.permalink,
      score: dp.post.score,
      summary: summary.summary,
      keyTakeaways: summary.keyTakeaways as string[],
      insightNotes: summary.insightNotes,
      commentHighlights: summary.commentHighlights as Array<{
        author: string;
        insight: string;
        score: number;
      }>,
    });
  }

  return {
    digestId: digest.id,
    createdAt: digest.createdAt,
    subreddits: Array.from(subredditMap.values()),
  };
}
```

### Step 1.4: Run tests to verify they pass

- [ ] Run: `pnpm --filter @redgest/email exec vitest run src/__tests__/transform.test.ts`
- Expected: ALL PASS (6 tests)

### Step 1.5: Export from index.ts

- [ ] Modify `packages/email/src/index.ts` — add:

```typescript
export { buildDeliveryData, type DigestWithRelations } from "./transform.js";
```

### Step 1.6: Run full email package tests + typecheck

- [ ] Run: `pnpm --filter @redgest/email exec vitest run && pnpm --filter @redgest/email typecheck`
- Expected: ALL PASS (existing 13 tests + 6 new = 19 tests), typecheck clean

### Step 1.7: Commit

- [ ] ```bash
git add packages/email/src/transform.ts packages/email/src/__tests__/transform.test.ts packages/email/src/index.ts
git commit -m "feat(email): extract buildDeliveryData transform (#25)"
```

---

## Task 2: Add `renderDigestHtml()` to `@redgest/email`

**Files:**
- Create: `packages/email/src/render.ts`
- Create: `packages/email/src/__tests__/render.test.ts`
- Modify: `packages/email/src/send.ts`
- Modify: `packages/email/src/index.ts`

### Step 2.1: Write failing test for renderDigestHtml

- [ ] Create `packages/email/src/__tests__/render.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock react-email render
vi.mock("@react-email/components", () => ({
  render: vi.fn().mockResolvedValue("<html>rendered</html>"),
}));

// Mock the template module
vi.mock("../template.js", () => ({
  DigestEmail: vi.fn().mockReturnValue(null),
}));

import type { DigestDeliveryData } from "../types.js";

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
            summary: "A test post.",
            keyTakeaways: ["takeaway"],
            insightNotes: "notes",
            commentHighlights: [],
          },
        ],
      },
    ],
  };
}

describe("renderDigestHtml", () => {
  it("returns rendered HTML string", async () => {
    const { renderDigestHtml } = await import("../render.js");
    const html = await renderDigestHtml(makeDigest());
    expect(typeof html).toBe("string");
    expect(html).toContain("html");
  });

  it("calls render with DigestEmail component", async () => {
    const { render } = await import("@react-email/components");
    const { renderDigestHtml } = await import("../render.js");
    await renderDigestHtml(makeDigest());
    expect(render).toHaveBeenCalledOnce();
  });
});
```

### Step 2.2: Run test to verify it fails

- [ ] Run: `pnpm --filter @redgest/email exec vitest run src/__tests__/render.test.ts`
- Expected: FAIL — `Cannot find module '../render.js'`

### Step 2.3: Implement renderDigestHtml

- [ ] Create `packages/email/src/render.ts`:

```typescript
import { createElement } from "react";
import { render } from "@react-email/components";
import { DigestEmail } from "./template.js";
import type { DigestDeliveryData } from "./types.js";

/**
 * Render a digest as HTML using the DigestEmail React Email template.
 * Does NOT send — use sendDigestEmail() for delivery.
 */
export async function renderDigestHtml(
  data: DigestDeliveryData,
): Promise<string> {
  return render(createElement(DigestEmail, { digest: data }));
}
```

### Step 2.4: Run test to verify it passes

- [ ] Run: `pnpm --filter @redgest/email exec vitest run src/__tests__/render.test.ts`
- Expected: ALL PASS (2 tests)

### Step 2.5: Refactor sendDigestEmail to use renderDigestHtml

- [ ] Modify `packages/email/src/send.ts` — replace inline render with import:

Replace the entire file with:

```typescript
import { Resend } from "resend";
import type { DigestDeliveryData } from "./types.js";
import { renderDigestHtml } from "./render.js";

export async function sendDigestEmail(
  digest: DigestDeliveryData,
  recipientEmail: string,
  apiKey: string,
): Promise<{ id: string }> {
  const resend = new Resend(apiKey);
  const html = await renderDigestHtml(digest);
  const dateStr = digest.createdAt.toISOString().split("T")[0] ?? "";

  const result = await resend.emails.send({
    from: "Redgest <digest@resend.dev>",
    to: recipientEmail,
    subject: `Reddit Digest — ${dateStr}`,
    html,
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`);
  }

  if (!result.data) {
    throw new Error("Resend returned no data");
  }

  return { id: result.data.id };
}
```

### Step 2.6: Update send.test.ts mocks for refactored send.ts

- [ ] Modify `packages/email/src/__tests__/send.test.ts` — the existing test mocks `@react-email/components` and `../template.js`, but after the refactor `send.ts` no longer imports those directly. Replace those mocks with a mock of `../render.js`:

Replace the three `vi.mock(...)` blocks at the top of the file with:

```typescript
const mockSend = vi.fn();

// Mock resend with a class-based implementation
vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      apiKey: string;
      emails = { send: mockSend };
      constructor(apiKey: string) {
        this.apiKey = apiKey;
      }
    },
  };
});

// Mock the render module (send.ts now delegates rendering to render.ts)
vi.mock("../render.js", () => ({
  renderDigestHtml: vi.fn().mockResolvedValue("<html>rendered</html>"),
}));
```

### Step 2.7: Export renderDigestHtml from index.ts

(Note: Step numbering adjusted — previous version had no Step 2.6 for send.test.ts update)

- [ ] Modify `packages/email/src/index.ts` — add:

```typescript
export { renderDigestHtml } from "./render.js";
```

### Step 2.8: Run all email tests + typecheck

- [ ] Run: `pnpm --filter @redgest/email exec vitest run && pnpm --filter @redgest/email typecheck`
- Expected: ALL PASS (existing 3 send tests still pass, 2 render tests pass, 6 transform tests pass = 21 total), typecheck clean

### Step 2.9: Commit

- [ ] ```bash
git add packages/email/src/render.ts packages/email/src/__tests__/render.test.ts packages/email/src/send.ts packages/email/src/__tests__/send.test.ts packages/email/src/index.ts
git commit -m "feat(email): add renderDigestHtml for preview without sending (#25)"
```

---

## Task 3: Refactor worker to use shared `buildDeliveryData()`

**Files:**
- Modify: `apps/worker/src/trigger/deliver-digest.ts`

### Step 3.1: Replace inline transform with imported function

- [ ] Modify `apps/worker/src/trigger/deliver-digest.ts` — replace lines 4, 30-65:

Replace the full file with:

```typescript
import { task, logger } from "@trigger.dev/sdk/v3";
import { loadConfig } from "@redgest/config";
import { prisma } from "@redgest/db";
import {
  sendDigestEmail,
  buildDeliveryData,
} from "@redgest/email";
import { sendDigestSlack } from "@redgest/slack";

export const deliverDigest = task({
  id: "deliver-digest",
  retry: { maxAttempts: 3 },
  run: async (payload: { digestId: string }) => {
    const config = loadConfig();

    // Load digest with related data
    const digest = await prisma.digest.findUniqueOrThrow({
      where: { id: payload.digestId },
      include: {
        digestPosts: {
          orderBy: { rank: "asc" },
          include: {
            post: {
              include: {
                summaries: { take: 1, orderBy: { createdAt: "desc" } },
              },
            },
          },
        },
      },
    });

    const deliveryData = buildDeliveryData(digest);

    // Dispatch to configured channels
    const channels: Array<{
      name: string;
      send: () => Promise<unknown>;
    }> = [];

    if (config.RESEND_API_KEY && config.DELIVERY_EMAIL) {
      const { DELIVERY_EMAIL, RESEND_API_KEY } = config;
      channels.push({
        name: "email",
        send: () =>
          sendDigestEmail(deliveryData, DELIVERY_EMAIL, RESEND_API_KEY),
      });
    }

    if (config.SLACK_WEBHOOK_URL) {
      const webhookUrl = config.SLACK_WEBHOOK_URL;
      channels.push({
        name: "slack",
        send: () => sendDigestSlack(deliveryData, webhookUrl),
      });
    }

    if (channels.length === 0) {
      logger.info("No delivery channels configured, skipping");
      return { delivered: [] };
    }

    const results = await Promise.allSettled(
      channels.map((ch) => ch.send()),
    );

    const delivered: string[] = [];
    for (const [i, r] of results.entries()) {
      const channel = channels[i];
      if (!channel) continue;
      if (r.status === "fulfilled") {
        delivered.push(channel.name);
      } else {
        logger.error(`Delivery failed for ${channel.name}`, {
          error: String(r.reason),
        });
      }
    }

    // If all channels failed, throw so Trigger.dev retries (retry: 3)
    if (delivered.length === 0 && channels.length > 0) {
      const failures = results
        .filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        )
        .map((r) => String(r.reason));
      throw new Error(
        `All delivery channels failed: ${failures.join("; ")}`,
      );
    }

    logger.info("Delivery complete", { delivered });
    return { delivered };
  },
});
```

### Step 3.2: Typecheck worker

- [ ] Run: `pnpm --filter @redgest/worker typecheck`
- Expected: Clean (no errors)

### Step 3.3: Commit

- [ ] ```bash
git add apps/worker/src/trigger/deliver-digest.ts
git commit -m "refactor(worker): use shared buildDeliveryData from @redgest/email (#25)"
```

---

## Task 4: Add `preview_digest` MCP tool

**Files:**
- Modify: `packages/mcp-server/package.json`
- Modify: `packages/mcp-server/tsconfig.json`
- Modify: `packages/mcp-server/src/tools.ts`
- Modify: `packages/mcp-server/src/__tests__/tools.test.ts`

### Step 4.1: Add dependencies and JSX config

- [ ] Modify `packages/mcp-server/package.json` — add to `dependencies`:

```json
"@redgest/email": "workspace:*",
"@redgest/slack": "workspace:*"
```

- [ ] Modify `packages/mcp-server/tsconfig.json` — add `"jsx": "react-jsx"` to `compilerOptions`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] Run: `pnpm install` (to link new workspace deps)

### Step 4.2: Write failing tests for preview_digest handler

- [ ] Add mocks to `packages/mcp-server/src/__tests__/tools.test.ts` — at the top of the file, after existing imports (line 6):

```typescript
// Mock email rendering (preview_digest uses renderDigestHtml)
vi.mock("@redgest/email", () => ({
  buildDeliveryData: vi.fn().mockReturnValue({
    digestId: "d1",
    createdAt: new Date("2026-03-10"),
    subreddits: [{ name: "test", posts: [{ title: "Post", permalink: "/r/test/1", score: 10, summary: "Sum", keyTakeaways: [], insightNotes: "", commentHighlights: [] }] }],
  }),
  renderDigestHtml: vi.fn().mockResolvedValue("<html>preview</html>"),
}));

// Mock slack formatting (preview_digest uses formatDigestBlocks)
vi.mock("@redgest/slack", () => ({
  formatDigestBlocks: vi.fn().mockReturnValue([
    { type: "header", text: { type: "plain_text", text: "Digest", emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: "Post content" } },
  ]),
}));
```

- [ ] Add to the `use_redgest` test — find `expect(guide).toContain("list_subreddits");` and add after it:

```typescript
    expect(guide).toContain("preview_digest");
```

- [ ] Add test block at the end of the file, before the last closing:

```typescript
describe("preview_digest", () => {
  let deps: MockDeps;
  let handlers: Record<string, ToolHandler>;

  beforeEach(() => {
    deps = createMockDeps();
    handlers = createToolHandlers(deps.result);
  });

  it("returns NOT_FOUND when digest does not exist", async () => {
    deps.result.db.digestView = {
      findUnique: vi.fn().mockResolvedValue(null),
    } as unknown as typeof deps.result.db.digestView;

    const result = await invoke(handlers, "preview_digest", {
      digestId: "nonexistent",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("NOT_FOUND");
  });

  it("returns CONFLICT when digest job is still running", async () => {
    deps.result.db.digestView = {
      findUnique: vi.fn().mockResolvedValue({
        digestId: "d1",
        jobStatus: "RUNNING",
        contentMarkdown: "",
      }),
    } as unknown as typeof deps.result.db.digestView;

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("CONFLICT");
  });

  it("returns markdown content by default", async () => {
    deps.result.db.digestView = {
      findUnique: vi.fn().mockResolvedValue({
        digestId: "d1",
        jobStatus: "COMPLETED",
        contentMarkdown: "# Digest\n\nSome content",
      }),
    } as unknown as typeof deps.result.db.digestView;

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    const data = env.data as {
      channel: string;
      content: string;
      metadata: { sizeBytes: number };
    };
    expect(data.channel).toBe("markdown");
    expect(data.content).toBe("# Digest\n\nSome content");
    expect(data.metadata.sizeBytes).toBeGreaterThan(0);
  });

  it("returns email HTML when channel is email", async () => {
    deps.result.db.digestView = {
      findUnique: vi.fn().mockResolvedValue({
        digestId: "d1",
        jobStatus: "COMPLETED",
      }),
    } as unknown as typeof deps.result.db.digestView;

    deps.result.db.digest = {
      findUnique: vi.fn().mockResolvedValue({
        id: "d1",
        createdAt: new Date("2026-03-10"),
        digestPosts: [
          {
            rank: 1,
            subreddit: "test",
            post: {
              title: "Post",
              permalink: "/r/test/1",
              score: 10,
              summaries: [
                {
                  summary: "Sum",
                  keyTakeaways: JSON.stringify([]),
                  insightNotes: "",
                  commentHighlights: JSON.stringify([]),
                },
              ],
            },
          },
        ],
      }),
    } as unknown as typeof deps.result.db.digest;

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
      channel: "email",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    const data = env.data as { channel: string; content: string };
    expect(data.channel).toBe("email");
    expect(typeof data.content).toBe("string");
  });

  it("returns VALIDATION_ERROR for invalid channel", async () => {
    deps.result.db.digestView = {
      findUnique: vi.fn().mockResolvedValue({
        digestId: "d1",
        jobStatus: "COMPLETED",
        contentMarkdown: "content",
      }),
    } as unknown as typeof deps.result.db.digestView;

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
      channel: "sms",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe("VALIDATION_ERROR");
  });

  it("returns slack blocks when channel is slack", async () => {
    deps.result.db.digestView = {
      findUnique: vi.fn().mockResolvedValue({
        digestId: "d1",
        jobStatus: "COMPLETED",
      }),
    } as unknown as typeof deps.result.db.digestView;

    deps.result.db.digest = {
      findUnique: vi.fn().mockResolvedValue({
        id: "d1",
        createdAt: new Date("2026-03-10"),
        digestPosts: [
          {
            rank: 1,
            subreddit: "test",
            post: {
              title: "Post",
              permalink: "/r/test/1",
              score: 10,
              summaries: [
                {
                  summary: "Sum",
                  keyTakeaways: JSON.stringify([]),
                  insightNotes: "",
                  commentHighlights: JSON.stringify([]),
                },
              ],
            },
          },
        ],
      }),
    } as unknown as typeof deps.result.db.digest;

    const result = await invoke(handlers, "preview_digest", {
      digestId: "d1",
      channel: "slack",
    });

    const env = parseEnvelope(result);
    expect(env.ok).toBe(true);
    const data = env.data as {
      channel: string;
      content: unknown[];
      metadata: { blockCount: number; truncationWarnings: string[] };
    };
    expect(data.channel).toBe("slack");
    expect(Array.isArray(data.content)).toBe(true);
    expect(data.metadata.blockCount).toBeGreaterThan(0);
    expect(Array.isArray(data.metadata.truncationWarnings)).toBe(true);
  });
});
```

### Step 4.3: Run tests to verify they fail

- [ ] Run: `pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts`
- Expected: FAIL — `preview_digest` handler not found

### Step 4.4: Implement preview_digest handler

- [ ] Modify `packages/mcp-server/src/tools.ts`:

**Add imports** at the top (after existing imports, line 6):

```typescript
import { buildDeliveryData, renderDigestHtml } from "@redgest/email";
import { formatDigestBlocks, type SlackBlock } from "@redgest/slack";
```

**Add USAGE_GUIDE entry** — in the `USAGE_GUIDE` string, after the `get_digest` line (line 114), add:

```
- **preview_digest** — Preview a digest rendered for a specific delivery channel (markdown, email HTML, Slack blocks)
```

And in the Per-Tool Error Codes table (after the `get_digest` line, around line 158), add:

```
| preview_digest | NOT_FOUND, CONFLICT, VALIDATION_ERROR, INTERNAL_ERROR |
```

**Add handler** — in the `handlers` object inside `createToolHandlers()`, before the closing `};` of the handlers object (before line 460):

```typescript
    preview_digest: async (args) => {
      return safe(async () => {
        const digestId = args.digestId as string;
        const channel = (args.channel as string | undefined) ?? "markdown";

        if (!["markdown", "email", "slack"].includes(channel)) {
          return envelopeError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid channel: ${channel}. Must be markdown, email, or slack`,
          );
        }

        // Check digest exists and job is in terminal state
        const digestView = await deps.db.digestView.findUnique({
          where: { digestId },
        });
        if (!digestView) {
          return envelopeError(ErrorCode.NOT_FOUND, `Digest ${digestId} not found`);
        }

        const terminalStatuses = ["COMPLETED", "PARTIAL", "FAILED", "CANCELED"];
        if (!terminalStatuses.includes(digestView.jobStatus)) {
          return envelopeError(
            ErrorCode.CONFLICT,
            `Digest ${digestId} is still being generated (status: ${digestView.jobStatus})`,
          );
        }

        // Markdown channel — return stored contentMarkdown
        if (channel === "markdown") {
          const content = digestView.contentMarkdown;
          return envelope({
            channel: "markdown",
            content,
            metadata: {
              sizeBytes: Buffer.byteLength(content, "utf-8"),
            },
          });
        }

        // Email/Slack channels — load full relations and render
        const digest = await deps.db.digest.findUnique({
          where: { id: digestId },
          include: {
            digestPosts: {
              orderBy: { rank: "asc" },
              include: {
                post: {
                  include: {
                    summaries: { take: 1, orderBy: { createdAt: "desc" } },
                  },
                },
              },
            },
          },
        });

        if (!digest) {
          return envelopeError(ErrorCode.NOT_FOUND, `Digest ${digestId} not found`);
        }

        const deliveryData = buildDeliveryData(digest);

        if (channel === "email") {
          const html = await renderDigestHtml(deliveryData);
          return envelope({
            channel: "email",
            content: html,
            metadata: {
              sizeBytes: Buffer.byteLength(html, "utf-8"),
            },
          });
        }

        // Slack channel
        const blocks = formatDigestBlocks(deliveryData);
        const SLACK_BLOCK_LIMIT = 50;
        const SLACK_TEXT_LIMIT = 3000;
        const truncationWarnings: string[] = [];

        if (blocks.length > SLACK_BLOCK_LIMIT) {
          truncationWarnings.push(
            `Message has ${blocks.length} blocks (limit: ${SLACK_BLOCK_LIMIT})`,
          );
        }

        for (const [i, block] of blocks.entries()) {
          const textLen = block.text?.text?.length ?? 0;
          if (textLen > SLACK_TEXT_LIMIT) {
            truncationWarnings.push(
              `Block ${i + 1} text (${textLen} chars) exceeds Slack's ${SLACK_TEXT_LIMIT} char limit`,
            );
          }
        }

        const serialized = JSON.stringify(blocks);
        return envelope({
          channel: "slack",
          content: blocks,
          metadata: {
            sizeBytes: Buffer.byteLength(serialized, "utf-8"),
            blockCount: blocks.length,
            truncationWarnings,
          },
        });
      });
    },
```

**Register in createToolServer()** — add before the closing `return server;` (before line 652):

```typescript
  server.tool(
    "preview_digest",
    "Preview a digest rendered for a specific delivery channel without sending. Returns rendered content + metadata (size, Slack block count, truncation warnings).",
    {
      digestId: z.string().describe("Digest ID to preview"),
      channel: z
        .enum(["markdown", "email", "slack"])
        .optional()
        .describe('Delivery channel format to preview (default: "markdown")'),
    },
    async (args) => call("preview_digest", args),
  );
```

### Step 4.5: Run tests to verify they pass

- [ ] Run: `pnpm --filter @redgest/mcp-server exec vitest run src/__tests__/tools.test.ts`
- Expected: ALL PASS (existing 44 + 6 new = 50 tests)

### Step 4.6: Run full typecheck across monorepo

- [ ] Run: `pnpm typecheck`
- Expected: Clean across all packages

### Step 4.7: Commit

- [ ] ```bash
git add packages/mcp-server/package.json packages/mcp-server/tsconfig.json packages/mcp-server/src/tools.ts packages/mcp-server/src/__tests__/tools.test.ts
git commit -m "feat(mcp): add preview_digest tool for pre-delivery QA (#25)"
```

---

## Task 5: Final verification

### Step 5.1: Run full check suite

- [ ] Run: `pnpm check` (lint + typecheck + test)
- Expected: ALL PASS across all packages

### Step 5.2: Verify tool registration

- [ ] Confirm `createToolServer` test still passes (McpServer registers preview_digest)
- [ ] Confirm `use_redgest` test includes `preview_digest` assertion (added in Step 4.2)
