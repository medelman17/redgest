# WS10 Scaffold Design — Next.js 16 + ShadCN + Sidebar Layout

**Date**: 2026-03-10
**Sprint**: 9
**Task**: Next.js 16 app scaffold with ShadCN (1pt)
**Status**: Approved

## Overview

Set up the `apps/web/` foundation for Redgest's config UI dashboard. The scaffold delivers all infrastructure, dependencies, theming, and data access patterns so subsequent page tasks (Subreddit Manager, Settings, History, Trigger) start coding immediately with zero setup overhead.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| CQRS connection | Thin DAL layer (`lib/dal.ts`) | Typed convenience functions, keeps Server Actions thin, module-scoped singleton |
| ShadCN location | `apps/web/components/ui/` | YAGNI — no second consumer. Extract to `packages/ui/` later if needed |
| Font loading | `next/font/google` | Zero CLS, self-hosted at build time, CSS variable integration |
| Routing | Flat: `/subreddits`, `/settings`, `/history`, `/trigger` | Clean, no unnecessary nesting. `/` redirects to `/subreddits` |
| Event wiring | Full — DAL sets up EventBus + Trigger.dev dispatch | Reuses existing `DigestRequested` → Trigger.dev flow without divergence |
| Job polling | TanStack Query (`refetchInterval`) | Automatic cache management, retry, window-focus refetch |
| Approach | Full Foundation | Pre-install all ShadCN components + DAL wrappers. Page tasks focus on UI/logic only |
| Theme | Dark-only on `:root`, light class override available | Single-user developer tool. `next-themes` toggle present for future use |

## Visual Direction: "Terminal-Luxe"

Dark-first developer aesthetic — precise, information-dense, elevated.

### Typography

- **Headings/data**: JetBrains Mono (monospace) — `next/font/google`, `--font-mono` CSS variable
- **Body**: IBM Plex Sans (sans-serif) — `next/font/google`, `--font-sans` CSS variable
- Loaded via `next/font/google` for zero layout shift

### Color Palette

| Role | Hex | ShadCN Variable |
|---|---|---|
| Background | `#0F172A` | `--background` |
| Surface/Card | `#1E293B` | `--card`, `--muted` |
| Border | `#334155` | `--border` |
| Accent/Primary | `#22C55E` | `--primary`, `--ring` |
| Text | `#F8FAFC` | `--foreground` |
| Muted text | `#94A3B8` | `--muted-foreground` |
| Subtle text | `#64748B` | secondary labels, hints |

### Icons

Lucide React (ShadCN default). Nav icons: `Rss` (Subreddits), `Settings` (Settings), `Clock` (History), `Play` (Trigger).

## File Structure

```
apps/web/
├── app/
│   ├── layout.tsx              # Root: fonts, providers wrapper, sidebar shell
│   ├── page.tsx                # Redirect to /subreddits
│   ├── subreddits/
│   │   └── page.tsx            # Placeholder
│   ├── settings/
│   │   └── page.tsx            # Placeholder
│   ├── history/
│   │   └── page.tsx            # Placeholder
│   └── trigger/
│       └── page.tsx            # Placeholder
├── components/
│   ├── ui/                     # ShadCN primitives
│   ├── app-sidebar.tsx         # Sidebar config (nav items, logo, footer)
│   └── providers.tsx           # Client: ThemeProvider + QueryClientProvider
├── lib/
│   ├── dal.ts                  # DAL: bootstrap + typed execute/query wrappers
│   ├── actions.ts              # Server Actions calling DAL
│   └── utils.ts                # cn() utility
├── globals.css                 # Tailwind v4 @theme, ShadCN CSS vars, fonts
├── next.config.ts
├── components.json             # ShadCN CLI config
├── postcss.config.js
└── tsconfig.json
```

## Dependencies

### Production

| Package | Purpose |
|---|---|
| `next` ^16.1 | Framework |
| `react`, `react-dom` ^19 | Runtime |
| `@tanstack/react-query` | Polling / client cache |
| `next-themes` | Dark mode |
| `tailwindcss` ^4 | Styling |
| `@tailwindcss/postcss` | Tailwind v4 PostCSS plugin |
| `lucide-react` | Icons |
| `class-variance-authority` | ShadCN component variants |
| `clsx`, `tailwind-merge` | ShadCN `cn()` utility |
| `@redgest/core` | CQRS dispatchers + handlers |
| `@redgest/db` | Prisma client |
| `@redgest/config` | Environment config |
| `@redgest/reddit` | RedditContentSource (event wiring) |
| `zod` | Server Action input validation |

### Dev

| Package | Purpose |
|---|---|
| `@types/react`, `@types/react-dom` | Type definitions |
| `typescript` | Inherited from monorepo |

### ShadCN Components (16)

`button`, `input`, `table`, `form`, `dialog`, `select`, `card`, `badge`, `tabs`, `sheet`, `sidebar`, `separator`, `dropdown-menu`, `label`, `textarea`, `sonner` (toast)

## Configuration

### `next.config.ts`

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@redgest/core', '@redgest/db', '@redgest/config', '@redgest/reddit'],
  reactStrictMode: true,
};

