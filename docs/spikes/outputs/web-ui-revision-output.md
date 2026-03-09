# Research Revision: Redgest Next.js Config UI Architecture

## Summary of Changes

This revision fills 6 critical gaps from the original spike: (1) full component architecture for all 4 screens with server/client annotations and forced design decisions, (2) end-to-end read/write code examples through the CQRS + DAL pattern, (3) copy-pasteable project setup files for the TurboRepo monorepo, (4) the complete AddSubreddit validation chain from Zod schema to form component, (5) layout and navigation design with route structure, and (6) a substantive open questions section. The `proxy.ts` rename claim from the original research is **confirmed** — it's documented in the official Next.js 16 upgrade guide and blog post.

---

## Revisions

### UNVERIFIED → VERIFIED: `proxy.ts` Rename

**Original finding:** `middleware.ts` renamed to `proxy.ts` in Next.js 16.

**Problem:** Evaluation flagged this as potentially misattributed from a canary/RFC.

**Revised finding:** **Confirmed.** The official Next.js 16 blog post states: "proxy.ts replaces middleware.ts and makes the app's network boundary explicit. proxy.ts runs on the Node.js runtime." The upgrade guide at `nextjs.org/docs/app/guides/upgrading/version-16` documents the rename, the codemod (`npx @next/codemod@canary upgrade latest`), and the config flag renames (`skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`). The old `middleware.ts` still works but is deprecated and will be removed in a future version. Edge runtime is NOT supported in `proxy.ts` — keep using `middleware.ts` if you need edge.

**Impact for Redgest:** None. Redgest has no auth middleware. If you later add request interception (e.g., basic auth for VPN-less deployment), use `proxy.ts` with the Node.js runtime.

**Sources:** nextjs.org/blog/next-16, nextjs.org/docs/app/guides/upgrading/version-16, nextjs.org/docs/app/api-reference/file-conventions/proxy

### UNVERIFIED → VERIFIED: TanStack Query v5 HydrationBoundary

**Original finding:** Server prefetch + `HydrationBoundary` pattern for App Router.

**Revised finding:** **Confirmed for TanStack Query v5.** The API is `dehydrate(queryClient)` passed to `<HydrationBoundary state={...}>`. The official v5 docs at `tanstack.com/query/v5/docs/react/guides/advanced-ssr` show the exact App Router pattern. As of v5.40.0, you can even dehydrate *pending* queries for streaming. The key pattern: create a `QueryClient` in the server component, `prefetchQuery`, `dehydrate`, wrap children in `HydrationBoundary`. The TanStack example repo (`tanstack.com/query/v5/docs/framework/react/examples/nextjs-app-prefetching`) confirms this is the canonical approach.

**Sources:** tanstack.com/query/v5/docs/react/guides/advanced-ssr, tanstack.com/query/v5/docs/framework/react/examples/nextjs-app-prefetching

### UNVERIFIED → VERIFIED: `@vpfaiz/cron-builder-ui`

**Original finding:** Mentioned as "v1.0.1, very new."

**Revised finding:** **Exists on npm**, v1.0.1, published ~7 months ago. MIT licensed, built with Radix UI + Tailwind CSS, uses `cronstrue` for human-readable display. Supports dark mode via CSS custom properties. **Zero dependents on npm**, single author, no other published packages. The API is clean (`<CronBuilder onChange={fn} defaultValue={expr} />`). **Risk assessment:** Functional but unmaintained-risk. For Redgest: **use it for Phase 1** — the API surface is small enough that if the package dies, you can fork or replace with a custom ShadCN Select-based builder in a few hours. The alternative (building from scratch) costs more upfront for no clear gain.

**Sources:** npmjs.com/package/@vpfaiz/cron-builder-ui, github.com/vpfaiz/cron-builder-ui

### UNVERIFIED → VERIFIED: Trigger.dev Server Action Triggering

**Original finding:** `tasks.trigger()` from `@trigger.dev/sdk` works in Server Actions.

**Revised finding:** **Confirmed and officially documented.** The Trigger.dev Next.js setup guide shows the exact pattern: a `"use server"` file importing `tasks` from `@trigger.dev/sdk` and calling `tasks.trigger<typeof myTask>("task-id", payload)`. They also have an official example repo specifically for Server Actions (`triggerdotdev/nextjs-realtime-simple-demo`). The `@trigger.dev/nextjs` package is deprecated (v2) — in v4, you only need `@trigger.dev/sdk`. The `TRIGGER_SECRET_KEY` env var must be available at runtime. No Route Handler needed.

**Sources:** trigger.dev/docs/guides/frameworks/nextjs, trigger.dev/changelog/example-projects, trigger.dev/launchweek/2/trigger-v4-ga

---

## Revised Deliverables

### Deliverable C: Layout & Navigation Design

**Decision: Multi-page with ShadCN Sidebar.** Not tabs, not dashboard cards.

**Rationale:** A 4-screen admin panel with distinct concerns (CRUD, settings, monitoring, actions) maps naturally to separate routes. Tabs collapse navigation into a single URL, making deep-linking and browser history useless. Dashboard cards add a landing page that's wasted screen for a single-user tool with 4 items. The ShadCN Sidebar is purpose-built for this — collapsible, keyboard-accessible (Cmd+B), mobile-responsive via Sheet, and includes 15+ layout blocks.

