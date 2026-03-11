# Run History Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Run History page with a sortable, paginated DataTable showing all digest runs with inline-expandable rows to view digest content.

**Architecture:** RSC page fetches initial runs + subreddits via CQRS DAL, serializes, and passes to a client DataTable. React Query polls for active runs. Expanding a row fetches digest content via server action. A new `GetDigestByJobId` CQRS query bridges the gap between RunView (keyed by jobId) and DigestView (keyed by digestId).

**Tech Stack:** @tanstack/react-table, @tanstack/react-query (already installed), ShadCN Table primitives, Next.js 16 Server Components

**Spec:** `docs/superpowers/specs/2026-03-10-run-history-design.md`

---

## Chunk 1: Backend + Types

### Task 1: Backend — GetDigestByJobId Query + DAL + Server Actions + Types

**Files:**
- Modify: `packages/core/src/queries/types.ts`
- Create: `packages/core/src/queries/handlers/get-digest-by-job-id.ts`
- Modify: `packages/core/src/queries/handlers/index.ts`
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/dal.ts`
- Modify: `apps/web/lib/actions.ts`
- Test: `packages/core/src/__tests__/query-handlers.test.ts`

**Context:**
- The RunView table shows runs keyed by `jobId`. When expanding a row, we need the digest for that job. DigestView's unique key is `digestId`, not `jobId`, so we need `findFirst({ where: { jobId } })`.
- The CQRS pattern: add to `QueryMap` + `QueryResultMap` → create handler file → register in handlers index → add DAL wrapper → add server action.
- Existing pattern: see `packages/core/src/queries/handlers/get-digest.ts` for a single-record query handler, and `apps/web/lib/dal.ts` for the DAL wrapper pattern.
- RunView has `subreddits: JsonValue` containing UUID strings (not names). The RSC page must also fetch subreddits to build an ID→name lookup map.

- [ ] **Step 1: Add GetDigestByJobId to QueryMap and QueryResultMap**

In `packages/core/src/queries/types.ts`, add `GetDigestByJobId` to both interfaces:

```typescript
// In QueryMap, add after GetDigest:
  GetDigestByJobId: { jobId: string };

// In QueryResultMap, add after GetDigest:
  GetDigestByJobId: DigestView | null;
```

- [ ] **Step 2: Create the query handler**

Create `packages/core/src/queries/handlers/get-digest-by-job-id.ts`:

```typescript
import type { QueryHandler } from "../types.js";

export const handleGetDigestByJobId: QueryHandler<"GetDigestByJobId"> = async (
  params,
  ctx,
) => {
  return ctx.db.digestView.findFirst({ where: { jobId: params.jobId } });
};
```

- [ ] **Step 3: Register the handler**

In `packages/core/src/queries/handlers/index.ts`, add the import and register it:

```typescript
// Add import:
import { handleGetDigestByJobId } from "./get-digest-by-job-id.js";

// Add to queryHandlers object:
  GetDigestByJobId: handleGetDigestByJobId,

// Add to named exports:
  handleGetDigestByJobId,
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: No errors. The QueryMap/QueryResultMap types flow through to make the handler type-safe.

- [ ] **Step 5: Add SerializedRun and SerializedDigest types**

In `apps/web/lib/types.ts`, add after the existing SerializedConfig section:

```typescript
import type { Config, SubredditView, RunView, DigestView } from "@redgest/db";

// Update the existing import to include RunView and DigestView

export type SerializedRun = Serialized<RunView>;

export function serializeRun(run: RunView): SerializedRun {
  return {
    ...run,
    lastEventAt: run.lastEventAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

export type SerializedDigest = Serialized<DigestView>;

export function serializeDigest(digest: DigestView): SerializedDigest {
  return {
    ...digest,
    startedAt: digest.startedAt?.toISOString() ?? null,
    completedAt: digest.completedAt?.toISOString() ?? null,
    createdAt: digest.createdAt.toISOString(),
  };
}
```

