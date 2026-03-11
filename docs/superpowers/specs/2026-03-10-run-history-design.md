# Run History Page — Design Spec

**Date**: 2026-03-10
**Sprint**: 9 (WS10)
**Points**: 2.0

## Goal

A Run History page showing all digest generation runs in a sortable, paginated DataTable with inline-expandable rows to view digest content.

## Decisions

- **ShadCN DataTable** (TanStack Table) — install `@tanstack/react-table`, follow ShadCN DataTable recipe. Reusable generic wrapper.
- **Inline expandable rows** — click row/chevron to expand and view digest content in-place.
- **RSC initial load + client polling** — async Server Component fetches initial data, React Query polls every 5s when active runs exist.

## Data Sources

### RunView (SQL view)

| Field | Type | Notes |
|-------|------|-------|
| jobId | UUID | Row identifier |
| status | string | Cast from JobStatus enum: "QUEUED", "RUNNING", "COMPLETED", "FAILED", "PARTIAL" |
| progress | JsonValue | Step-level progress (nullable) |
| subreddits | JsonValue | **Array of subreddit UUID strings** (NOT names — needs ID→name resolution) |
| eventCount | number | Domain events emitted |
| lastEventType | string? | Latest event type |
| lastEventAt | DateTime? | Latest event timestamp |
| durationSeconds | number? | Elapsed seconds (NULL for non-completed runs) |
| triggerRunId | string? | Trigger.dev run ID |
| startedAt | DateTime? | Job start |
| completedAt | DateTime? | Job completion |
| error | string? | Error message if failed |
| createdAt | DateTime | Record creation |

### DigestView (SQL view, fetched on expand)

| Field | Type | Notes |
|-------|------|-------|
| digestId | UUID | Digest identifier (unique key for Prisma) |
| jobId | UUID | FK to job (not unique in Prisma — use `findFirst`) |
| jobStatus | string | Denormalized status |
| startedAt | DateTime? | Job start |
| completedAt | DateTime? | Job completion |
| subredditList | JsonValue | **Array of subreddit name strings** (from digest_posts join) |
| postCount | number | Posts included |
| contentMarkdown | string | Markdown digest |
| contentHtml | string? | Pre-rendered HTML (nullable) |
| createdAt | DateTime | Record creation |

### Subreddit ID→Name Resolution

`RunView.subreddits` stores UUID arrays from the Job table. The RSC page fetches both runs and subreddits, builds an `idToName: Record<string, string>` lookup, and passes it to the client component. The column formatter resolves IDs to "r/name" display strings. Unknown IDs show as truncated UUIDs.

## Table Columns

| Column | Source | Display |
|--------|--------|---------|
| Status | `status` | Color-coded badge (green=COMPLETED, yellow=RUNNING, red=FAILED, gray=QUEUED, orange=PARTIAL) |
| Subreddits | `subreddits` JSON + lookup | Comma-separated "r/name, r/name" |
| Started | `startedAt` | Relative time with full timestamp tooltip |
| Duration | `durationSeconds` | Formatted "1m 23s", spinner + "running..." for active, "—" for NULL |
| Events | `eventCount` | Numeric count |
| Expand | — | Chevron toggle button |

Sorting enabled on: Status, Started, Duration. Default sort: Started descending. NULL durations sort last.

## Component Architecture

```
app/history/page.tsx                    (async RSC — fetch runs + subreddits, serialize, pass down)
  └─ components/run-history-table.tsx   (client — orchestrator, React Query polling)
       ├─ columns.tsx                   (column defs, status badge, formatters)
       ├─ data-table.tsx                (generic ShadCN DataTable — reusable)
       └─ run-detail-panel.tsx          (expanded row — fetch + render digest)
```

### data-table.tsx (generic, reusable)

- Built on `@tanstack/react-table` + ShadCN `<Table>` primitives
- Props: `columns`, `data`, `renderSubComponent?` (for expandable rows)
- Handles: sorting state, pagination state (10 rows/page), expand toggle
- ShadCN pagination controls at bottom
- `autoResetPageIndex: false` — preserves page position on refetch

### columns.tsx

- `ColumnDef<SerializedRun>[]` factory function that takes `subredditMap: Record<string, string>`
- Status badge component with color map per status string
- `formatDuration(seconds)` — "1m 23s" or "running..." or "—"
- `formatRelativeTime(dateString)` — "2 min ago" with title tooltip
- Chevron expand button column

### run-history-table.tsx

- Receives `initialData: SerializedRun[]` and `subredditMap: Record<string, string>` from RSC page
- `useQuery({ queryKey: ["runs"], queryFn: fetchRuns, initialData })`
- `refetchInterval`: 5000ms when any row in **current data** is QUEUED/RUNNING, `false` otherwise
- Passes columns + data + renderSubComponent to `<DataTable>`

### run-detail-panel.tsx

- Props: `jobId: string`, `error?: string | null`
- `useQuery({ queryKey: ["digest", jobId], queryFn: () => fetchDigestForJob(jobId) })`
- UI states:
  - **Loading**: Spinner while fetching digest
  - **No digest**: "Digest not yet available" for QUEUED/RUNNING runs
  - **Error**: Shows `error` prop from RunView (passed from parent row, not from DigestView)
  - **Success**: Post count, subreddit list header, digest HTML via `dangerouslySetInnerHTML`

## Backend Additions

### New CQRS Query: `GetDigestByJobId`

- Add to `QueryMap`: `GetDigestByJobId: { jobId: string }`
- Add to `QueryResultMap`: `GetDigestByJobId: DigestView | null`
- Handler: `ctx.db.digestView.findFirst({ where: { jobId: params.jobId } })`
- Reason: `DigestView` unique key is `digestId`, not `jobId`. Cannot use `findUnique` by jobId.

### DAL Addition

- `dal.getDigestByJobId(jobId: string)` — dispatches `GetDigestByJobId` query

### Server Action Additions

- `fetchRuns()` — wraps `dal.listRuns()` for client-side React Query
- `fetchDigestForJob(jobId: string)` — wraps `dal.getDigestByJobId()`

## Type Additions

- `SerializedRun = Serialized<RunView>` in `lib/types.ts`
- `SerializedDigest = Serialized<DigestView>` in `lib/types.ts`
- Corresponding `serializeRun()` and `serializeDigest()` helpers
- Status field is `string` in both types (Prisma view casts enum to text)

## Polling Behavior

- React Query `refetchInterval` dynamically set based on current query data
- When any run in current data has status "QUEUED" or "RUNNING": poll every 5 seconds
- When all runs are terminal ("COMPLETED"/"FAILED"/"PARTIAL"): polling disabled
- Initial data from RSC avoids loading state on first render

## Pagination

- 10 rows per page
- ShadCN-styled prev/next controls
- Page state managed by TanStack Table with `autoResetPageIndex: false`

## Dependencies to Install

- `@tanstack/react-table` (new)

## Acceptance Criteria

- DataTable with sorting and pagination
- Job status, timing, subreddit count visible in table
- Expandable row shows digest content (with loading/error/empty states)
- Active runs auto-refresh status via polling
- Subreddit UUIDs resolved to names via lookup
- Follows Terminal-Luxe design direction