**Route structure:**

```
apps/web/app/
├── layout.tsx              # Root: ThemeProvider, QueryClientProvider, SidebarProvider
├── page.tsx                # Redirect to /subreddits
├── subreddits/
│   ├── page.tsx            # (server) Subreddit Manager — fetches list, renders table
│   └── actions.ts          # (server) addSubreddit, updateSubreddit, deleteSubreddit, toggleActive
├── settings/
│   ├── page.tsx            # (server) Global Settings — fetches current config
│   └── actions.ts          # (server) updateSettings
├── runs/
│   ├── page.tsx            # (server) Run History — prefetches recent runs
│   ├── actions.ts          # (server) getRunStatus (for polling endpoint)
│   └── [id]/
│       └── page.tsx        # (server) Run Detail — single run with full digest output
└── trigger/
    ├── page.tsx            # (server) Manual Trigger form
    └── actions.ts          # (server) triggerDigest
```

**Layout component tree:**

```
layout.tsx (server)
├── ThemeProvider defaultTheme="dark" attribute="class"
│   └── QueryClientProvider
│       └── SidebarProvider defaultOpen={true}
│           ├── AppSidebar (client)
│           │   ├── SidebarHeader → Logo + "Redgest" text
│           │   ├── SidebarContent
│           │   │   └── SidebarGroup
│           │   │       ├── SidebarMenuItem icon=List  label="Subreddits"  href="/subreddits"
│           │   │       ├── SidebarMenuItem icon=Settings label="Settings" href="/settings"
│           │   │       ├── SidebarMenuItem icon=History label="Runs"      href="/runs"
│           │   │       └── SidebarMenuItem icon=Play   label="Trigger"    href="/trigger"
│           │   └── SidebarFooter → SidebarTrigger (collapse toggle)
│           └── SidebarInset
│               ├── Header: breadcrumb (SidebarTrigger + page title)
│               └── main: {children} (page content with p-6)
```

**Active state:** Use `usePathname()` in the `AppSidebar` client component to match the current route against `href`. ShadCN Sidebar provides `isActive` prop on `SidebarMenuButton`.

**Mobile:** ShadCN Sidebar auto-collapses to a Sheet (slide-out drawer) on mobile breakpoints. This is built-in behavior. No extra work needed.

**Default route:** `/` redirects to `/subreddits` via `redirect()` in a server component. No dashboard page.

---

### Deliverable B: Component Architecture (All 4 Screens)

#### Screen 1: Subreddit Manager (`/subreddits`)

**Design decisions:**
- **DataTable (TanStack Table):** Yes. Even for 20-50 subs, the sorting/filtering/column visibility primitives are worth it. The ShadCN DataTable guide scaffolds this cleanly.
- **Editing:** Sheet (slide-out panel). The insight prompt textarea needs room — inline editing in table cells is hostile UX for long text. Table rows show truncated prompt (first 80 chars + ellipsis). Click a row → Sheet opens with full edit form.
- **Add subreddit:** Button above the table ("+ Add Subreddit") opens the same Sheet component in "create" mode (empty form).
- **Delete:** Row action dropdown (⋯ menu) → "Delete" opens ShadCN `AlertDialog` for confirmation.
- **`isActive` toggle:** Immediate server action via `useOptimistic`. No save button. Toggle fires `toggleSubredditActive` action, UI updates instantly, rolls back on error.

```
/subreddits/page.tsx (server)
├── Fetches subreddit list via getSubreddits() from @redgest/core
├── Passes serialized data to SubredditManager
│
└── SubredditManager (client — "use client")
    ├── State: sheetOpen, selectedSubreddit (null = create, object = edit)
    ├── DataTable
    │   ├── columns:
    │   │   ├── Name (sortable)
    │   │   ├── Insight Prompt (truncated, 80 chars)
    │   │   ├── Max Posts (number)
    │   │   ├── NSFW (Badge: yes/no)
    │   │   ├── Active (Switch — fires toggleActive immediately)
    │   │   └── Actions (DropdownMenu: Edit, Delete)
    │   ├── DataTableToolbar
    │   │   ├── Search input (filters by name)
    │   │   └── Button "+ Add Subreddit" → opens Sheet
    │   └── DataTablePagination (if > 20 rows, otherwise hidden)
    │
    ├── SubredditSheet (Sheet)
    │   ├── SheetHeader: "Add Subreddit" or "Edit {name}"
    │   └── SubredditForm (client)
    │       ├── RHF useForm with zodResolver(subredditSchema)
    │       ├── Fields: name (Input), insightPrompt (Textarea rows=6),
    │       │   maxPosts (Input type=number), includeNsfw (Switch), isActive (Switch)
    │       ├── useActionState(addOrUpdateSubreddit, initialState)
    │       └── SubmitButton with useFormStatus pending
    │
    └── DeleteConfirmDialog (AlertDialog)
        ├── "Are you sure? This will stop monitoring r/{name}."
        └── Confirm fires deleteSubreddit action
```