Note: The existing import `import type { Config, SubredditView } from "@redgest/db";` needs to be updated to also import `RunView` and `DigestView`.

- [ ] **Step 6: Add DAL wrapper**

In `apps/web/lib/dal.ts`, add after the existing `getDigest` function:

```typescript
export async function getDigestByJobId(
  jobId: string,
): Promise<QueryResultMap["GetDigestByJobId"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetDigestByJobId", { jobId }, queryCtx);
}
```

- [ ] **Step 7: Add server actions**

In `apps/web/lib/actions.ts`, add at the bottom:

```typescript
export async function fetchRuns() {
  return dal.listRuns();
}

export async function fetchDigestForJob(jobId: string) {
  return dal.getDigestByJobId(jobId);
}
```

- [ ] **Step 8: Add test for GetDigestByJobId handler**

In `packages/core/src/__tests__/query-handlers.test.ts`, add a test (follow the existing pattern in that file for query handler tests):

```typescript
describe("GetDigestByJobId", () => {
  it("returns digest when found", async () => {
    const fakeDigest = stub<DigestView>({
      digestId: "d-1",
      jobId: "j-1",
      jobStatus: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
      subredditList: ["r/test"],
      postCount: 5,
      contentMarkdown: "# Digest",
      contentHtml: "<h1>Digest</h1>",
      createdAt: new Date(),
    });

    const ctx = makeCtx({
      digestView: {
        findFirst: vi.fn().mockResolvedValue(fakeDigest),
      },
    });

    const result = await query("GetDigestByJobId", { jobId: "j-1" }, ctx);
    expect(result).toEqual(fakeDigest);
    expect(ctx.db.digestView.findFirst).toHaveBeenCalledWith({
      where: { jobId: "j-1" },
    });
  });

  it("returns null when no digest exists", async () => {
    const ctx = makeCtx({
      digestView: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await query("GetDigestByJobId", { jobId: "j-999" }, ctx);
    expect(result).toBeNull();
  });
});
```

Note: Check the existing test file for how `stub`, `makeCtx`, and `query` are set up. Follow the exact same pattern — do not invent new test helpers.

- [ ] **Step 9: Run tests**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/query-handlers.test.ts`
Expected: All tests pass including the new GetDigestByJobId tests.

- [ ] **Step 10: Run full typecheck**

Run: `pnpm typecheck`
Expected: No errors across all packages.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/queries/types.ts packages/core/src/queries/handlers/get-digest-by-job-id.ts packages/core/src/queries/handlers/index.ts packages/core/src/__tests__/query-handlers.test.ts apps/web/lib/types.ts apps/web/lib/dal.ts apps/web/lib/actions.ts
git commit -m "feat(core,web): add GetDigestByJobId query + run/digest serializers + server actions"
```

---

## Chunk 2: DataTable + Columns

### Task 2: Install @tanstack/react-table + Generic DataTable Component

**Files:**
- Create: `apps/web/components/data-table.tsx`

**Context:**
- ShadCN's DataTable recipe: a generic component wrapping `@tanstack/react-table` with ShadCN `<Table>` primitives.
- Must support: sorting, pagination (10 rows/page), expandable rows via `renderSubComponent` prop.
- `autoResetPageIndex: false` to preserve page on polling refetch.
- The existing ShadCN `<Table>` components are at `@/components/ui/table`.
- The existing `<Button>` is at `@/components/ui/button`.

- [ ] **Step 1: Install @tanstack/react-table**

Run: `pnpm --filter apps/web add @tanstack/react-table`

- [ ] **Step 2: Create data-table.tsx**

Create `apps/web/components/data-table.tsx`:

