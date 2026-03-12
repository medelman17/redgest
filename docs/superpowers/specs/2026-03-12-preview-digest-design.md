# preview_digest Tool Design

**Date:** 2026-03-12
**Issue:** #25 — Add preview_digest tool for pre-delivery QA
**Status:** Approved

## Problem

Phase 2 adds email and Slack delivery, but there's no way to preview what will be sent before committing to delivery. Slack has block limits (50 blocks, 3000 chars per text field), emails have rendering quirks. Agents should be able to QA before sending.

## Solution

A new MCP tool `preview_digest` that renders a digest in a specified delivery channel format without sending it. Returns the rendered output plus metadata (size, block count, truncation warnings).

### Input

```typescript
{
  digestId: string;          // Required — explicit digest ID
  channel?: "markdown" | "email" | "slack";  // Default: "markdown"
}
```

### Output (Discriminated Union)

```typescript
type PreviewResult =
  | { channel: "markdown"; content: string; metadata: { sizeBytes: number } }
  | { channel: "email"; content: string; metadata: { sizeBytes: number } }
  | { channel: "slack"; content: SlackBlock[]; metadata: { sizeBytes: number; blockCount: number; truncationWarnings: string[] } }
```

`sizeBytes` is `Buffer.byteLength(content, 'utf-8')` for markdown/email (string content), and `Buffer.byteLength(JSON.stringify(content), 'utf-8')` for Slack (serialized blocks).

## Architecture

### Decision: Tool-Level Operation (No CQRS Query)

The preview involves presentation-layer rendering (HTML, Block Kit) that doesn't belong in the CQRS query layer. The tool handler directly queries Prisma and calls rendering functions. No new query type needed.

### Decision: Explicit digestId Required

No "latest" shortcut. The agent already has the digestId from a prior `get_digest` call. Keeps the tool focused and avoids duplicating fallback logic.

### Decision: Existing contentMarkdown for Markdown Channel

The `DigestView` already has a `contentMarkdown` field. The markdown channel returns this directly without going through the `DigestDeliveryData` transformation. Email and Slack channels do the full transform + render.

### Decision: Re-render Rather Than Use Stored HTML/Blocks

The `DigestView` has a `contentHtml` field (nullable) and the `Digest` model may store pre-rendered content. Preview always re-renders from relations because:
- Stored HTML may be null (not all pipelines populate it)
- Template changes should be reflected immediately in previews
- Preview answers "what WILL be sent" not "what WAS generated"

### Decision: Reject Preview of In-Progress Digests

If the digest's associated job is not in a terminal state (COMPLETED, PARTIAL, FAILED, CANCELED), the tool returns an error. Previewing incomplete data is misleading.

## Components Changed

### 1. `@redgest/email` — Extract Transform + Add Render Export

**New file: `packages/email/src/transform.ts`**

Extract the digest-to-`DigestDeliveryData` transformation from `apps/worker/src/trigger/deliver-digest.ts`. This function takes the Prisma digest record with full relations and produces the `DigestDeliveryData` shape.

```typescript
/** Input type — mirrors the Prisma query shape without importing @redgest/db */
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
        keyTakeaways: unknown;       // JSON — cast to string[]
        insightNotes: string | null;
        commentHighlights: unknown;  // JSON — cast to CommentHighlight[]
      }>;
    };
  }>;
}

export function buildDeliveryData(digest: DigestWithRelations): DigestDeliveryData
```

The type is defined manually (not imported from `@redgest/db`) to avoid adding a db dependency to the email package. Trade-off: schema changes to DigestPost, Post, or PostSummary require a manual update here.

**New file: `packages/email/src/render.ts`**

Export a render-only function that produces HTML without sending:

```typescript
export async function renderDigestHtml(data: DigestDeliveryData): Promise<string>
```

Wraps `createElement(DigestEmail, { digest: data })` + `render()` from `@react-email/components`. Does NOT import `resend`.

**Update: `packages/email/src/send.ts`**

Refactor `sendDigestEmail()` to use `renderDigestHtml()` internally instead of duplicating the render logic.

**Update: `packages/email/src/index.ts`**

Export `buildDeliveryData`, `renderDigestHtml`, and `DigestWithRelations` type.

**Note on placement:** `buildDeliveryData()` transforms generic digest data, not email-specific data. It lives in `@redgest/email` because `DigestDeliveryData` (its output type) is defined there and the worker already depends on this package. This is a pragmatic choice, not an ideal separation of concerns. If delivery-related logic grows, consider extracting to a shared `@redgest/delivery` package.

### 2. `apps/worker` — Import Shared Transform

**Update: `apps/worker/src/trigger/deliver-digest.ts`**

Replace inline transformation logic with `buildDeliveryData()` import from `@redgest/email`. The Prisma query stays in the worker (it owns the database call); only the mapping function is shared.

### 3. `@redgest/mcp-server` — New Tool