**Data fetching:** Server component calls `getSubreddits()` from `@redgest/core`, which returns `SubredditView[]` (serialization-safe plain objects with ISO date strings). Data is passed as props to the client DataTable.

**Mutations:**
- `addSubreddit(prevState, formData)` → Zod validate → `commandBus.execute(AddSubreddit)` → `revalidatePath('/subreddits')`
- `updateSubreddit(prevState, formData)` → same pattern with `UpdateSubreddit` command
- `deleteSubreddit(id)` → `commandBus.execute(DeleteSubreddit)` → `revalidatePath('/subreddits')`
- `toggleSubredditActive(id, isActive)` → called from `useOptimistic` handler → `commandBus.execute(ToggleSubredditActive)` → `revalidatePath('/subreddits')`

**ShadCN components:** `DataTable` (guide), `Sheet`, `SheetHeader`, `SheetContent`, `Form`, `FormField`, `FormItem`, `FormControl`, `FormMessage`, `Input`, `Textarea`, `Switch`, `Button`, `AlertDialog`, `DropdownMenu`, `Badge`, `Table`, `TableHeader`, `TableRow`, `TableCell`

**Loading:** `loading.tsx` sibling file with `Skeleton` rows matching table layout.
**Error:** `error.tsx` sibling with retry button.
**Empty state:** When `subreddits.length === 0`, show centered card: "No subreddits configured. Add one to get started." + Add button.

#### Screen 2: Global Settings (`/settings`)

**Design decisions:**
- **Single form, single save button.** Settings are a cohesive unit — field-by-field saving creates confusing partial states.
- **Cron input:** `@vpfaiz/cron-builder-ui` with a ShadCN Tabs wrapper offering "Presets" (common schedules as radio buttons) and "Custom" (the cron builder). Below the builder, show human-readable text via `getCronText()`.
- **LLM model:** `Input` with `datalist` of known models (hardcoded common ones: `claude-sonnet-4-20250514`, `gpt-4o`, `gpt-4o-mini`). User can type any string. The datalist provides suggestions without constraining.
- **Unsaved changes:** Visual indicator only. The save `Button` shows "Save Changes" when form is dirty (via RHF `formState.isDirty`), dimmed "Saved" when clean. No `beforeunload` — overkill for a personal tool.
- **Validation:** Client-side via RHF `onBlur` mode + server-side Zod in the action. Double validation.

```
/settings/page.tsx (server)
├── Fetches current config via getGlobalSettings() from @redgest/core
├── Passes serialized settings to SettingsForm
│
└── SettingsForm (client — "use client")
    ├── RHF useForm with zodResolver(globalSettingsSchema)
    ├── useActionState(updateSettings, initialState)
    │
    ├── Card: "Insight Configuration"
    │   ├── globalInsightPrompt (Textarea rows=8, placeholder="Describe what interests you...")
    │   └── defaultLookbackPeriod (Select: 12h, 24h, 48h, 7d)
    │
    ├── Card: "LLM Configuration"
    │   ├── llmProvider (Select: anthropic, openai)
    │   └── llmModel (Input with datalist)
    │
    ├── Card: "Delivery"
    │   └── defaultDeliveryChannels (multi-select checkboxes: Email, Slack, None)
    │
    ├── Card: "Schedule"
    │   ├── Tabs: "Presets" | "Custom"
    │   │   ├── Presets: RadioGroup (Daily 9am, Twice daily, Weekly Monday, Every 6 hours)
    │   │   └── Custom: CronBuilder component
    │   └── Human-readable display: "Runs at 09:00 AM, every day"
    │
    └── Footer
        └── Button type="submit" (shows "Save Changes" if dirty, "Saved ✓" if clean)
            └── SubmitButton with useFormStatus pending spinner
```

**ShadCN components:** `Card`, `CardHeader`, `CardContent`, `Form`, `FormField`, `Textarea`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `Input`, `Checkbox`, `RadioGroup`, `RadioGroupItem`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Button`, `Label`

#### Screen 3: Run History (`/runs`)

**Design decisions:**
- **Pagination:** "Last 50 runs" with a "Load more" button. No offset pagination UI. For a personal tool generating 1-3 runs/day, 50 rows covers weeks of history. Cursor-based load-more is trivial to add.
- **Polling:** TanStack Query `useQuery` with `refetchInterval: 5000` on a Route Handler (`/api/runs`). Only polls when there are `running` or `queued` runs (conditional via `refetchInterval: (query) => hasActiveRuns(query.state.data) ? 5000 : false`). Only the status cells re-render thanks to TanStack Table's cell-level memoization.
- **Expandable rows:** TanStack Table row expansion (built-in). Click row → expands inline showing digest summary, error details, delivery status. NOT a Sheet, NOT a sub-route. The sub-route `/runs/[id]` exists for direct-link access (from Manual Trigger redirect) but the primary UX is inline expansion.
- **Status badges:** `queued` → gray, `running` → blue with `animate-pulse`, `completed` → green, `failed` → red, `partial` → amber. All using ShadCN `Badge` with custom variant classes.
- **Markdown digest viewer:** `react-markdown` with `remark-gfm` inside a `<div className="prose prose-invert prose-sm max-w-none">`. That's it — no extra setup needed.

```
/runs/page.tsx (server)
├── Prefetches recent runs via TanStack Query prefetchQuery
├── Wraps content in HydrationBoundary
│
└── RunHistoryTable (client — "use client")
    ├── useQuery(['runs'], fetchRuns, { refetchInterval: dynamicInterval })
    ├── DataTable with expandable rows
    │   ├── columns:
    │   │   ├── Timestamp (formatted, sortable)
    │   │   ├── Status (Badge with color + pulse for running)
    │   │   ├── Subreddits (comma-separated list, truncated)
    │   │   ├── Duration (formatted: "2m 34s" or "—" if running)
    │   │   ├── Posts (count)
    │   │   └── Delivery (icon badges: Mail, MessageSquare)
    │   │
    │   └── Expanded row content:
    │       └── RunDetail (client)
    │           ├── Tabs: "Digest" | "Errors" | "Delivery"
    │           ├── Digest tab: <ReactMarkdown remarkPlugins={[remarkGfm]}>{digest}</ReactMarkdown>
    │           ├── Errors tab: pre-formatted error stack (only if status=failed)
    │           └── Delivery tab: per-channel status (sent/failed/skipped)
    │
    └── "Load more" button (fetches next page, appends to list)