```tsx
"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Row,
  type ExpandedState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  renderSubComponent?: (props: { row: Row<TData> }) => ReactNode;
  getRowCanExpand?: (row: Row<TData>) => boolean;
}

export function DataTable<TData>({
  columns,
  data,
  renderSubComponent,
  getRowCanExpand,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: getRowCanExpand ?? (() => !!renderSubComponent),
    autoResetPageIndex: false,
    initialState: {
      pagination: { pageSize: 10 },
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() && renderSubComponent && (
                    <TableRow>
                      <TableCell colSpan={row.getVisibleCells().length}>
                        {renderSubComponent({ row })}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between px-2">
        <p className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="mr-1 size-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

Note: Uses `<Fragment key={row.id}>` to wrap each row + expanded row pair, since `<>` shorthand doesn't support keys.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/components/data-table.tsx
git commit -m "feat(web): add generic DataTable component with sorting, pagination, expand"
```

---

### Task 3: Column Definitions + Status Badge + Formatters

**Files:**
- Create: `apps/web/components/run-columns.tsx`

**Context:**
- Column definitions for the run history DataTable.
- `SerializedRun` has: `jobId`, `status` (string), `subreddits` (JsonValue = UUID string array), `eventCount`, `durationSeconds` (number | null), `startedAt` (string | null), `createdAt` (string), `error` (string | null).
- `subreddits` field stores UUID arrays. A `subredditMap: Record<string, string>` (id → name) is passed as a closure parameter.
- `formatRelativeTime` already exists in `subreddit-table.tsx` but is not exported. Rather than refactoring that file, define it locally — it's 7 lines and used differently here (no "Never" case).
- The Badge component is at `@/components/ui/badge`. It supports `variant` prop. For custom colors, use className overrides.
- The Tooltip component is at `@/components/ui/tooltip`.

- [ ] **Step 1: Create run-columns.tsx**

Create `apps/web/components/run-columns.tsx`:

```tsx
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, ArrowUpDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SerializedRun } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: "bg-green-600/20 text-green-400 border-green-600/30",
  RUNNING: "bg-yellow-600/20 text-yellow-400 border-yellow-600/30",
  QUEUED: "bg-slate-600/20 text-slate-400 border-slate-600/30",
  FAILED: "bg-red-600/20 text-red-400 border-red-600/30",
  PARTIAL: "bg-orange-600/20 text-orange-400 border-orange-600/30",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status] ?? ""}>
      {status}
    </Badge>
  );
}

function formatDuration(seconds: number | null, status: string): string {
  if (seconds === null || seconds === undefined) {
    if (status === "RUNNING" || status === "QUEUED") return "";
    return "\u2014";
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatSubreddits(
  subreddits: unknown,
  subredditMap: Record<string, string>,
): string {
  if (!Array.isArray(subreddits)) return "\u2014";
  if (subreddits.length === 0) return "\u2014";
  return subreddits
    .map((id: string) => {
      const name = subredditMap[id];
      return name ? `r/${name}` : id.slice(0, 8);
    })
    .join(", ");
}

export function createColumns(
  subredditMap: Record<string, string>,
): ColumnDef<SerializedRun, unknown>[] {
  return [
    {
      id: "expand",
      header: () => null,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => row.toggleExpanded()}
        >
          {row.getIsExpanded() ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <span className="sr-only">
            {row.getIsExpanded() ? "Collapse" : "Expand"}
          </span>
        </Button>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Status
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
    },
    {
      id: "subreddits",
      header: "Subreddits",
      accessorFn: (row) => row.subreddits,
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {formatSubreddits(row.original.subreddits, subredditMap)}
        </span>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "startedAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Started
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const dateStr = row.original.startedAt;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default text-muted-foreground">
                {formatRelativeTime(dateStr)}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {dateStr ? new Date(dateStr).toLocaleString() : "Not started"}
            </TooltipContent>
          </Tooltip>
        );
      },
      sortingFn: "datetime",
    },
    {
      accessorKey: "durationSeconds",
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Duration
          <ArrowUpDown className="ml-1 size-3" />
        </Button>
      ),
      cell: ({ row }) => {
        const status = row.original.status;
        const dur = row.original.durationSeconds;
        if (status === "RUNNING" || status === "QUEUED") {
          return (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {status === "RUNNING" ? "running..." : "queued"}
            </span>
          );
        }
        return (
          <span className="text-muted-foreground font-mono text-xs">
            {formatDuration(dur, status)}
          </span>
        );
      },
      sortUndefined: "last",
    },
    {
      accessorKey: "eventCount",
      header: "Events",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {getValue() as number}
        </span>
      ),
      enableSorting: false,
    },
  ];
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/run-columns.tsx
git commit -m "feat(web): add run history column definitions with status badge and formatters"
```

