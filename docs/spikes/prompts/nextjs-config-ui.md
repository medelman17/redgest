# Research Task: Next.js Config UI Architecture for "Redgest"

## Context

I'm building **Redgest**, a personal Reddit digest engine. It monitors subreddits, uses LLMs to select and summarize interesting posts based on user-defined interest prompts, and delivers digests via MCP (Model Context Protocol), email, and Slack. The system is structured as a TurboRepo monorepo with a CQRS architecture.

The web UI is a **minimal configuration panel** — it is NOT the primary interface. The primary interface is the MCP server (agents talk to it). The web UI exists for initial setup, visual configuration management, run monitoring, and manual digest triggering. Think of it as an admin panel, not a product.

Despite being minimal, it should be **well-built and pleasant to use.** ShadCN components, dark mode default, polished but not over-designed. The kind of tool a developer builds for themselves and actually enjoys using.

This spike is about **designing the Next.js portion of the system** — architecture, data access patterns, component strategy, real-time updates, deployment, and how it fits into the monorepo.

## System Architecture (What the Web UI Sits Inside)

### Monorepo Structure

```
redgest/
├── packages/
│   ├── core/           # CQRS commands/queries/events, domain logic, pipeline orchestration
│   ├── db/             # Prisma v7 schema, generated client, migrations, repository interfaces
│   ├── mcp-server/     # Standalone MCP server (NOT Next.js)
│   ├── reddit/         # Reddit API client
│   ├── llm/            # LLM provider abstraction
│   ├── email/          # React Email templates + Resend
│   ├── slack/          # Slack webhook
│   └── config/         # Shared TypeScript, ESLint, Prettier configs
├── apps/
│   ├── web/            # ← THIS IS THE FOCUS: Next.js config UI
│   └── worker/         # Trigger.dev task definitions
├── docker-compose.yml
└── turbo.json
```

### CQRS Pattern

- **Write path:** Commands (`AddSubreddit`, `UpdateConfig`, `GenerateDigest`, etc.) are processed by handlers in `@redgest/core` that validate input, persist via Prisma, and emit domain events.
- **Read path:** Queries read from Postgres views (`subreddit_view`, `run_view`, `digest_view`, `post_view`). Views are denormalized for fast reads.
- **Event bus:** In-process typed EventEmitter in Phase 1. Events like `DigestRequested`, `DigestCompleted` trigger side effects.

The web UI should interact with the system **through `@redgest/core`'s command/query interfaces** — not by hitting the database directly. This keeps the CQRS boundaries clean: the web app dispatches commands and reads from query functions, same as the MCP server does.

### Key Technology Constraints

- **Next.js 16 + React 19** — Server components by default, server actions for mutations, App Router.
- **TypeScript strict, ESM throughout.**
- **Prisma v7** — Rust-free, ESM-native. Generated client lives in `packages/db/`. The web app imports `@redgest/db` indirectly through `@redgest/core`.
- **ShadCN/ui** — Component library base. Customized to fit, not used as-is where it doesn't serve the purpose.
- **Dark mode default** — The primary theme. Light mode support is nice-to-have, not required.
- **No auth** — Single-user personal tool. No login, no sessions, no user management. The web UI is accessed directly. (Security is via network-level controls — it runs locally or behind a VPN/firewall.)
- **Vendor-agnostic deployment** — Must work on any Docker host, VPS, Fly.io, Railway, etc. Cannot depend on Vercel-specific features (no `waitUntil`, no Vercel KV, no Vercel Analytics). Should ALSO work on Vercel if that's where the user wants to deploy, but Vercel is not special-cased.
- **Trigger.dev v4** — Background job execution. The web UI needs to trigger digest runs and display run status. In Phase 1, Trigger.dev Cloud. In Phase 2, self-hosted.

### What the Web UI Does (And Doesn't Do)

**The web UI has four screens:**

1. **Subreddit Manager** — CRUD for monitored subreddits. Table/list of subs with inline editing. Per-sub fields: name, insight prompt (textarea), max posts (number), include NSFW (toggle), active/inactive (toggle). Add new sub form. Delete with confirmation.

2. **Global Settings** — Form for global configuration. Fields: global insight prompt (large textarea), default lookback period (select or input), LLM provider (select: anthropic/openai), LLM model (text input), default delivery channels (multi-select: none/email/slack), schedule (cron expression input or preset selector). Save button.

3. **Run History** — Table of past pipeline runs. Columns: timestamp, status (queued/running/completed/failed/partial), subreddits included, duration, post count, delivery channels. Click a row to see the digest output. Status should update in near-real-time for running jobs (polling is fine — no need for WebSockets).