/runs/[id]/page.tsx (server)
├── Fetches single run via getRunById(id) from @redgest/core
└── Renders same RunDetail component (full page layout, not in table)
```

**Polling Route Handler (`/api/runs/route.ts`):**
```typescript
import { getRecentRuns } from '@redgest/core';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get('cursor');
  const limit = Number(searchParams.get('limit') ?? '50');
  const runs = await getRecentRuns({ cursor, limit });
  return NextResponse.json(runs);
}
```

Using a Route Handler here (not a Server Action) because TanStack Query needs a GET endpoint for `refetchInterval` polling. Server Actions use POST and lack caching semantics.

**ShadCN components:** `DataTable`, `Badge`, `Button`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Skeleton`

#### Screen 4: Manual Trigger (`/trigger`)

**Design decisions:**
- **Location:** Dedicated page at `/trigger`. Also add a "Quick Trigger" button in the sidebar footer that navigates here. Not a floating action button (those belong in mobile apps, not admin panels).
- **Subreddit multi-select:** ShadCN `Command` combobox (popover with search + checkboxes). Pre-populated from configured active subreddits. Default: all active subs selected.
- **Post-submit:** Server action returns `{ runId }`. Client navigates to `/runs` with the new run ID as a query param (`/runs?highlight={runId}`). The Run History table auto-highlights that row and scrolls to it. Toast notification: "Digest run started."
- **Disable during running:** No. Allow concurrent runs — the pipeline should handle it. Show a warning if a run is already in progress: "A run is currently in progress. Starting another may cause overlapping results."

```
/trigger/page.tsx (server)
├── Fetches active subreddits via getActiveSubreddits()
├── Fetches current run status via getActiveRun()
│
└── TriggerForm (client — "use client")
    ├── State: selectedSubreddits (default: all active)
    ├── useActionState(triggerDigest, initialState)
    │
    ├── Warning banner (if activeRun exists): "A run is in progress..."
    │
    ├── Card: "Trigger Digest Run"
    │   ├── Subreddit multi-select (Command combobox)
    │   ├── Lookback override (Select: "Default", 12h, 24h, 48h, 7d)
    │   ├── Delivery override (checkbox group: Email, Slack, or "Use default")
    │   └── Button "Run Digest" with Play icon
    │       └── useFormStatus pending → "Starting..." with spinner
    │
    └── On success: router.push(`/runs?highlight=${runId}`) + toast
```

**Trigger server action:**
```typescript
'use server';
import type { generateDigestTask } from '@redgest/tasks';
import { tasks } from '@trigger.dev/sdk';
import { revalidatePath } from 'next/cache';

export async function triggerDigest(prevState: TriggerState, formData: FormData) {
  const subreddits = formData.getAll('subreddits') as string[];
  const lookback = formData.get('lookback') as string | null;
  const delivery = formData.getAll('delivery') as string[];

  const handle = await tasks.trigger<typeof generateDigestTask>(
    'digest.generate',
    { subreddits, lookback, delivery }
  );

  revalidatePath('/runs');
  return { success: true, runId: handle.id };
}
```

**ShadCN components:** `Card`, `Button`, `Command`, `CommandInput`, `CommandList`, `CommandItem`, `Checkbox`, `Select`, `Alert`, `AlertDescription`

---

### Deliverable A: Architecture Code Examples

#### Read Flow: Loading the Subreddit List

**`packages/db/src/client.ts`** — Prisma singleton

```typescript
import { PrismaClient } from '../generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
```

**`packages/db/src/index.ts`** — Package entry point

```typescript
export { prisma } from './client';
export type { Subreddit, GlobalSettings, DigestRun } from '../generated/prisma';
```

**`packages/core/src/queries/get-subreddits.ts`** — Query handler