export default nextConfig;
```

### `tsconfig.json`

Extends `../../tsconfig.base.json`. Adds:
- `"jsx": "preserve"`
- `"lib": ["ES2022", "DOM", "DOM.Iterable"]`
- Path alias: `"@/*": ["./*"]`
- Removes `outDir`/`rootDir` (Next.js manages output)

### `package.json` scripts

```json
{
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "lint": "eslint app/ components/ lib/",
  "typecheck": "tsc --noEmit"
}
```

### `globals.css`

Tailwind v4 CSS-first configuration:
- `@import "tailwindcss"` + `@import "tw-animate-css"`
- `@custom-variant dark (&:is(.dark *))` for ShadCN dark mode
- `@theme inline` for `--font-sans`, `--font-mono`
- `:root` with ShadCN CSS variables mapped to slate/green palette
- `.dark` class present but `:root` IS the dark theme (dark-first)

## DAL Design

### Bootstrap (module-scoped singleton)

```typescript
// lib/dal.ts
import { loadConfig } from '@redgest/config';
import { prisma } from '@redgest/db';
import { DomainEventBus, createExecute, createQuery, commandHandlers, queryHandlers, runDigestPipeline } from '@redgest/core';
import { RedditClient, TokenBucket, RedditContentSource } from '@redgest/reddit';

// globalThis guard prevents duplicate EventBus/RedditClient on HMR (same pattern as @redgest/db client.ts)
const globalForDal = globalThis as unknown as { __redgestDal?: { execute: any; query: any; ctx: any } };

async function getBootstrap() {
  if (!globalForDal.__redgestDal) {
    const config = loadConfig();
    const eventBus = new DomainEventBus();
    const ctx = { db: prisma, eventBus, config };
    const execute = createExecute(commandHandlers);
    const query = createQuery(queryHandlers);

    // Event wiring: DigestRequested → Trigger.dev or in-process
    const redditClient = new RedditClient({ ... });
    const rateLimiter = new TokenBucket({ capacity: 60, refillRate: 1 });
    const contentSource = new RedditContentSource(redditClient, rateLimiter);
    const pipelineDeps = { db: prisma, eventBus, contentSource, config };

    eventBus.on('DigestRequested', async (event) => {
      // Same dispatch logic as MCP bootstrap
    });

    globalForDal.__redgestDal = { execute, query, ctx };
  }
  return globalForDal.__redgestDal;
}
```

### Typed wrappers

```typescript
// Query wrappers
export async function listSubreddits() { ... }
export async function getConfig() { ... }
export async function getDigest(digestId: string) { ... }
export async function listRuns() { ... }
export async function getRunStatus(jobId: string) { ... }
export async function listDigests() { ... }

// Command wrappers
export async function addSubreddit(params: AddSubredditParams) { ... }
export async function updateSubreddit(params: UpdateSubredditParams) { ... }
export async function removeSubreddit(subredditId: string) { ... }
export async function updateConfig(params: UpdateConfigParams) { ... }
export async function generateDigest(params: GenerateDigestParams) { ... }
```

## Layout Architecture

### Root Layout (`app/layout.tsx`)

Server Component. Applies font CSS variables to `<body>`, wraps children in `<Providers>` (client) and `<SidebarProvider>` + `<AppSidebar>`.

### Providers (`components/providers.tsx`)

Single `"use client"` boundary. Wraps:
1. `<ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>`
2. `<QueryClientProvider>`

### Sidebar (`components/app-sidebar.tsx`)

ShadCN `Sidebar` component with:
- Header: Green "R" logo mark + "Redgest" wordmark (JetBrains Mono)
- 4 nav items with Lucide icons, active state highlighted with green accent
- Footer: keyboard shortcut hint + theme toggle
- Collapsible to icon-only mode (Cmd+B)
- Mobile: sheet overlay

### Placeholder Pages

Each route renders a Server Component with:
- Page title (JetBrains Mono, `text-2xl font-semibold`)
- Subtitle description (muted text)
- Empty content area ready for the page task to fill

## What Page Tasks Inherit

| Page | DAL Functions | ShadCN Components |
|---|---|---|
| Subreddit Manager (2pt) | `listSubreddits`, `addSubreddit`, `updateSubreddit`, `removeSubreddit` | Table, Dialog, Form, Input, Button, Badge, Textarea |
| Global Settings (1.5pt) | `getConfig`, `updateConfig` | Form, Input, Select, Card, Label, Tabs |
| Run History (2pt) | `listRuns`, `getRunStatus`, `getDigest`, `listDigests` | Table, Badge, Card, Dialog, Tabs |
| Manual Trigger (1pt) | `generateDigest`, `getRunStatus`, `listSubreddits` | Button, Card, Badge + TanStack Query polling |

## Gotchas

- `next lint` removed in Next.js 16 — use ESLint directly
- `transpilePackages` still recommended for Turbopack monorepo (Next.js 16.1)
- Tailwind v4: no `tailwind.config.js` for theme — use `@theme inline` in CSS
- ShadCN Tailwind v4: `tw-animate-css` replaces `tailwindcss-animate`
- ShadCN Tailwind v4: HSL colors converted to OKLCH in component source
- `next-themes` needs `attribute="class"` for ShadCN dark mode
- Font CSS variables must be declared on `<body>` for Tailwind v4 `font-sans`/`font-mono` to work
- **DAL requires `globalThis` guard for HMR** — Without it, Turbopack HMR creates duplicate `DomainEventBus` instances and event handlers. Same pattern as `@redgest/db` client singleton.
- **All env vars from `configSchema` must be present** — `loadConfig()` validates `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, etc. as required. The web app needs these because the DAL wires the full pipeline (event bus → Trigger.dev dispatch → in-process fallback). Use `.env` from monorepo root. If running UI-only dev without secrets, the app will fail on first DAL call — this is acceptable for a single-user tool.
- **Trigger.dev SDK import path is `@trigger.dev/sdk/v3`** — Despite the architecture spike suggesting v4 changed to `@trigger.dev/sdk`, the installed version and all existing code (MCP bootstrap, worker tasks) use `@trigger.dev/sdk/v3`. Follow existing convention.
- Server Actions are public endpoints — always validate with Zod even for single-user
