# Compare Digests Tool Design

**Issue:** [#24 — Add compare_digests tool for trend analysis](https://github.com/medelman17/redgest/issues/24)
**Date:** 2026-03-12

## Problem

Agents consuming ongoing digest streams need to understand temporal patterns — what changed between runs, which subreddits are trending, whether topics are recurring. Currently you can fetch individual digests but not compare them.

## Solution

A read-only `compare_digests` MCP tool backed by a `CompareDigests` query handler. Accepts two digest IDs, computes set differences on their posts, and returns structured comparison data.

## Architecture

### Two components

1. **Query handler** (`CompareDigests`) — Pure comparison logic. Accepts two concrete digest UUIDs + optional subreddit filter. Returns `DigestComparisonResult`.

2. **MCP tool** (`compare_digests`) — Input normalization layer. Resolves `"latest"` / `"previous"` shorthand to UUIDs, validates inputs, delegates to query handler.

### Data Flow

```
compare_digests MCP tool
  → resolve "latest"/"previous" via db.digest.findMany({ take: 2, orderBy: { createdAt: "desc" } })
  → query("CompareDigests", { digestIdA, digestIdB, subreddit? })
    → fetch both digests with digestPosts + post relations
    → build Set<redditId> per digest
    → compute intersection, added (B \ A), removed (A \ B)
    → apply subreddit filter if provided
    → compute subreddit deltas
    → return DigestComparisonResult
  → envelope(result)
```

### Conventions

- **A is "before", B is "after"** — `added` = posts in B but not A; `removed` = posts in A but not B.
- **ID resolution in MCP layer** — Query handler receives concrete UUIDs only, stays pure and reusable.
- **Minimal post metadata** — Title, subreddit, score, redditId. No summaries. Agent can `get_post` for details.

## Result Type

```typescript
type DigestComparisonResult = {
  digestA: DigestSummary;
  digestB: DigestSummary;
  overlap: { count: number; percentage: number; posts: ComparisonPost[] };
  added: { count: number; posts: ComparisonPost[] };
  removed: { count: number; posts: ComparisonPost[] };
  subredditDeltas: SubredditDelta[];
};

type DigestSummary = {
  id: string;
  createdAt: string;
  postCount: number;
  subreddits: string[];
};

type ComparisonPost = {
  postId: string;
  redditId: string;
  title: string;
  subreddit: string;
  score: number;
};

type SubredditDelta = {
  subreddit: string;
  countA: number;
  countB: number;
  delta: number;
};
```

## MCP Tool Interface

```typescript
server.tool(
  "compare_digests",
  "Compare two digests to see new/dropped posts, overlap, and subreddit trends",
  {
    digestIdA: z.string().describe("UUID of the earlier digest, or 'latest'"),
    digestIdB: z.string().describe("UUID of the later digest, or 'previous'"),
    subreddit: z.string().optional().describe("Filter comparison to a specific subreddit"),
  },
  handleCompareDigests
);
```

### Shorthand Resolution

| digestIdA | digestIdB | Resolution |
|-----------|-----------|------------|
| UUID | UUID | Use as-is |
| `"latest"` | `"previous"` | Fetch 2 most recent digests; latest = [0], previous = [1] |
| `"previous"` | `"latest"` | Same fetch; swap assignment |
| UUID | `"latest"` | Fetch most recent digest for latest; use UUID as-is |
| `"previous"` | UUID | Fetch 2 most recent; previous = [1] |

## Error Cases

| Condition | Response |
|-----------|----------|
| Digest not found | `envelopeError("NOT_FOUND", "Digest <id> not found")` |
| Fewer than 2 digests when using shorthand | `envelopeError("NOT_FOUND", "Need at least 2 digests to compare")` |
| Both IDs resolve to same digest | `envelopeError("INVALID_INPUT", "Cannot compare a digest with itself")` |

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/queries/types.ts` | Add `CompareDigests` to `QueryMap` and `QueryResultMap` |
| `packages/core/src/queries/handlers/compare-digests.ts` | New query handler |
| `packages/core/src/queries/handlers/index.ts` | Register handler in registry |
| `packages/mcp-server/src/tools.ts` | Add `handleCompareDigests` + `server.tool()` registration |

## Testing

- **Query handler tests** — Two digests with known overlapping/non-overlapping posts. Verify counts, overlap percentage, added/removed sets, subreddit deltas.
- **Edge cases** — No overlap, complete overlap, subreddit filter narrows results, empty digest, single-post digests.
- **MCP tool tests** — Shorthand resolution, error cases (not found, same ID, insufficient digests).