```typescript
import { prisma } from '@redgest/db';

export interface SubredditView {
  id: string;
  name: string;
  insightPrompt: string | null;
  maxPosts: number;
  includeNsfw: boolean;
  isActive: boolean;
  createdAt: string; // ISO string — serialization-safe
  updatedAt: string;
}

export async function getSubreddits(): Promise<SubredditView[]> {
  const subreddits = await prisma.subreddit.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      insightPrompt: true,
      maxPosts: true,
      includeNsfw: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Serialize dates for the RSC → Client Component boundary
  return subreddits.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
}
```

**`apps/web/app/subreddits/page.tsx`** — Server Component

```typescript
import { getSubreddits } from '@redgest/core/queries/get-subreddits';
import { SubredditManager } from './subreddit-manager';

export default async function SubredditsPage() {
  const subreddits = await getSubreddits();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Subreddits</h1>
        <p className="text-muted-foreground text-sm">
          Manage the subreddits Redgest monitors for your digests.
        </p>
      </div>
      <SubredditManager initialData={subreddits} />
    </div>
  );
}
```

**`apps/web/app/subreddits/subreddit-manager.tsx`** — Client Component (simplified for read flow)

```typescript
'use client';

import { type SubredditView } from '@redgest/core/queries/get-subreddits';
import { DataTable } from '@/components/data-table';
import { columns } from './columns';

interface Props {
  initialData: SubredditView[];
}

export function SubredditManager({ initialData }: Props) {
  // initialData comes from the server component — no loading state needed
  return <DataTable columns={columns} data={initialData} />;
}
```

#### Write Flow: Adding a New Subreddit

See **Deliverable G** below for the full chain (Zod schema → command handler → server action → form component). That IS the write flow.

---

### Deliverable D: Project Setup Guide

#### 1. `apps/web/package.json`

```json
{
  "name": "@redgest/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --max-warnings 0",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@redgest/core": "workspace:*",
    "@redgest/db": "workspace:*",
    "@redgest/ui": "workspace:*",
    "@hookform/resolvers": "^4.1.0",
    "@tanstack/react-query": "^5.66.0",
    "@tanstack/react-table": "^8.21.0",
    "@trigger.dev/sdk": "^4.4.0",
    "lucide-react": "^0.474.0",
    "next": "^16.1.0",
    "next-themes": "^0.4.4",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-hook-form": "^7.54.0",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@redgest/config": "workspace:*",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "tailwindcss": "^4.0.0",
    "tw-animate-css": "^1.0.0",
    "typescript": "^5.7.0",
    "vitest": "^4.0.0"
  }
}
```

#### 2. `apps/web/next.config.ts`

```typescript
import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // Vendor-agnostic deployment: self-contained Node.js server
  output: 'standalone',

  // Required for standalone mode in a monorepo — tells Next.js where the root is
  // so file tracing captures dependencies from packages/*
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),

  // Transpile internal monorepo packages (required for Turbopack in monorepos)
  transpilePackages: ['@redgest/core', '@redgest/db', '@redgest/ui'],

  // Disable image optimization CDN — no Vercel dependency
  // Uses sharp (auto-installed) for local optimization
  images: {
    unoptimized: false, // sharp handles it in standalone mode
  },
};

export default nextConfig;
```

#### 3. `apps/web/tsconfig.json`

```json
{
  "extends": "@redgest/config/tsconfig.nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/components/*": ["./src/components/*"],
      "@/lib/*": ["./src/lib/*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

#### 4. `apps/web/components.json` (ShadCN for the web app)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@redgest/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

#### 5. `packages/ui/components.json` (ShadCN for shared UI)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/globals.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "src/components",
    "utils": "src/lib/utils",
    "ui": "src/components/ui",
    "lib": "src/lib",
    "hooks": "src/hooks"
  }
}
```

#### 6. `apps/web/src/app/globals.css`

```css
@import "tailwindcss";
@import "tw-animate-css";

/* ShadCN Tailwind v4 theme — OKLCH color tokens, dark mode default */
@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: oklch(0.145 0 0);
  --color-foreground: oklch(0.985 0 0);
  --color-card: oklch(0.17 0 0);
  --color-card-foreground: oklch(0.985 0 0);
  --color-popover: oklch(0.17 0 0);
  --color-popover-foreground: oklch(0.985 0 0);
  --color-primary: oklch(0.985 0 0);
  --color-primary-foreground: oklch(0.205 0 0);
  --color-secondary: oklch(0.269 0 0);
  --color-secondary-foreground: oklch(0.985 0 0);
  --color-muted: oklch(0.269 0 0);
  --color-muted-foreground: oklch(0.708 0 0);
  --color-accent: oklch(0.269 0 0);
  --color-accent-foreground: oklch(0.985 0 0);
  --color-destructive: oklch(0.396 0.141 25.723);
  --color-destructive-foreground: oklch(0.985 0 0);
  --color-border: oklch(0.3 0 0);
  --color-input: oklch(0.3 0 0);
  --color-ring: oklch(0.556 0 0);
  --color-chart-1: oklch(0.488 0.243 264.376);
  --color-chart-2: oklch(0.696 0.17 162.48);
  --color-chart-3: oklch(0.769 0.188 70.08);
  --color-chart-4: oklch(0.627 0.265 303.9);
  --color-chart-5: oklch(0.645 0.246 16.439);
  --color-sidebar: oklch(0.17 0 0);
  --color-sidebar-foreground: oklch(0.985 0 0);
  --color-sidebar-primary: oklch(0.488 0.243 264.376);
  --color-sidebar-primary-foreground: oklch(0.985 0 0);
  --color-sidebar-accent: oklch(0.269 0 0);
  --color-sidebar-accent-foreground: oklch(0.985 0 0);
  --color-sidebar-border: oklch(0.3 0 0);
  --color-sidebar-ring: oklch(0.556 0 0);
  --radius: 0.625rem;
  --sidebar-width: 16rem;
  --sidebar-width-icon: 3rem;
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

Note: This is a dark-only theme. There are no light mode variable overrides because the original research spec says "dark mode default, light mode is nice-to-have." If you later want light mode, add the light variants inside `@theme inline` wrapped in a media query or class conditional.

#### 7. `turbo.json` (full file)

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "globalEnv": ["DATABASE_URL", "TRIGGER_SECRET_KEY", "TRIGGER_API_URL"],
  "tasks": {
    "build": {
      "dependsOn": ["^build", "^db:generate"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"],
      "env": ["DATABASE_URL", "TRIGGER_SECRET_KEY"]
    },
    "dev": {
      "dependsOn": ["^db:generate"],
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^db:generate"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^db:generate"],
      "outputs": []
    },
    "db:generate": {
      "cache": false,
      "outputs": ["generated/**"]
    },
    "db:push": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    }
  }
}
```