4. **Manual Trigger** — Button (or small form) to trigger an on-demand digest run with optional parameter overrides (subreddits, lookback, delivery). Shows the resulting jobId and links to the run in Run History.

**The web UI does NOT:**
- Display full digest content in a rich reader view (that's what MCP/Claude is for)
- Manage email or Slack configuration (those are env vars)
- Provide analytics, charts, or dashboards
- Handle auth, user management, or billing
- Replace the MCP server for any functionality

## Research Questions

### 1. Next.js 16 + React 19: What's New and Relevant

**Research the current state of Next.js 16 and React 19 as of early 2026.**

- What's new in Next.js 16 vs. 15? Any breaking changes or new patterns we should adopt?
- React 19 features: `use()` hook, Actions, `useOptimistic`, `useFormStatus`, `useActionState` — which are relevant for a config panel UI?
- Server Actions in Next.js 16: current best practices for form mutations. Are Server Actions the recommended pattern for CRUD operations, or are API routes still preferred for certain cases?
- Server Components vs. Client Components: for a config panel that's mostly forms and tables, what's the right boundary? Server components for data fetching, client components for interactive forms?
- Is the `"use server"` / `"use client"` boundary well-defined in Next.js 16, or are there still gotchas?
- Partial Prerendering (PPR) — is it stable in Next.js 16? Relevant for a config panel?
- What's the current recommended data fetching pattern? `fetch()` in server components? Direct database access in server components? Server actions for mutations?

### 2. Data Access Pattern: How the Web App Talks to @redgest/core

This is the most important architectural question for the web app.

**Option A: Direct import of `@redgest/core` in server components and server actions.**
The Next.js app imports `@redgest/core` functions directly. Server components call query functions. Server actions call command handlers. No HTTP layer between the web app and the core logic. The Prisma client is shared in-process.

```
Server Component → @redgest/core query → @redgest/db Prisma → Postgres
Server Action    → @redgest/core command → @redgest/db Prisma → Postgres + emit events
```

**Option B: Internal API routes.**
The Next.js app exposes API routes that call `@redgest/core`. Server components and client components fetch from these routes. This adds an HTTP hop but creates a clear API boundary.

```
Server Component → fetch(/api/subreddits) → API Route → @redgest/core → Prisma
```

**Option C: Hybrid.**
Server components import `@redgest/core` directly (for reads). Client components use server actions (for writes) that import `@redgest/core`. No API routes needed.

**Research and recommend:**
- Which pattern is the current Next.js 16 best practice?
- How does direct `@redgest/core` import work in a TurboRepo monorepo? Are there bundling issues with importing packages that depend on Prisma v7?
- Can server components in Next.js 16 directly call Prisma without issues? (Prisma v7 is ESM-native — does this cause problems with Next.js's bundler?)
- If using server actions for mutations, how do they interact with CQRS command handlers? Does the server action just call `commandBus.execute(new AddSubreddit(...))`?
- How do you handle optimistic updates in the UI when the mutation goes through a CQRS command handler that might emit events and trigger side effects?
- What about Trigger.dev task triggering from the web UI? The "Manual Trigger" button needs to call `tasks.trigger("digest.generate", payload)`. Does this go through a server action? An API route?

### 3. ShadCN/ui in a TurboRepo Monorepo

**Research the current best practices for using ShadCN/ui in a TurboRepo monorepo.**

- ShadCN components are typically installed into the project (not imported from a package). In a monorepo, should they live in `apps/web/` or in a shared `packages/ui/` package?
- If they live in `apps/web/`, that's simpler but means no sharing if we later add another app. If in `packages/ui/`, how does the TurboRepo + Next.js build pipeline handle this?
- What's the current ShadCN installation method? CLI (`npx shadcn@latest add`)? Does it work cleanly in a monorepo?
- Tailwind CSS v4 — is ShadCN compatible? What version of Tailwind should we use? Is there a migration path if Tailwind v4 is the current stable?
- How to set up dark mode as the default? ShadCN's `ThemeProvider` with `defaultTheme="dark"`? Or CSS-level `prefers-color-scheme` with a dark default?
- Custom theme: do we need to customize ShadCN's color tokens, or is the default dark theme good enough for an admin panel?

### 4. Screen-by-Screen Component Architecture

**For each of the four screens, propose the component tree, data flow, and interaction patterns.**

#### Subreddit Manager
- Table component: ShadCN `DataTable` or simpler `Table`? Inline editing or modal/sheet for edit?
- Add subreddit: inline form at the top? Modal? Separate page?
- Delete confirmation: ShadCN `AlertDialog`?
- The insight prompt is a long text field — how to display it in a table row? Truncated with expand, or always in a detail view?
- Optimistic updates: when the user adds a sub, should it appear immediately (optimistic) or wait for the server action to complete?
- How does `isActive` toggle work? Immediate server action on toggle, or save button?

#### Global Settings
- Single form with multiple fields. ShadCN `Form` with React Hook Form? Or simpler uncontrolled form with server actions?
- The schedule field (cron expression) — should we offer a cron builder UI or just a text input? Is there a good cron builder component compatible with ShadCN?
- LLM model field — free text input, or a select with known models? How to handle the fact that available models change frequently?
- Unsaved changes warning?
- Form validation: client-side with Zod? Server-side in the command handler? Both?

#### Run History
- Table with pagination (or infinite scroll? or just last N runs?). ShadCN `DataTable` with sorting and filtering.
- Status column: color-coded badges. How to show `running` status with a subtle animation or spinner?
- **Near-real-time status updates for running jobs.** Options: polling (every 5 seconds), Server-Sent Events, or WebSocket. Polling is simplest and fine for a personal tool. How to implement polling in Next.js 16 with React 19? `useEffect` + interval? React Query / TanStack Query? SWR? What's the current best practice?
- Click-to-expand row showing: digest summary, error details (for failed runs), delivery status.
- Should the digest content be viewable in the UI? The PRD says the UI is not for rich content viewing — but a simple markdown renderer for the digest output would be useful for debugging. Research: is there a lightweight markdown renderer compatible with ShadCN/Next.js?

#### Manual Trigger
- Could be a standalone page, a section on the dashboard, or a floating action button available on every page.
- Form fields: subreddit multi-select (from configured subs), lookback override, delivery channel override.
- Submit triggers a server action that calls `commandBus.execute(new GenerateDigest(...))`.
- Response shows the jobId and navigates to (or highlights) the run in Run History.
- Should the button be disabled if a run is already in progress?

### 5. Layout & Navigation

- How many pages/routes? Options:
  - **Single page with tabs:** Everything on one page, ShadCN `Tabs` to switch between Subreddits / Settings / Runs / Trigger. Minimal routing.
  - **Multi-page with sidebar:** ShadCN sidebar layout with 4 nav items. Each screen is a separate route. More Next.js-native.
  - **Dashboard with cards:** Landing page with at-a-glance cards (sub count, last run status, next scheduled run), drill into each section.
- Research: For a 4-screen admin panel, what's the pattern that feels best? ShadCN has layout primitives — which ones?
- Should there be a header/navbar? Just a logo + dark mode toggle?
- Mobile responsiveness — necessary for a personal admin panel? Probably not a priority, but it shouldn't break.

### 6. Deployment Without Vercel Lock-In

**The web app must deploy to any Docker host, not just Vercel.**

- Next.js standalone output mode (`output: "standalone"` in `next.config.js`): current state in Next.js 16? Does it produce a self-contained Node.js server?
- Docker setup: what does a production Dockerfile look like for a Next.js 16 app in a TurboRepo monorepo? Multi-stage build?
- Does `standalone` mode support all features we need (server components, server actions, static assets)?
- Environment variables: how to handle runtime env vars (database URL, Trigger.dev API key) in a Docker deployment vs. build-time env vars?
- Are there Next.js features that silently break outside Vercel? (Image optimization, ISR, edge runtime, etc.) Which should we avoid?
- Research: What's the current best practice for deploying Next.js to non-Vercel targets in early 2026? Has OpenNext or any other project matured as a universal adapter?

### 7. Real-Time Job Status Updates

The Run History screen needs near-real-time status for running jobs. The Manual Trigger screen needs to show when a triggered job completes.

**Research options:**

- **Polling with TanStack Query / SWR:** Fetch job status every N seconds. Automatic refetching, caching, and background updates. Simplest to implement. How does this work with server components?
- **Polling with server actions:** A server action that returns current job status, called on an interval from a client component.
- **Server-Sent Events (SSE):** The Next.js app streams status updates. More complex but lower latency. Does Next.js 16 support SSE from API routes cleanly?
- **Postgres LISTEN/NOTIFY → SSE:** The app listens for Postgres notifications on job status changes and pushes to the client via SSE. Elegant but more infrastructure.

For a personal tool with one user, **polling every 5 seconds is almost certainly the right answer.** But research the implementation details: which data fetching library, how it interacts with server components, and how to avoid unnecessary re-renders.

### 8. Form Handling & Validation

- **React Hook Form + Zod** is the ShadCN-native pattern. Is this still the best practice with React 19 + Next.js 16, or have server actions + `useActionState` replaced it?
- If using server actions: how to return validation errors from a server action to the form? What's the React 19 pattern?
- Zod schemas: should these be defined in `@redgest/core` (shared between web, MCP server, and any other consumer) or in `apps/web`? The command schemas in `@redgest/core` already define valid inputs — should the web forms reuse those?
- File uploads: not needed. No images, no file inputs. Just text, numbers, selects, and toggles.

### 9. TurboRepo Build Pipeline Integration

- How does `apps/web` declare dependencies on `@redgest/core` and `@redgest/db` in TurboRepo?
- Does `turbo.json` need special configuration for Next.js builds? (e.g., `dependsOn` for Prisma generation before the web app builds)
- How do you ensure Prisma's generated client is available at build time for the web app?
- Hot module reload in dev: does `pnpm dev --filter @redgest/web` correctly pick up changes in `packages/core` and `packages/db`?
- What goes in `next.config.js` for the monorepo setup? `transpilePackages`? `experimental.externalDir`?

### 10. Testing Strategy

- For a minimal config panel, what's the right testing investment?
- Unit tests for server actions (they're just functions that call command handlers)?
- Integration tests that test the full flow: render page → fill form → submit → verify database state?
- E2E tests with Playwright? Overkill for a personal tool?
- Storybook for ShadCN components? Overkill?
- Research: What's the current Next.js 16 testing story? Is there built-in support for testing server components and server actions?

## Deliverables

### A. Architecture Recommendation
Clear recommendation on the data access pattern (direct import vs. API routes vs. hybrid), with justification. Show the data flow for a read (loading the subreddit list) and a write (adding a new subreddit) with code examples.

### B. Component Architecture
For each of the four screens, provide:
- Component tree (what components, which are server vs. client)
- Data fetching pattern (server component fetch, TanStack Query, etc.)
- Mutation pattern (server action, form handling)
- Key ShadCN components used
- Interaction patterns (optimistic updates, loading states, error handling)

### C. Layout & Navigation Design
Recommendation on single-page tabs vs. multi-page sidebar vs. dashboard, with rationale. Include a rough wireframe description (not visual, just structural).

### D. Project Setup Guide
Step-by-step for setting up `apps/web` in the TurboRepo:
- `package.json` dependencies and workspace references
- `next.config.js` for monorepo + standalone output
- ShadCN installation and dark mode configuration
- Tailwind CSS setup for monorepo (shared config or app-specific?)
- `tsconfig.json` path aliases for importing from `@redgest/*`
- TurboRepo pipeline configuration in `turbo.json`

### E. Deployment Configuration
- Production Dockerfile (multi-stage, TurboRepo-aware)
- Docker Compose service definition for the web app
- Environment variable strategy (runtime vs. build-time)
- Any Next.js config needed for non-Vercel deployment

### F. Real-Time Updates Pattern
Recommended approach for job status polling with code example. Show the client component that polls, the data source (server action or API route), and how it integrates with the Run History table.

### G. Shared Validation Strategy
Recommendation on where Zod schemas live (core vs. web) and how form validation integrates with CQRS command validation. Show an example with the `AddSubreddit` command.

### H. Open Questions
Anything unresolved. Flag clearly.

## Important Notes

- **Next.js 16 may have changed significantly from 15.** Do not assume Next.js 15 patterns still apply. Search for Next.js 16 release notes, migration guides, and current documentation. If Next.js 16 is not yet released as of your knowledge, note that clearly and provide the best recommendation based on the latest available version.
- **React 19 has been stable for a while by early 2026.** Server Actions, `useActionState`, `useOptimistic`, and the `use()` hook should be well-documented. Search for current best practices.
- **ShadCN/ui evolves independently of Next.js.** Check the current ShadCN documentation for installation in monorepos, Tailwind v4 compatibility, and dark mode setup.
- **This is a personal tool.** Don't over-engineer. No auth, no i18n, no analytics, no A/B testing, no feature flags. But DO make it well-structured — this is a reference architecture that might become OSS.
- **Prisma v7 in server components** is a specific area where issues may exist. The ESM output, the generated client location, and the bundler interactions are all potential trouble spots. Research thoroughly.
- **Vendor-agnostic deployment is a hard requirement.** If a Next.js feature only works on Vercel, we don't use it. If a pattern requires Vercel-specific behavior, call it out and provide an alternative.
- I care more about **getting this right** than getting a quick answer. This UI is simple but it's the visual face of the project. The architecture should be clean enough that adding a fifth screen in the future is trivial.
