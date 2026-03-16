# Sprint 11: Phase 4 Completion — Search UI, Analytics Dashboard, E2E, Worker Tests

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 4 by adding Search and Dashboard pages to the web UI, enhancing the subreddits page with crawl stats, adding E2E tests, and covering worker tasks with unit tests.

**Architecture:** Server Components fetch data via DAL → CQRS queries. Client components handle interactivity (search input, filters). Follows Sprint 10 patterns: `Serialized<T>` types, `serializeX()` functions, RSC parallel data loading. Worker tests mock Prisma + Trigger.dev SDK + pipeline deps.

**Tech Stack:** Next.js 16 + React 19 + ShadCN/ui + Tailwind v4, Vitest, Playwright

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/app/search/page.tsx` | Search page RSC — loads subreddits for filter dropdown |
| `apps/web/components/search-panel.tsx` | Client component — search input, filters, results list |
| `apps/web/app/dashboard/page.tsx` | Dashboard page RSC — loads trending topics, LLM metrics, crawl status |
| `apps/web/components/dashboard-panels.tsx` | Client component — trending topics, LLM stats, crawl health cards |
| `apps/worker/src/trigger/__tests__/generate-digest.test.ts` | Unit tests for generate-digest task |
| `apps/worker/src/trigger/__tests__/deliver-digest.test.ts` | Unit tests for deliver-digest task |
| `apps/worker/src/trigger/__tests__/scheduled-digest.test.ts` | Unit tests for scheduled-digest task |

### Modified Files
| File | Change |
|------|--------|
| `packages/core/src/index.ts` | Export `SearchResult`, `TrendingTopic`, `LlmMetrics`, `CrawlStatusItem`, `PeriodComparisonResult`, `LlmTaskMetrics`, `PeriodSummary` types |
| `apps/web/lib/dal.ts` | Add DAL wrappers for search + analytics queries |
| `apps/web/lib/actions.ts` | Add server actions for search (client-side fetch wrappers) |
| `apps/web/lib/types.ts` | Add `SerializedSearchResult` type + serializer |
| `apps/web/components/app-sidebar.tsx` | Add Search + Dashboard nav items |
| `apps/web/components/subreddit-table.tsx` | Add crawl status + stats columns |
| `apps/web/tests/smoke.spec.ts` | Add Search + Dashboard smoke tests |
| `apps/web/tests/interactions.spec.ts` | Add Search + Dashboard interaction tests |

---

## Chunk 1: DAL + Types + Sidebar

### Task 1: Export analytics types from @redgest/core

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add type exports to core barrel**

Add to `packages/core/src/index.ts` after the existing `SearchResult` export line:

```typescript
export type {
  TrendingTopic,
  LlmMetrics,
  LlmTaskMetrics,
  CrawlStatusItem,
  PeriodComparisonResult,
  PeriodSummary,
} from "./queries/types.js";
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @redgest/core exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export analytics types from barrel"
```

---

### Task 2: Add DAL wrappers for search + analytics queries

**Files:**
- Modify: `apps/web/lib/dal.ts`

- [ ] **Step 1: Add search query wrappers**

Add after the `cancelRun` function in `dal.ts`:

```typescript
// --- Search queries ---

export async function searchPosts(params: {
  query: string;
  subreddit?: string;
  since?: string;
  sentiment?: string;
  minScore?: number;
  limit?: number;
}): Promise<QueryResultMap["SearchPosts"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("SearchPosts", params, queryCtx);
}

export async function searchDigests(params: {
  query: string;
  subreddit?: string;
  since?: string;
  limit?: number;
}): Promise<QueryResultMap["SearchDigests"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("SearchDigests", params, queryCtx);
}

export async function findSimilar(params: {
  postId: string;
  limit?: number;
  subreddit?: string;
}): Promise<QueryResultMap["FindSimilar"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("FindSimilar", params, queryCtx);
}

export async function askHistory(params: {
  question: string;
  limit?: number;
  subreddit?: string;
  since?: string;
}): Promise<QueryResultMap["AskHistory"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("AskHistory", params, queryCtx);
}

// --- Analytics queries ---

export async function getTrendingTopics(params?: {
  limit?: number;
  since?: string;
  subreddit?: string;
}): Promise<QueryResultMap["GetTrendingTopics"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetTrendingTopics", params ?? {}, queryCtx);
}