**Update: `packages/mcp-server/package.json`**

Add `@redgest/email` and `@redgest/slack` as dependencies.

**Update: `packages/mcp-server/tsconfig.json`**

Add `"jsx": "react-jsx"` — required because `@redgest/email` transitively includes `.tsx` files (React Email templates). Same pattern already used by `apps/worker`.

**Update: `packages/mcp-server/src/tools.ts`**

Add `preview_digest` tool handler and register in `createToolServer()`.

**Prisma query for email/slack channels:**

```typescript
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
```

This matches the exact query shape in `deliver-digest.ts`.

**Tool flow:**

```
preview_digest({ digestId, channel? })
  ├── Check digest exists (query DigestView for jobStatus)
  │     → if not found: NOT_FOUND error
  │     → if job not terminal (COMPLETED/PARTIAL/FAILED/CANCELED): CONFLICT error
  │
  ├── channel === "markdown"
  │     → return contentMarkdown from DigestView
  │     → metadata: { sizeBytes: Buffer.byteLength(markdown, 'utf-8') }
  │
  └── channel === "email" | "slack"
        → load digest with full relations via Prisma query above
        → buildDeliveryData(digest) → DigestDeliveryData
        ├── "email" → renderDigestHtml(data) → HTML string
        │     → metadata: { sizeBytes: Buffer.byteLength(html, 'utf-8') }
        └── "slack" → formatDigestBlocks(data) → SlackBlock[]
              → metadata: { sizeBytes, blockCount, truncationWarnings }
```

**Update USAGE_GUIDE** in `tools.ts` — add `preview_digest` to the "Digest Retrieval" section and its error codes (NOT_FOUND, CONFLICT, INTERNAL_ERROR) to the Per-Tool Error Codes table.

## Slack Metadata Details

Slack Block Kit limits:
- **50 blocks** per message
- **3000 characters** per `text` field in a section block

The `truncationWarnings` array flags specific violations:
- `"Message has N blocks (limit: 50)"` — when block count exceeds 50
- `"Block N text (X chars) exceeds Slack's 3,000 char limit"` — per-block text overflow

## Data Flow

```
Agent: get_digest() → sees digestId "abc-123"
Agent: preview_digest({ digestId: "abc-123", channel: "slack" })
  → Check DigestView: jobStatus = "COMPLETED" ✓
  → Load digest + digestPosts + posts + summaries from Prisma
  → buildDeliveryData(digest) → DigestDeliveryData
  → formatDigestBlocks(data) → SlackBlock[]
  → Compute: blockCount=42, no truncation warnings
  → envelope({ channel: "slack", content: blocks, metadata: { sizeBytes: 12480, blockCount: 42, truncationWarnings: [] } })
Agent: "Looks good, 42 blocks within limit" → triggers delivery
```

## Error Cases

| Condition | Error Code | Message |
|-----------|-----------|---------|
| Digest not found | NOT_FOUND | `Digest {digestId} not found` |
| Job still running | CONFLICT | `Digest {digestId} is still being generated (status: {status})` |
| Invalid channel | VALIDATION_ERROR | `Invalid channel: {channel}. Must be markdown, email, or slack` |
| Render failure | INTERNAL_ERROR | `Failed to render {channel} preview: {message}` |

## Testing

### Unit Tests

- **`buildDeliveryData()`** — Verify transform produces correct `DigestDeliveryData` shape from Prisma relations. Test empty subreddits, missing summaries, multiple posts per subreddit.
- **`renderDigestHtml()`** — Verify renders without error, returns HTML string containing expected elements.
- **`preview_digest` tool handler** — Test each channel path (markdown, email, slack). Test missing digest returns NOT_FOUND. Test in-progress digest returns CONFLICT. Test default channel is markdown. Test invalid channel returns VALIDATION_ERROR.
- **Slack metadata** — Test truncation warning generation for oversized blocks.

### Worker Regression

The `deliver-digest` worker task has no unit tests (TD-005). The refactor to use shared `buildDeliveryData()` cannot be verified by automated tests. Risk: manual verification that the worker still functions after the extraction. This is a known gap, not expanded scope for this issue.

## Files Summary

| File | Action |
|------|--------|
| `packages/email/src/transform.ts` | Create — `buildDeliveryData()` + `DigestWithRelations` type |
| `packages/email/src/render.ts` | Create — `renderDigestHtml()` |
| `packages/email/src/send.ts` | Update — use `renderDigestHtml()` internally |
| `packages/email/src/index.ts` | Update — export new functions/types |
| `apps/worker/src/trigger/deliver-digest.ts` | Update — import `buildDeliveryData()` |
| `packages/mcp-server/package.json` | Update — add email/slack deps |
| `packages/mcp-server/tsconfig.json` | Update — add `"jsx": "react-jsx"` |
| `packages/mcp-server/src/tools.ts` | Update — add `preview_digest` tool + USAGE_GUIDE entry |