#### 8. `packages/db/package.json`

```json
{
  "name": "@redgest/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/adapter-pg": "^7.4.0",
    "@prisma/client": "^7.4.0",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "prisma": "^7.4.0",
    "typescript": "^5.7.0"
  }
}
```

Note: The `exports` field uses raw `.ts` — this is the JIT packaging pattern for TurboRepo. No build step for `packages/db`. Turbopack/Next.js transpiles it directly via `transpilePackages`.

---

### Deliverable G: Shared Validation — Complete AddSubreddit Chain

#### 1. `packages/core/src/schemas/subreddit.ts`

```typescript
import { z } from 'zod';

// Validates subreddit name format: 2-21 alphanumeric + underscores, no spaces
const subredditNameRegex = /^[a-zA-Z0-9_]{2,21}$/;

export const addSubredditSchema = z.object({
  name: z
    .string()
    .min(2, 'Subreddit name must be at least 2 characters')
    .max(21, 'Subreddit name must be at most 21 characters')
    .regex(subredditNameRegex, 'Only letters, numbers, and underscores allowed')
    .transform((v) => v.replace(/^r\//, '')), // Strip leading "r/" if user includes it
  insightPrompt: z
    .string()
    .max(2000, 'Insight prompt must be under 2000 characters')
    .optional()
    .default(''),
  maxPosts: z
    .number({ coerce: true })
    .int()
    .min(1, 'Must fetch at least 1 post')
    .max(100, 'Maximum 100 posts per subreddit')
    .default(25),
  includeNsfw: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type AddSubredditInput = z.infer<typeof addSubredditSchema>;

// Derive update schema — all fields optional except id
export const updateSubredditSchema = addSubredditSchema.partial().extend({
  id: z.string().uuid(),
});

export type UpdateSubredditInput = z.infer<typeof updateSubredditSchema>;
```

#### 2. `packages/core/src/commands/add-subreddit.ts`

```typescript
import { prisma } from '@redgest/db';
import { addSubredditSchema, type AddSubredditInput } from '../schemas/subreddit';
import { eventBus } from '../events/bus';

export async function executeAddSubreddit(rawInput: unknown) {
  // Server-side validation backstop — always validate, even if client already did
  const result = addSubredditSchema.safeParse(rawInput);

  if (!result.success) {
    return {
      success: false as const,
      errors: result.error.flatten().fieldErrors,
      message: 'Validation failed',
    };
  }

  const input: AddSubredditInput = result.data;

  // Check for duplicate subreddit name
  const existing = await prisma.subreddit.findFirst({
    where: { name: { equals: input.name, mode: 'insensitive' } },
  });

  if (existing) {
    return {
      success: false as const,
      errors: { name: ['This subreddit is already being monitored'] },
      message: 'Duplicate subreddit',
    };
  }

  const subreddit = await prisma.subreddit.create({
    data: {
      name: input.name,
      insightPrompt: input.insightPrompt || null,
      maxPosts: input.maxPosts,
      includeNsfw: input.includeNsfw,
      isActive: input.isActive,
    },
  });

  eventBus.emit('SubredditAdded', {
    id: subreddit.id,
    name: subreddit.name,
  });

  return { success: true as const, id: subreddit.id };
}
```

#### 3. `apps/web/app/subreddits/actions.ts`

```typescript
'use server';

import { executeAddSubreddit } from '@redgest/core/commands/add-subreddit';
import { revalidatePath } from 'next/cache';

export type ActionState = {
  success?: boolean;
  errors?: Record<string, string[]>;
  message?: string;
};

const initialState: ActionState = {};

export async function addSubreddit(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const raw = {
    name: formData.get('name'),
    insightPrompt: formData.get('insightPrompt'),
    maxPosts: formData.get('maxPosts'),
    includeNsfw: formData.get('includeNsfw') === 'on',
    isActive: formData.get('isActive') === 'on',
  };

  const result = await executeAddSubreddit(raw);

  if (!result.success) {
    return {
      success: false,
      errors: result.errors,
      message: result.message,
    };
  }

  revalidatePath('/subreddits');
  return { success: true, message: 'Subreddit added' };
}
```