export async function getLlmMetrics(params?: {
  jobId?: string;
  limit?: number;
}): Promise<QueryResultMap["GetLlmMetrics"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetLlmMetrics", params ?? {}, queryCtx);
}

export async function getSubredditStats(params?: {
  name?: string;
}): Promise<QueryResultMap["GetSubredditStats"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetSubredditStats", params ?? {}, queryCtx);
}

export async function getCrawlStatus(params?: {
  name?: string;
}): Promise<QueryResultMap["GetCrawlStatus"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetCrawlStatus", params ?? {}, queryCtx);
}

export async function comparePeriods(params: {
  periodA: string;
  periodB: string;
  subreddit?: string;
}): Promise<QueryResultMap["ComparePeriods"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("ComparePeriods", params, queryCtx);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/dal.ts
git commit -m "feat(web): add DAL wrappers for search and analytics queries"
```

---

### Task 3: Add SerializedSearchResult type + server actions for search

**Files:**
- Modify: `apps/web/lib/types.ts`
- Modify: `apps/web/lib/actions.ts`

- [ ] **Step 1: Add SerializedSearchResult to types.ts**

The `SearchResult` type from `@redgest/core` has a `digestDate: Date | null` field that needs serialization. Add after the `SerializedProfile` section in `types.ts`:

```typescript
import type { Config, SubredditView, RunView, DigestView, ProfileView } from "@redgest/db";
import type { SearchResult } from "@redgest/core";

// ... (existing code) ...

export type SerializedSearchResult = Serialized<SearchResult>;

export function serializeSearchResult(result: SearchResult): SerializedSearchResult {
  return {
    ...result,
    digestDate: result.digestDate?.toISOString() ?? null,
  };
}
```

Note: The import of `SearchResult` from `@redgest/core` needs to be added to the existing imports at the top.

- [ ] **Step 2: Add search server actions to actions.ts**

Add after the `fetchDeliveryStatus` function in `actions.ts`:

```typescript
// --- Search actions (for client-side use) ---

export async function fetchSearchResults(params: {
  query: string;
  subreddit?: string;
  since?: string;
  sentiment?: string;
  minScore?: number;
  limit?: number;
}) {
  const results = await dal.searchPosts(params);
  return results.map(serializeSearchResult);
}

export async function fetchTrendingTopics(params?: {
  limit?: number;
  since?: string;
  subreddit?: string;
}) {
  return dal.getTrendingTopics(params);
}

export async function fetchLlmMetrics(params?: {
  jobId?: string;
  limit?: number;
}) {
  return dal.getLlmMetrics(params);
}

export async function fetchCrawlStatus(params?: {
  name?: string;
}) {
  return dal.getCrawlStatus(params);
}
```

Note: Add the `serializeSearchResult` import from `@/lib/types`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/types.ts apps/web/lib/actions.ts
git commit -m "feat(web): add search/analytics serialized types and server actions"
```

---

### Task 4: Add Search + Dashboard to sidebar navigation

**Files:**
- Modify: `apps/web/components/app-sidebar.tsx`

- [ ] **Step 1: Add nav items**

Import `Search` and `LayoutDashboard` from `lucide-react`, then add to `NAV_ITEMS`:

```typescript
const NAV_ITEMS = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Subreddits", href: "/subreddits", icon: Rss },
  { title: "Profiles", href: "/profiles", icon: Layers },
  { title: "Digests", href: "/digests", icon: BookOpen },
  { title: "Search", href: "/search", icon: Search },
  { title: "Settings", href: "/settings", icon: Settings },
  { title: "History", href: "/history", icon: Clock },
  { title: "Trigger", href: "/trigger", icon: Play },
] as const;
```

Dashboard goes first (it's the home page). Search goes after Digests (content browsing cluster).

- [ ] **Step 2: Update home redirect**

Check `apps/web/app/page.tsx` — if it redirects to `/subreddits`, change it to redirect to `/dashboard`:

```typescript
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/dashboard");
}
```

- [ ] **Step 3: Verify dev server renders sidebar**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/app-sidebar.tsx apps/web/app/page.tsx
git commit -m "feat(web): add Search and Dashboard to sidebar, redirect home to dashboard"
```

---

## Chunk 2: Search Page

### Task 5: Search page — RSC + client search panel

**Files:**
- Create: `apps/web/app/search/page.tsx`
- Create: `apps/web/components/search-panel.tsx`

- [ ] **Step 1: Create search page RSC**

`apps/web/app/search/page.tsx`:

```typescript
import { listSubreddits } from "@/lib/dal";
import { serializeSubreddit } from "@/lib/types";
import { SearchPanel } from "@/components/search-panel";

export default async function SearchPage() {
  const subreddits = await listSubreddits();
  const serializedSubreddits = subreddits.map(serializeSubreddit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search across posts and digests with full-text and semantic search
        </p>
      </div>
      <SearchPanel subreddits={serializedSubreddits} />
    </div>
  );
}
```

- [ ] **Step 2: Create search panel client component**

`apps/web/components/search-panel.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchSearchResults } from "@/lib/actions";
import type { SerializedSubreddit, SerializedSearchResult } from "@/lib/types";

interface SearchPanelProps {
  subreddits: SerializedSubreddit[];
}

export function SearchPanel({ subreddits }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [subreddit, setSubreddit] = useState<string>("all");
  const [sentiment, setSentiment] = useState<string>("any");
  const [since, setSince] = useState<string>("");
  const [minScore, setMinScore] = useState<string>("");
  const [results, setResults] = useState<SerializedSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSearch() {
    if (!query.trim()) return;
    startTransition(async () => {
      const params: Parameters<typeof fetchSearchResults>[0] = {
        query: query.trim(),
        limit: 20,
      };
      if (subreddit !== "all") params.subreddit = subreddit;
      if (sentiment !== "any") params.sentiment = sentiment;
      if (since) params.since = since;
      if (minScore) params.minScore = Number(minScore);

      const data = await fetchSearchResults(params);
      setResults(data);
      setHasSearched(true);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-base">Search Posts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search input */}
          <div className="flex gap-2">
            <Input
              placeholder="Search posts and summaries..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button
              onClick={handleSearch}
              disabled={isPending || !query.trim()}
              className="gap-2"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Search className="size-4" />
              )}
              Search
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Subreddit</Label>
              <Select value={subreddit} onValueChange={setSubreddit}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {subreddits.map((sub) => (
                    <SelectItem key={sub.id} value={sub.name}>
                      r/{sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Sentiment</Label>
              <Select value={sentiment} onValueChange={setSentiment}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="positive">Positive</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Time Range</Label>
              <Select value={since} onValueChange={setSince}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Any time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any time</SelectItem>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Min Score</Label>
              <Input
                type="number"
                placeholder="0"
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                className="w-24"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isPending && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isPending && hasSearched && results.length === 0 && (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No results found for &ldquo;{query}&rdquo;
        </div>
      )}

      {!isPending && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          {results.map((result) => (
            <Card key={result.postId}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="font-medium leading-tight">
                      {result.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">r/{result.subreddit}</span>
                      <span>·</span>
                      <span>Score: {result.score}</span>
                      {result.sentiment && (
                        <>
                          <span>·</span>
                          <Badge variant="outline" className="text-xs">
                            {result.sentiment}
                          </Badge>
                        </>
                      )}
                      {result.digestDate && (
                        <>
                          <span>·</span>
                          <span>
                            Digest: {new Date(result.digestDate).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                    {result.summarySnippet && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {result.summarySnippet}
                      </p>
                    )}
                    {result.matchHighlights.length > 0 && (
                      <div className="space-y-0.5">
                        {result.matchHighlights.map((highlight, i) => (
                          <p
                            key={i}
                            className="text-sm"
                            dangerouslySetInnerHTML={{ __html: highlight }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    #{result.relevanceRank}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/search/page.tsx apps/web/components/search-panel.tsx
git commit -m "feat(web): add search page with full-text search, filters, and results"
```

---

## Chunk 3: Dashboard Page

### Task 6: Dashboard page — trending topics, LLM metrics, crawl health

**Files:**
- Create: `apps/web/app/dashboard/page.tsx`
- Create: `apps/web/components/dashboard-panels.tsx`

- [ ] **Step 1: Create dashboard page RSC**

`apps/web/app/dashboard/page.tsx`:

```typescript
import {
  getTrendingTopics,
  getLlmMetrics,
  getCrawlStatus,
  listRuns,
} from "@/lib/dal";
import { serializeRun } from "@/lib/types";
import { DashboardPanels } from "@/components/dashboard-panels";

export default async function DashboardPage() {
  const [topics, metrics, crawlStatus, recentRuns] = await Promise.all([
    getTrendingTopics({ limit: 10, since: "7d" }),
    getLlmMetrics({ limit: 10 }),
    getCrawlStatus(),
    listRuns(5),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of trending topics, LLM usage, and system health
        </p>
      </div>
      <DashboardPanels
        topics={topics}
        metrics={metrics}
        crawlStatus={crawlStatus}
        recentRuns={recentRuns.items.map(serializeRun)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create dashboard panels client component**

`apps/web/components/dashboard-panels.tsx`:

```typescript
"use client";

import { Clock, Brain, Activity, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";
import type {
  TrendingTopic,
  LlmMetrics,
  CrawlStatusItem,
} from "@redgest/core";
import type { SerializedRun } from "@/lib/types";

interface DashboardPanelsProps {
  topics: TrendingTopic[];
  metrics: LlmMetrics;
  crawlStatus: CrawlStatusItem[];
  recentRuns: SerializedRun[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function DashboardPanels({
  topics,
  metrics,
  crawlStatus,
  recentRuns,
}: DashboardPanelsProps) {
  return (
    <div className="space-y-6">
      {/* Summary stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total LLM Calls</CardTitle>
            <Brain className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.summary.totalCalls}</div>
            <p className="text-xs text-muted-foreground">
              {formatTokens(metrics.summary.totalInputTokens + metrics.summary.totalOutputTokens)} tokens total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(metrics.summary.cacheHitRate * 100).toFixed(0)}%
            </div>
            <p className="text-xs text-muted-foreground">
              Avg latency: {metrics.summary.averageDurationMs.toFixed(0)}ms
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Subreddits</CardTitle>
            <TrendingUp className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{crawlStatus.length}</div>
            <p className="text-xs text-muted-foreground">
              {crawlStatus.filter((s) => s.lastCrawlStatus === "ok").length} healthy
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Trending Topics</CardTitle>
            <TrendingUp className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{topics.length}</div>
            <p className="text-xs text-muted-foreground">
              Last 7 days
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Trending Topics */}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-base">Trending Topics</CardTitle>
          </CardHeader>
          <CardContent>
            {topics.length === 0 ? (
              <p className="text-sm text-muted-foreground">No topics extracted yet</p>
            ) : (
              <div className="space-y-3">
                {topics.map((topic) => (
                  <div key={topic.name} className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-sm">{topic.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {topic.recentPostCount} posts
                      </span>
                    </div>
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {topic.frequency}×
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* LLM Usage by Task */}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-base">LLM Usage by Task</CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.byTask.length === 0 ? (
              <p className="text-sm text-muted-foreground">No LLM calls recorded</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Avg ms</TableHead>
                      <TableHead className="text-right">Cache</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.byTask.map((t) => (
                      <TableRow key={t.task}>
                        <TableCell className="font-mono text-sm">{t.task}</TableCell>
                        <TableCell className="text-right text-sm">{t.calls}</TableCell>
                        <TableCell className="text-right text-sm">
                          {formatTokens(t.inputTokens + t.outputTokens)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {t.avgDurationMs.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {(t.cacheHitRate * 100).toFixed(0)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Crawl Health */}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-base">Crawl Health</CardTitle>
          </CardHeader>
          <CardContent>
            {crawlStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subreddits configured</p>
            ) : (
              <div className="space-y-2">
                {crawlStatus.map((sub) => (
                  <div key={sub.subreddit} className="flex items-center justify-between rounded-md border p-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`size-2 rounded-full ${
                          sub.lastCrawlStatus === "ok"
                            ? "bg-green-500"
                            : sub.lastCrawlStatus === "failed"
                              ? "bg-red-500"
                              : "bg-slate-400"
                        }`}
                      />
                      <span className="font-mono text-sm">r/{sub.subreddit}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{sub.totalPosts} posts</span>
                      {sub.lastCrawledAt && (
                        <span>Last: {formatRelativeTime(sub.lastCrawledAt)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-base">Recent Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet</p>
            ) : (
              <div className="space-y-2">
                {recentRuns.map((run) => (
                  <div key={run.jobId} className="flex items-center justify-between rounded-md border p-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          run.status === "COMPLETED"
                            ? "default"
                            : run.status === "FAILED"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-xs"
                      >
                        {run.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {run.subredditCount} subs
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(run.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

Note: `formatRelativeTime` is imported from `@/lib/utils`. If it doesn't exist, add a simple implementation:

```typescript
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/dashboard/page.tsx apps/web/components/dashboard-panels.tsx apps/web/lib/utils.ts
git commit -m "feat(web): add dashboard page with trending topics, LLM metrics, crawl health"
```

---

## Chunk 4: Enhanced Subreddits Page

### Task 7: Add crawl status + stats columns to subreddit table

**Files:**
- Modify: `apps/web/components/subreddit-table.tsx`

The `SubredditView` already includes `crawlIntervalMinutes`, `nextCrawlAt`, `totalPostsFetched`, `totalDigestsAppearedIn`. The `SerializedSubreddit` already serializes `nextCrawlAt`. We just need to add table columns.

- [ ] **Step 1: Add stat columns to subreddit table**

In `subreddit-table.tsx`, add new `<TableHead>` columns after the existing ones:

```
| Name | Status | Insight Prompt | Posts Fetched | Digests | Crawl | Actions |
```

Add `TableHead` entries:
```tsx
<TableHead className="text-right">Posts</TableHead>
<TableHead className="text-right">Digests</TableHead>
<TableHead>Crawl</TableHead>
```

Add corresponding `TableCell` entries per row:
```tsx
<TableCell className="text-right text-sm tabular-nums">
  {sub.totalPostsFetched}
</TableCell>
<TableCell className="text-right text-sm tabular-nums">
  {sub.totalDigestsAppearedIn}
</TableCell>
<TableCell className="text-sm text-muted-foreground">
  {sub.nextCrawlAt ? (
    <Tooltip>
      <TooltipTrigger className="cursor-default">
        {formatRelativeTime(sub.nextCrawlAt)}
      </TooltipTrigger>
      <TooltipContent>
        Next crawl: {new Date(sub.nextCrawlAt).toLocaleString()}
        <br />
        Interval: {sub.crawlIntervalMinutes}min
      </TooltipContent>
    </Tooltip>
  ) : (
    "—"
  )}
</TableCell>
```

Import `formatRelativeTime` from `@/lib/utils`.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/subreddit-table.tsx
git commit -m "feat(web): add crawl status and stats columns to subreddit table"
```

---

## Chunk 5: Worker Unit Tests (TD-005)

### Task 8: Unit tests for generate-digest task

**Files:**
- Create: `apps/worker/src/trigger/__tests__/generate-digest.test.ts`

Tests mock: `@redgest/config`, `@redgest/db`, `@redgest/core`, `@redgest/reddit`, `@trigger.dev/sdk/v3`.

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies
vi.mock("@trigger.dev/sdk/v3", () => ({
  task: (config: { id: string; retry?: unknown; run: Function }) => ({
    ...config,
    trigger: vi.fn(),
  }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  idempotencyKeys: { create: vi.fn().mockResolvedValue("test-key") },
}));

vi.mock("@redgest/config", () => ({
  loadConfig: vi.fn(() => ({
    REDDIT_CLIENT_ID: "test-id",
    REDDIT_CLIENT_SECRET: "test-secret",
  })),
}));

vi.mock("@redgest/db", () => ({
  prisma: {
    job: { update: vi.fn() },
  },
}));

vi.mock("@redgest/core", () => ({
  DomainEventBus: vi.fn(() => ({ on: vi.fn(), emit: vi.fn() })),
  runDigestPipeline: vi.fn(),
}));

vi.mock("@redgest/reddit", () => ({
  RedditClient: vi.fn(),
  PublicRedditClient: vi.fn(),
  TokenBucket: vi.fn(),
  RedditContentSource: vi.fn(),
}));

describe("generate-digest task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runDigestPipeline with correct args", async () => {
    const { runDigestPipeline } = await import("@redgest/core");
    const pipelineMock = vi.mocked(runDigestPipeline);
    pipelineMock.mockResolvedValue({
      jobId: "job-1",
      status: "COMPLETED",
      digestId: "digest-1",
    });

    const { generateDigest } = await import("../generate-digest.js");
    const result = await generateDigest.run(
      { jobId: "job-1", subredditIds: ["sub-1", "sub-2"] },
    );

    expect(pipelineMock).toHaveBeenCalledWith(
      "job-1",
      ["sub-1", "sub-2"],
      expect.objectContaining({ db: expect.anything(), eventBus: expect.anything() }),
    );
    expect(result).toEqual({
      jobId: "job-1",
      status: "COMPLETED",
      digestId: "digest-1",
    });
  });

  it("marks job as FAILED on pre-pipeline error", async () => {
    const { runDigestPipeline } = await import("@redgest/core");
    vi.mocked(runDigestPipeline).mockRejectedValue(new Error("config error"));

    const { prisma } = await import("@redgest/db");
    const { generateDigest } = await import("../generate-digest.js");

    await expect(
      generateDigest.run({ jobId: "job-1", subredditIds: ["sub-1"] }),
    ).rejects.toThrow("config error");

    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("uses PublicRedditClient when credentials are missing", async () => {
    const { loadConfig } = await import("@redgest/config");
    vi.mocked(loadConfig).mockReturnValue({
      REDDIT_CLIENT_ID: "",
      REDDIT_CLIENT_SECRET: "",
    } as ReturnType<typeof loadConfig>);

    const { runDigestPipeline } = await import("@redgest/core");
    vi.mocked(runDigestPipeline).mockResolvedValue({
      jobId: "job-1",
      status: "COMPLETED",
      digestId: null,
    });

    const { PublicRedditClient } = await import("@redgest/reddit");

    // Re-import to get fresh module with new config
    vi.resetModules();
    // Restore mocks after resetModules...
    // (Implementation may need adjustment for module caching)
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter apps/worker exec vitest run src/trigger/__tests__/generate-digest.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/trigger/__tests__/generate-digest.test.ts
git commit -m "test(worker): add unit tests for generate-digest task"
```

---

### Task 9: Unit tests for deliver-digest task

**Files:**
- Create: `apps/worker/src/trigger/__tests__/deliver-digest.test.ts`

- [ ] **Step 1: Write tests**

Key test cases:
1. Sends to email + Slack when both configured
2. Skips when no channels configured (returns `{ delivered: [] }`)
3. Records pending delivery before sending
4. Records delivery results (success + failure)
5. Throws when ALL channels fail (triggers retry)
6. Succeeds even if one channel fails

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@trigger.dev/sdk/v3", () => ({
  task: (config: { id: string; retry?: unknown; run: Function }) => ({
    ...config,
    trigger: vi.fn(),
  }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@redgest/config", () => ({
  loadConfig: vi.fn(() => ({
    RESEND_API_KEY: "re_test",
    DELIVERY_EMAIL: "test@test.com",
    SLACK_WEBHOOK_URL: "https://hooks.slack.com/test",
  })),
}));

vi.mock("@redgest/db", () => ({
  prisma: {
    digest: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "digest-1",
        jobId: "job-1",
        digestPosts: [],
      }),
    },
  },
}));

vi.mock("@redgest/core", () => ({
  recordDeliveryPending: vi.fn(),
  recordDeliveryResult: vi.fn(),
}));

vi.mock("@redgest/email", () => ({
  sendDigestEmail: vi.fn().mockResolvedValue({ id: "email-id" }),
  buildDeliveryData: vi.fn(() => ({ title: "Test Digest", sections: [] })),
}));

vi.mock("@redgest/slack", () => ({
  sendDigestSlack: vi.fn().mockResolvedValue(undefined),
}));

describe("deliver-digest task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers to both email and slack", async () => {
    const { deliverDigest } = await import("../deliver-digest.js");
    const result = await deliverDigest.run({ digestId: "digest-1" });
    expect(result.delivered).toContain("email");
    expect(result.delivered).toContain("slack");
  });

  it("skips delivery when no channels configured", async () => {
    const { loadConfig } = await import("@redgest/config");
    vi.mocked(loadConfig).mockReturnValue({} as ReturnType<typeof loadConfig>);

    const { deliverDigest } = await import("../deliver-digest.js");
    const result = await deliverDigest.run({ digestId: "digest-1" });
    expect(result.delivered).toEqual([]);
  });

  it("throws when all channels fail", async () => {
    const { sendDigestEmail } = await import("@redgest/email");
    const { sendDigestSlack } = await import("@redgest/slack");
    vi.mocked(sendDigestEmail).mockRejectedValue(new Error("email failed"));
    vi.mocked(sendDigestSlack).mockRejectedValue(new Error("slack failed"));

    const { deliverDigest } = await import("../deliver-digest.js");
    await expect(
      deliverDigest.run({ digestId: "digest-1" }),
    ).rejects.toThrow("All delivery channels failed");
  });

  it("records delivery pending before sending", async () => {
    const { recordDeliveryPending } = await import("@redgest/core");
    const { deliverDigest } = await import("../deliver-digest.js");
    await deliverDigest.run({ digestId: "digest-1" });
    expect(recordDeliveryPending).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      "job-1",
      expect.arrayContaining(["EMAIL", "SLACK"]),
    );
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter apps/worker exec vitest run src/trigger/__tests__/deliver-digest.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/trigger/__tests__/deliver-digest.test.ts
git commit -m "test(worker): add unit tests for deliver-digest task"
```

---

### Task 10: Unit tests for scheduled-digest task

**Files:**
- Create: `apps/worker/src/trigger/__tests__/scheduled-digest.test.ts`

- [ ] **Step 1: Write tests**

Key test cases:
1. Legacy mode — triggers generate-digest for all active subreddits when no profiles exist
2. Profile mode — creates one job per active profile with schedule
3. Skips profiles with no subreddits
4. Returns `{ jobs: [], totalSubreddits: 0 }` when nothing active
5. Continues with other profiles when one dispatch fails

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@trigger.dev/sdk/v3", () => ({
  schedules: {
    task: (config: { id: string; cron: string; run: Function }) => config,
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  idempotencyKeys: { create: vi.fn().mockResolvedValue("test-key") },
  AbortTaskRunError: class extends Error {},
}));

const mockGenerateDigest = { trigger: vi.fn() };
vi.mock("./generate-digest.js", () => ({
  generateDigest: mockGenerateDigest,
}));

vi.mock("@redgest/db", () => ({
  prisma: {
    digestProfile: { findMany: vi.fn() },
    subreddit: { findMany: vi.fn() },
    job: { create: vi.fn(), update: vi.fn() },
  },
}));

describe("scheduled-digest task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateDigest.trigger.mockResolvedValue({ id: "run-1" });
  });

  it("legacy mode — all active subreddits when no profiles", async () => {
    const { prisma } = await import("@redgest/db");
    vi.mocked(prisma.digestProfile.findMany).mockResolvedValue([]);
    vi.mocked(prisma.subreddit.findMany).mockResolvedValue([
      { id: "sub-1" },
      { id: "sub-2" },
    ] as never);
    vi.mocked(prisma.job.create).mockResolvedValue({ id: "job-1" } as never);

    const { scheduledDigest } = await import("../scheduled-digest.js");
    const result = await scheduledDigest.run();

    expect(prisma.job.create).toHaveBeenCalled();
    expect(mockGenerateDigest.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", subredditIds: ["sub-1", "sub-2"] }),
      expect.anything(),
    );
    expect(result.totalSubreddits).toBe(2);
  });

  it("returns empty when nothing active", async () => {
    const { prisma } = await import("@redgest/db");
    vi.mocked(prisma.digestProfile.findMany).mockResolvedValue([]);
    vi.mocked(prisma.subreddit.findMany).mockResolvedValue([]);

    const { scheduledDigest } = await import("../scheduled-digest.js");
    const result = await scheduledDigest.run();

    expect(result.totalSubreddits).toBe(0);
    expect(mockGenerateDigest.trigger).not.toHaveBeenCalled();
  });

  it("profile mode — one job per active profile", async () => {
    const { prisma } = await import("@redgest/db");
    vi.mocked(prisma.digestProfile.findMany).mockResolvedValue([
      {
        id: "prof-1",
        name: "Morning",
        isActive: true,
        schedule: "0 7 * * *",
        lookbackHours: 24,
        subreddits: [{ subredditId: "sub-1" }],
      },
      {
        id: "prof-2",
        name: "Evening",
        isActive: true,
        schedule: "0 18 * * *",
        lookbackHours: 12,
        subreddits: [{ subredditId: "sub-2" }, { subredditId: "sub-3" }],
      },
    ] as never);
    vi.mocked(prisma.job.create)
      .mockResolvedValueOnce({ id: "job-1" } as never)
      .mockResolvedValueOnce({ id: "job-2" } as never);

    const { scheduledDigest } = await import("../scheduled-digest.js");
    const result = await scheduledDigest.run();

    expect(prisma.job.create).toHaveBeenCalledTimes(2);
    expect(mockGenerateDigest.trigger).toHaveBeenCalledTimes(2);
    expect(result.jobs).toHaveLength(2);
    expect(result.totalSubreddits).toBe(3);
  });

  it("skips profiles with no subreddits", async () => {
    const { prisma } = await import("@redgest/db");
    vi.mocked(prisma.digestProfile.findMany).mockResolvedValue([
      {
        id: "prof-1",
        name: "Empty",
        isActive: true,
        schedule: "0 7 * * *",
        lookbackHours: 24,
        subreddits: [],
      },
    ] as never);

    const { scheduledDigest } = await import("../scheduled-digest.js");
    const result = await scheduledDigest.run();

    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(result.jobs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter apps/worker exec vitest run src/trigger/__tests__/scheduled-digest.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/trigger/__tests__/scheduled-digest.test.ts
git commit -m "test(worker): add unit tests for scheduled-digest task (resolves TD-005)"
```

---

## Chunk 6: Playwright E2E Tests

### Task 11: Add Playwright smoke + interaction tests for Search and Dashboard

**Files:**
- Modify: `apps/web/tests/smoke.spec.ts`
- Modify: `apps/web/tests/interactions.spec.ts`

- [ ] **Step 1: Add smoke tests**

Add to `smoke.spec.ts`:

```typescript
test.describe("Search Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/search");
    await expect(
      page.getByRole("heading", { name: "Search" }),
    ).toBeVisible();
    await expect(
      page.getByText("Search across posts and digests"),
    ).toBeVisible();
  });
});

test.describe("Dashboard Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    await expect(
      page.getByText("Overview of trending topics"),
    ).toBeVisible();
  });
});
```

Update sidebar nav test to include "Search" and "Dashboard":
```typescript
await expect(sidebar.getByText("Dashboard")).toBeVisible();
await expect(sidebar.getByText("Search")).toBeVisible();
```

Update navigation test to include Search and Dashboard routes.

Update home redirect test to expect `/dashboard` instead of `/subreddits`.

- [ ] **Step 2: Add interaction tests**

Add to `interactions.spec.ts`:

```typescript
test.describe("Search Page", () => {
  test("shows search input and filter controls", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByPlaceholder("Search posts and summaries")).toBeVisible();
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  });

  test("search button is disabled with empty query", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("button", { name: "Search" })).toBeDisabled();
  });
});

test.describe("Dashboard Page", () => {
  test("shows summary stat cards", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Total LLM Calls")).toBeVisible();
    await expect(page.getByText("Cache Hit Rate")).toBeVisible();
    await expect(page.getByText("Active Subreddits")).toBeVisible();
    await expect(page.getByText("Trending Topics")).toBeVisible();
  });

  test("shows panel sections", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("LLM Usage by Task")).toBeVisible();
    await expect(page.getByText("Crawl Health")).toBeVisible();
    await expect(page.getByText("Recent Runs")).toBeVisible();
  });
});
```

- [ ] **Step 3: Run Playwright tests**

Run: `pnpm --filter apps/web exec playwright test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/smoke.spec.ts apps/web/tests/interactions.spec.ts
git commit -m "test(web): add Playwright smoke and interaction tests for Search and Dashboard"
```

---

## Chunk 7: Final Verification

### Task 12: Full verification

- [ ] **Step 1: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run unit tests**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 4: Run Playwright tests**

Run: `pnpm --filter apps/web exec playwright test`
Expected: All tests PASS

- [ ] **Step 5: Update project management files**

Update BACKLOG.md to mark all Sprint 11 tasks as `[x]` with dates and commit refs. Update SPRINTS.md to close Sprint 11. Move TD-005 to Resolved in TECH_DEBT.md.