---

## Chunk 3: Client Components + Page

### Task 4: Run Detail Panel + Run History Table

**Files:**
- Create: `apps/web/components/run-detail-panel.tsx`
- Create: `apps/web/components/run-history-table.tsx`

**Context:**
- `run-detail-panel.tsx` — Shown inside expanded DataTable row. Fetches digest by jobId via React Query. Shows loading/empty/error/success states.
- `run-history-table.tsx` — Client orchestrator. Receives initial data from RSC, wraps in React Query for polling, passes to DataTable.
- React Query is already set up via `<Providers>` in the app layout (see `apps/web/components/providers.tsx`).
- Server actions `fetchRuns` and `fetchDigestForJob` are in `apps/web/lib/actions.ts`.
- The `serializeRun` and `serializeDigest` helpers handle Date→string conversion. Server actions return raw Prisma types (with Dates), so the client needs to handle that React Query may return data with Date objects (since server actions serialize them as strings over the wire anyway).

- [ ] **Step 1: Create run-detail-panel.tsx**

Create `apps/web/components/run-detail-panel.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { fetchDigestForJob } from "@/lib/actions";

interface RunDetailPanelProps {
  jobId: string;
  status: string;
  error?: string | null;
}

export function RunDetailPanel({ jobId, status, error }: RunDetailPanelProps) {
  const { data: digest, isLoading } = useQuery({
    queryKey: ["digest", jobId],
    queryFn: () => fetchDigestForJob(jobId),
    enabled: status !== "QUEUED",
  });

  if (status === "QUEUED") {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        Job is queued — digest not yet available.
      </div>
    );
  }

  if (status === "FAILED" && !digest) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm font-medium text-red-400">Run failed</p>
        {error && (
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {status === "RUNNING"
          ? "Digest is being generated..."
          : "No digest available for this run."}
      </div>
    );
  }

  const subreddits = Array.isArray(digest.subredditList)
    ? (digest.subredditList as string[]).join(", ")
    : "";

  return (
    <div className="space-y-3 py-4">
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{digest.postCount}</strong> posts
        </span>
        {subreddits && <span>{subreddits}</span>}
      </div>
      {digest.contentHtml ? (
        <div
          className="prose prose-invert prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: digest.contentHtml }}
        />
      ) : digest.contentMarkdown ? (
        <pre className="whitespace-pre-wrap text-sm text-muted-foreground">
          {digest.contentMarkdown}
        </pre>
      ) : null}
    </div>
  );
}
```

Note: `prose prose-invert` requires `@tailwindcss/typography` plugin. Check if it's installed — if not, use the `<pre>` fallback for markdown content and skip the prose classes. Alternatively, install `@tailwindcss/typography`. If unavailable, replace the `prose` div with a simple `<div className="text-sm">` wrapper.

- [ ] **Step 2: Create run-history-table.tsx**

Create `apps/web/components/run-history-table.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRuns } from "@/lib/actions";
import { DataTable } from "@/components/data-table";
import { createColumns } from "@/components/run-columns";
import { RunDetailPanel } from "@/components/run-detail-panel";
import type { SerializedRun } from "@/lib/types";

interface RunHistoryTableProps {
  initialData: SerializedRun[];
  subredditMap: Record<string, string>;
}

export function RunHistoryTable({
  initialData,
  subredditMap,
}: RunHistoryTableProps) {
  const { data: runs } = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    initialData,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const hasActive = (data as SerializedRun[]).some(
        (r) => r.status === "QUEUED" || r.status === "RUNNING",
      );
      return hasActive ? 5000 : false;
    },
  });

  const columns = createColumns(subredditMap);

  return (
    <DataTable
      columns={columns}
      data={(runs ?? []) as SerializedRun[]}
      renderSubComponent={({ row }) => (
        <RunDetailPanel
          jobId={row.original.jobId}
          status={row.original.status}
          error={row.original.error}
        />
      )}
    />
  );
}
```