#### 4. `apps/web/app/subreddits/add-subreddit-form.tsx`

```typescript
'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addSubredditSchema, type AddSubredditInput } from '@redgest/core/schemas/subreddit';
import { addSubreddit, type ActionState } from './actions';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription,
} from '@redgest/ui/components/form';
import { Input } from '@redgest/ui/components/input';
import { Textarea } from '@redgest/ui/components/textarea';
import { Switch } from '@redgest/ui/components/switch';
import { Button } from '@redgest/ui/components/button';
import { useEffect, useRef } from 'react';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding...' : 'Add Subreddit'}
    </Button>
  );
}

interface AddSubredditFormProps {
  onSuccess?: () => void;
}

export function AddSubredditForm({ onSuccess }: AddSubredditFormProps) {
  const [state, formAction] = useActionState<ActionState, FormData>(addSubreddit, {});

  const form = useForm<AddSubredditInput>({
    resolver: zodResolver(addSubredditSchema),
    defaultValues: {
      name: '',
      insightPrompt: '',
      maxPosts: 25,
      includeNsfw: false,
      isActive: true,
    },
    mode: 'onBlur', // Client-side validation on blur
  });

  const formRef = useRef<HTMLFormElement>(null);

  // Handle successful server response
  useEffect(() => {
    if (state.success) {
      form.reset();
      onSuccess?.();
    }
  }, [state.success, form, onSuccess]);

  // Surface server-side validation errors in RHF
  useEffect(() => {
    if (state.errors) {
      Object.entries(state.errors).forEach(([field, messages]) => {
        form.setError(field as keyof AddSubredditInput, {
          type: 'server',
          message: messages[0],
        });
      });
    }
  }, [state.errors, form]);

  return (
    <Form {...form}>
      <form ref={formRef} action={formAction} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subreddit Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. LocalLLaMA" {...field} />
              </FormControl>
              <FormDescription>Without the r/ prefix.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="insightPrompt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Insight Prompt</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  placeholder="What interests you about this subreddit? e.g., 'Focus on new model releases, benchmarks, and novel architectures. Skip memes and basic tutorials.'"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Guides the LLM on what to look for. Leave blank to use the global prompt.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="maxPosts"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max Posts</FormLabel>
                <FormControl>
                  <Input type="number" min={1} max={100} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex items-center gap-6">
          <FormField
            control={form.control}
            name="includeNsfw"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Switch
                    name={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className="!mt-0">Include NSFW</FormLabel>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Switch
                    name={field.name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormLabel className="!mt-0">Active</FormLabel>
              </FormItem>
            )}
          />
        </div>

        {state.message && !state.success && (
          <p className="text-destructive text-sm">{state.message}</p>
        )}

        <SubmitButton />
      </form>
    </Form>
  );
}
```

**How RHF + useActionState work together here:**
- RHF provides instant client-side validation via `zodResolver` on blur — the user sees errors before submitting.
- The `<form action={formAction}>` wires directly to the server action via `useActionState`.
- When the form submits, RHF's validation runs first (client-side). If it passes, the native form submission fires and hits the server action.
- The server action runs `safeParse` again as a backstop (never trust the client).
- Server errors (like duplicate subreddit) flow back through `state.errors` and are injected into RHF via `form.setError()` in the `useEffect`.
- `useFormStatus` provides the pending state for the submit button.

---

### Deliverable H: Open Questions

#### 1. Prisma 7 + Turbopack in Production — UNTESTED COMBINATION

**What I know:** Prisma 7 outputs a pure ESM TypeScript client. Turbopack is the default Next.js 16 bundler. Both are individually production-ready.