Note on `refetchInterval`: React Query v5 accepts a function that receives the query instance. The `query.state.data` gives the current data. The cast to `SerializedRun[]` is needed because `fetchRuns` returns the raw Prisma type (RunView[]) which gets serialized over the server action boundary.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: No errors. If there are type mismatches between `RunView` (from server action) and `SerializedRun` (expected by DataTable), the server action returns raw Prisma types which Next.js serializes to JSON strings over the wire — so Date fields become strings automatically. This means `fetchRuns` returns data that's already "serialized" at runtime even though the TS type says RunView. If the typecheck fails on this, the fix is to type the `useQuery` result explicitly:

```typescript
const { data: runs } = useQuery<SerializedRun[]>({
  queryKey: ["runs"],
  queryFn: fetchRuns as unknown as () => Promise<SerializedRun[]>,
  ...
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/run-detail-panel.tsx apps/web/components/run-history-table.tsx
git commit -m "feat(web): add RunHistoryTable with React Query polling and RunDetailPanel"
```

---

### Task 5: RSC Page + Integration

**Files:**
- Modify: `apps/web/app/history/page.tsx`

**Context:**
- The existing stub page is at `apps/web/app/history/page.tsx` — it's a simple div with heading text.
- Follow the pattern from `apps/web/app/subreddits/page.tsx`: async RSC that fetches data, serializes, passes to client component.
- Must fetch both `listRuns()` and `listSubreddits()` to build the subreddit ID→name lookup map.
- The page header style matches existing pages (h1 with font-mono + description paragraph).

- [ ] **Step 1: Replace the stub page**

Replace the contents of `apps/web/app/history/page.tsx`:

```tsx
import { listRuns, listSubreddits } from "@/lib/dal";
import { serializeRun } from "@/lib/types";
import { RunHistoryTable } from "@/components/run-history-table";

export default async function HistoryPage() {
  const [runs, subreddits] = await Promise.all([
    listRuns(),
    listSubreddits(),
  ]);

  const serializedRuns = runs.map(serializeRun);

  const subredditMap: Record<string, string> = {};
  for (const sub of subreddits) {
    subredditMap[sub.id] = sub.name;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Run History
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View past digest runs, job statuses, and generated content
        </p>
      </div>
      <RunHistoryTable
        initialData={serializedRuns}
        subredditMap={subredditMap}
      />
    </div>
  );
}
```

- [ ] **Step 2: Check if @tailwindcss/typography is installed**

Run: `pnpm --filter apps/web list @tailwindcss/typography 2>&1 || echo "not installed"`

If NOT installed, install it:
Run: `pnpm --filter apps/web add -D @tailwindcss/typography`

Then add `@import "tailwindcss/typography"` to the global CSS or add the plugin to the Tailwind config. Check how Tailwind v4 handles plugins — in v4, typography is imported via CSS:

In `apps/web/globals.css`, add:
```css
@import "tailwindcss/typography";
```

If Tailwind v4 uses a different mechanism, check the existing `globals.css` for how other plugins are loaded.

- [ ] **Step 3: Verify full build**

Run: `pnpm typecheck`
Expected: No errors.

Run: `pnpm lint`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 4: Run all tests**

Run: `turbo test`
Expected: All tests pass, including the new query handler test.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/history/page.tsx
git commit -m "feat(web): wire up Run History page with RSC data fetching"
```

If typography was installed, also add those files:
```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/globals.css
git commit -m "feat(web): add @tailwindcss/typography for digest content rendering"
```