**What I don't know:** Whether anyone has run this exact combination (Prisma 7 ESM client → imported through a TurboRepo workspace package → bundled by Turbopack) in production. The Prisma TurboRepo guide (`prisma.io/docs/guides/turborepo`) covers the monorepo setup but doesn't specifically address Turbopack compatibility. The known issue with Turbopack and `transpilePackages` (GitHub #85316) may interact with Prisma's generated client.

**Risk:** Medium. If Turbopack fails to resolve the Prisma generated client, the `--webpack` flag is a zero-effort fallback. Dev experience degrades (slower HMR) but functionality is unaffected.

**Next step:** Build a minimal reproduction (Next.js 16 + Turbopack + Prisma 7 in TurboRepo) and run `next build` before committing to the full implementation. This takes 30 minutes and eliminates the risk entirely.

#### 2. Turbopack Dev vs. Webpack Production Build Mismatch

**What I know:** `next dev` uses Turbopack by default. `next build` with `output: "standalone"` uses webpack. This is the documented behavior in Next.js 16.

**What I don't know:** Whether behavioral differences exist between Turbopack-bundled dev and webpack-bundled production for Redgest's specific patterns (internal monorepo imports, Prisma client usage, Server Actions). The Next.js team's position is that the output should be identical, but edge cases exist with module resolution and tree-shaking.

**Risk:** Low. For a 4-screen admin panel without exotic module patterns, the risk is minimal. If issues appear, they'll manifest as build-time errors (caught in CI), not silent runtime bugs.

**Next step:** Run the production build early and often. Add `turbo build` to the development loop (e.g., pre-push hook) to catch discrepancies immediately.

#### 3. React Compiler Benefit for This Use Case

**What I know:** `reactCompiler: true` is stable in Next.js 16. It auto-memoizes components, eliminating the need for manual `useMemo`/`useCallback`.

**What I don't know:** The actual performance impact for a 4-screen admin panel with one concurrent user. The compiler adds build complexity and may interact unpredictably with third-party libraries (RHF, TanStack Table, ShadCN internals).

**Risk:** Low both ways. Enabling it probably helps slightly with table re-renders. Not enabling it costs nothing for this scale.

**Recommendation:** Skip for Phase 1. Enable when you have a working app and can A/B compare build times and runtime behavior. The compiler is opt-in and additive — it's easier to turn on later than to debug interactions now.

#### 4. Cron Builder Component Longevity

**What I know:** `@vpfaiz/cron-builder-ui` v1.0.1 exists, works, uses Radix + Tailwind, supports dark mode. Zero npm dependents, single author with no other packages.

**What I don't know:** Whether the author will maintain it. Whether it works with Tailwind v4's OKLCH color system (it uses HSL custom properties internally).

**Risk:** Low. The component is ~500 lines of code. If it breaks or gets abandoned, copying it into `packages/ui/` and adapting it takes a few hours. The API surface (`onChange`, `defaultValue`) is trivial to replicate.

**Next step:** Install it, test with Tailwind v4 in the actual project. If the theming conflicts, either override the CSS variables or build a simpler version using ShadCN Select + Tabs + `cronstrue`.

#### 5. Trigger.dev Connection Lifecycle in Server Actions

**What I know:** `tasks.trigger()` works from Server Actions — this is officially documented and demoed. The SDK uses `TRIGGER_SECRET_KEY` from `process.env`.

**What I don't know:** Whether there are cold-start penalties. Server Actions in Node.js runtime run in a long-lived process, so the SDK's HTTP client should stay warm. But in serverless or edge deployments, each invocation might re-initialize.

**Risk:** Low for Redgest. Docker deployment means a persistent Node.js process. No cold start. If deploying to serverless later, test the trigger latency — it may add 100-200ms on cold starts.

#### 6. `revalidateTag` vs. `revalidatePath` for CQRS

**What I know:** Next.js 16 changed `revalidateTag` to require a second argument (cache life profile). `revalidatePath` still works as before.

**What I don't know:** Whether tag-based revalidation provides meaningful benefits over path-based for Redgest's use case. Tags allow more granular cache control (e.g., revalidate just the subreddit list without revalidating the settings page), but Redgest doesn't use `"use cache"` at all — everything is dynamic.

**Risk:** None. Since Redgest doesn't opt into caching, `revalidatePath` is simpler and sufficient. If you later add caching, switch to tags at that point.

**Recommendation:** Use `revalidatePath('/subreddits')` for now. It's one line, it works, it forces the page to re-render with fresh data.

#### 7. ShadCN DataTable Performance at Scale

**What I know:** ShadCN DataTable wraps TanStack Table v8, which is headless and performant. For 20-50 subreddits, there's zero concern.

**What I don't know:** Run History could accumulate thousands of rows over months. The "last 50 + load more" pattern mitigates this, but if a user loads many pages, the in-memory dataset grows.

**Risk:** Very low. TanStack Table virtualizes rendering. Even with 500 loaded rows, performance should be fine. If it's not (unlikely), add `@tanstack/react-virtual` for row virtualization — TanStack Table supports it natively.

#### 8. `@tailwindcss/typography` + Tailwind v4

**What I know:** `react-markdown` + `@tailwindcss/typography` is the standard approach for rendering markdown with Tailwind styling. The `prose prose-invert` classes provide dark-mode-compatible typography.

**What I don't know:** Whether `@tailwindcss/typography` has been updated for Tailwind v4's new plugin system. Tailwind v4 replaced the JS config with CSS-first configuration, and plugins work differently.

**Next step:** Check if `@tailwindcss/typography` is v4-compatible before importing it. If not, apply manual prose styles in CSS — the markdown content in Redgest is simple (headers, paragraphs, lists, code blocks) and doesn't need the full typography plugin.

---

## Consistency Check

No conflicts identified with preserved sections. All architectural decisions (Server Components for reads, Server Actions for writes, TanStack Query for polling, ShadCN Sidebar for navigation, DAL pattern for data access) align with the original research's recommendations. The code examples implement the patterns the original described in prose.

One minor clarification: the original research recommended "don't poll Server Actions" and this revision uses a Route Handler (`/api/runs/route.ts`) for the Run History polling — consistent with that guidance. The Manual Trigger uses a Server Action for the one-shot trigger call — also consistent, since that's a mutation, not a polling operation.
