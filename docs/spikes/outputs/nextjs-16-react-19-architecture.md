# Redgest config UI architecture spike

**Next.js 16.1 is the current stable LTS (released December 2025), shipping React 19.2 with Turbopack as the default bundler.** This stack is production-ready for Redgest's minimal admin panel, but several breaking changes from Next.js 15 and Prisma 7 demand careful attention. The recommended architecture uses Server Components for data display, Server Actions with `useActionState` for CRUD mutations, a shared `packages/ui/` for ShadCN components, TanStack Query for client-side polling, and `output: "standalone"` for vendor-agnostic Docker deployment. Below is a thorough analysis of each research area with version-specific findings, gotchas, and concrete code patterns.

---

## 1. Next.js 16 and React 19 are stable with significant changes

**Next.js 16.0** shipped October 21, 2025; **Next.js 16.1** followed December 18, 2025. The latest patch is **16.1.6** (February 2026). Next.js 15 has moved to Maintenance LTS. The framework now requires **Node.js 20.9+** and **TypeScript 5.1+**.

### Breaking changes from Next.js 15

The most impactful changes for Redgest are:

- **Turbopack is the default bundler** — no `--turbopack` flag needed; use `--webpack` to opt out. Custom webpack configs cause build failure unless you explicitly choose webpack.
- **`middleware.ts` renamed to `proxy.ts`** — the exported function becomes `proxy()` and runs on full Node.js runtime (not Edge). The old file still works but is deprecated.
- **`experimental.ppr` removed** — replaced by `cacheComponents: true` and the `"use cache"` directive.
- **`revalidateTag()` requires a second argument** — the cache life profile: `revalidateTag('subreddits', 'max')`.
- **Route `params` are now a Promise** — must `await params` in route handlers and pages.
- **AMP support removed entirely**, `next lint` removed (use ESLint directly), `serverRuntimeConfig`/`publicRuntimeConfig` removed (use `.env` files).
- **React Compiler support is stable** — opt in with `reactCompiler: true` in config.
- **Fetch responses are NOT cached by default** — a major reversal from Next.js 14's aggressive caching. All dynamic code runs at request time by default.

### React 19.2 features relevant to config panels

Every React 19 hook is **stable and production-ready** in Next.js 16. The key hooks for Redgest's admin panel:

**`useActionState`** (from `react`, not `react-dom`) manages form action state with automatic pending tracking. This is the primary hook for connecting forms to Server Actions. Note that the server action signature changes to `(prevState, formData)` when used with this hook. The older `useFormState` from `react-dom` is deprecated — any tutorial referencing it is outdated.

**`useFormStatus`** (from `react-dom`) returns `{ pending }` for the nearest parent `<form>`. Must be used in a child component of a form, making it ideal for a reusable `<SubmitButton>` component.

**`useOptimistic`** provides instant UI feedback while async actions complete — useful for toggle switches and status updates in the Subreddit Manager.

**`use()`** can read promises inside conditionals (unlike other hooks) and replaces `useContext`. For Redgest, prefer fetching in Server Components and passing data as props; reserve `use()` for unwrapping promises passed from server to client components.

### Server Actions are THE recommended pattern for CRUD

For Redgest's internal CRUD operations, **Server Actions are the clear choice**. They are type-safe within Next.js, support progressive enhancement, and are faster than Route Handlers for internal mutations. Use Route Handlers only for external API consumers (webhooks, third-party integrations) or when you need precise HTTP control.

**Critical security note**: Server Actions are public HTTP endpoints. Even though Redgest is single-user with no auth, always validate inputs with Zod in every action — never trust the `'use server'` directive as a security boundary.

### Server vs. Client component boundaries

The recommended split for a config panel: **pages and layouts are Server Components** (fetch data, render shell); **forms, interactive tables, modals, and anything using `useState`/`useEffect` are Client Components**. Push the `'use client'` boundary as deep as possible — mark individual interactive widgets, not entire pages. Props passed from server to client must be serializable (no functions, no raw `Date` objects, no Prisma `Decimal` types).

### PPR and caching relevance

PPR has been subsumed into "Cache Components" (`cacheComponents: true` + `"use cache"` directive). **For Redgest's admin panel, skip this entirely.** Admin panels are inherently dynamic; the default dynamic-at-request-time behavior is exactly what you want. The `"use cache"` directive is useful only for expensive read queries you want to cache explicitly.

---

## 2. Data access works best with direct imports through a DAL

### Prisma 7 architecture overhaul

**Prisma 7.4.2** is current. This is a ground-up rewrite with breaking changes that affect every aspect of setup:

- **Rust-free TypeScript client** — **3.4x faster queries**, **90% smaller bundle** (~1.6MB vs ~14MB), works in edge runtimes.
- **Driver adapters are mandatory** — Prisma no longer bundles database drivers. For PostgreSQL: `@prisma/adapter-pg`.
- **Generated output path is required** — `output = "../generated/prisma"` in the generator block.
- **Provider name changed** — `provider = "prisma-client"` (not `"prisma-client-js"`).
- **No auto `.env` loading** — use `dotenv` or `prisma.config.ts` with `env()`.
- **New `prisma.config.ts`** — separates project configuration from schema.
- **Client instantiation changed** — must pass `adapter` to `new PrismaClient({ adapter })`.

### Monorepo data access pattern

The **Data Access Layer (DAL) pattern** maps perfectly to Redgest's CQRS architecture. Server Components directly import query handlers from `@redgest/core`, which call `@redgest/db`. Server Actions import command handlers. No API route layer is needed for internal data access.

```
packages/db/          → @redgest/db (Prisma schema, client singleton, migrations)
packages/core/        → @redgest/core (query/command handlers importing @redgest/db)
apps/web/             → Server Components call queries; Server Actions call commands
```

The `@redgest/db` package exports a singleton Prisma client using the global cache pattern to prevent connection exhaustion during development HMR. It re-exports generated types so consuming packages get full type safety.

**Serialization gotcha**: Prisma `Decimal`, `BigInt`, and `Date` fields are not JSON-serializable. Server Components and Server Actions can only pass plain objects to Client Components. Handle this in the DAL by using `select` to return only needed fields and converting dates to ISO strings.

### Trigger.dev v4 integration

**Trigger.dev 4.4.2** is current (GA). Triggering from a Server Action uses `tasks.trigger<typeof myTask>("task-id", payload)`. The import path changed in v4 to `@trigger.dev/sdk` (not `@trigger.dev/sdk/v3`). Trigger.dev has an official Turborepo + Prisma monorepo example. For Redgest, tasks can live in a `packages/tasks/` workspace or directly in the Next.js app under `trigger/`.

---

## 3. ShadCN/ui has first-class monorepo support

### Setup and component location

ShadCN/ui now has **dedicated monorepo documentation** and Turborepo has an official integration guide. Initialize with `pnpm dlx shadcn@latest init --monorepo` to scaffold the recommended structure. **Shared primitive components go in `packages/ui/`; app-specific composed components stay in `apps/web/components/`**. The CLI is smart enough to route components to the correct location automatically — running `npx shadcn@latest add button` from `apps/web/` installs it into `packages/ui/src/components/`.

Both workspaces need their own `components.json` with matching `style`, `iconLibrary`, and `baseColor`. For Tailwind v4, leave the `tailwind.config` field empty since Tailwind v4 uses CSS-first configuration with `@theme` directives.

### Tailwind CSS v4 compatibility

**Tailwind v4 is fully supported.** All ShadCN components have been updated for v4 and React 19. Key changes: `tailwindcss-animate` is replaced by `tw-animate-css`, HSL colors converted to OKLCH, `forwardRef` removed (React 19 native ref forwarding), every primitive has a `data-slot` attribute, and there's no `tailwind.config.js` — all configuration happens in CSS via `@theme inline` directives.

### Dark mode configuration

ShadCN uses **`next-themes`** for theme management. For Redgest's dark-mode-default admin panel:

```tsx
<ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
  {children}
</ThemeProvider>
```

The `attribute="class"` prop toggles the `.dark` CSS class on `<html>`, activating the CSS variable overrides defined in `globals.css`. The Tailwind v4 dark variant is declared as `@custom-variant dark (&:is(.dark *))`.

### DataTable and Sidebar components

The **ShadCN DataTable** is a comprehensive guide (not a pre-built component) built on **TanStack Table v8**. It supports sorting, filtering, pagination, column visibility, row selection, and row actions. For a production admin panel, the community extension **sadmann7/shadcn-table** adds server-side pagination/sorting, Notion-style advanced filters, and column resizing — excellent for the Subreddit Manager and Run History screens.

The **ShadCN Sidebar** is a first-class composable component with collapsible modes (icon-only mini sidebar and full width), mobile-responsive sheet menu, keyboard shortcuts (Cmd+B), and dedicated `--sidebar-*` CSS variables for complete theme control. It includes **15+ pre-built layout blocks** and is purpose-built for admin dashboards. This is the right choice for Redgest's 4-screen navigation.

### Cron expression and markdown components

No official ShadCN cron component exists. The best ShadCN-compatible option is **`@vpfaiz/cron-builder-ui`** — built with TypeScript, Tailwind, and Radix primitives with dark mode support. It's very new (v1.0.1), so evaluate maturity; the fallback is building a custom input with ShadCN `Select`/`Tabs` wrapping `cronstrue` for human-readable display.

For rendering digest markdown in Run History, use **`react-markdown`** + `remark-gfm` + `@tailwindcss/typography`. Apply `prose prose-invert` classes for dark-mode-compatible typographic rendering. This is lightweight (~5KB gzip), safe by default, and integrates perfectly with the ShadCN/Tailwind stack.

---

## 4. TurboRepo build pipeline requires explicit Prisma generation

### turbo.json configuration

The critical pattern is making `db:generate` a dependency of both `build` and `dev` tasks:

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build", "^db:generate"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "dev": {
      "dependsOn": ["^db:generate"],
      "cache": false,
      "persistent": true
    },
    "db:generate": { "cache": false }
  },
  "globalEnv": ["DATABASE_URL"]
}
```

The `^db:generate` dependency ensures `prisma generate` in `packages/db` runs before `next build` in `apps/web`. Setting `DATABASE_URL` in `globalEnv` ensures correct task hashing.

### transpilePackages status

**Still recommended as of Next.js 16.1**, especially for Turbopack. There are **known bugs** (GitHub issue #85316) with Turbopack handling `transpilePackages` for transitive dependencies in monorepos. The mitigation: use JIT (Just-in-Time) packaging — export raw `.ts` files from internal packages so Turbopack treats them as local source code. Add all internal packages to `transpilePackages` in `next.config.ts` regardless:

```ts
const nextConfig: NextConfig = {
  transpilePackages: ['@redgest/core', '@redgest/db'],
  output: 'standalone',
};
```

### Hot module reload

**Yes, changes in `packages/core` trigger recompilation in `apps/web`** when using JIT packages. Turbopack natively watches workspace dependencies. For packages with their own build step, use `turbo watch dev` (Turborepo 2.0+) which provides dependency-aware file watching.

---

## 5. Self-hosting requires manual cache and static asset handling

### Standalone output works but needs attention

The `output: "standalone"` mode creates a minimal `server.js` with only required `node_modules` via file tracing. Two things are **not copied automatically**: `public/` and `.next/static/` — these must be explicitly copied in the Dockerfile. Set `HOSTNAME="0.0.0.0"` for Docker containers.

For the monorepo, the standalone folder preserves the directory structure (e.g., `apps/web/server.js`), and you need `outputFileTracingRoot` pointing to the monorepo root.

### Features that degrade outside Vercel

This is the most critical self-hosting concern. The key issues for Redgest:

- **Image optimization** works but requires `sharp` in production deps (auto-included since Next.js 15). Without it, falls back to slow `squoosh`. Since Redgest is a minimal admin panel, this is low-impact.
- **ISR** works on a single instance but **breaks with multiple instances** — the default cache is local filesystem. For a single-user personal tool running one container, this is fine. If scaling, configure a Redis `cacheHandler`.
- **Middleware/Proxy** runs on the origin server (single region), not at the edge. Functionally correct but adds latency compared to Vercel's edge execution. For a personal tool, irrelevant.
- **Cache invalidation** (`revalidateTag`/`revalidatePath`) only invalidates local cache — no CDN propagation. Fine for a personal tool without a CDN.
- **`NEXT_PUBLIC_*` variables are baked in at build time** — this is the biggest gotcha for Docker. Avoid `NEXT_PUBLIC_*` for values that differ per environment; instead, read server-side `process.env` in a Server Component and pass to clients via props or context.

### Docker multi-stage build

The recommended pattern uses `turbo prune web --docker` to create an optimized monorepo subset, then builds in three stages (prune → build → run):

```dockerfile
FROM node:20-alpine AS base
FROM base AS pruner
RUN npm install -g turbo@^2
COPY . .
RUN turbo prune web --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN corepack enable && pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=web

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
ENV PORT=3000 HOSTNAME="0.0.0.0" NODE_ENV=production
CMD ["node", "apps/web/server.js"]
```

Final image size: **under 200MB**.

### OpenNext project status

OpenNext is active with adapters for AWS (SST, ~5K GitHub stars), Cloudflare (~1.7K stars), and Netlify (~800 stars). Production users include NHS England, Udacity, and Gymshark. **However, OpenNext is irrelevant for Redgest's use case** — it targets serverless platforms (Lambda, Workers). For a personal tool, plain Docker with `output: "standalone"` is simpler and more appropriate. Next.js 16's experimental `adapterPath` API may eventually give OpenNext a stable hook point, reducing its current fragility from tracking undocumented internals.

---

## 6. TanStack Query wins for polling and client-side data

**TanStack Query v5** is the recommendation over SWR for Redgest's admin panel. It surpassed SWR in weekly downloads (12.3M vs 7.7M) and offers superior mutation handling with `useMutation` — optimistic updates, cache invalidation, and rollback on failure. Its official DevTools panel is essential for debugging.

### Server prefetch + client hydration pattern

Prefetch in a Server Component, dehydrate the cache, and wrap children in `<HydrationBoundary>`. Client components pick up data instantly via `useQuery` with zero loading state. This is the officially recommended pattern for the App Router.

### Polling for Run History

Use `refetchInterval` on `useQuery` for the Run History screen to poll for new digest runs:

```tsx
const { data } = useQuery({
  queryKey: ['runs'],
  queryFn: () => fetch('/api/runs').then(r => r.json()),
  refetchInterval: 5000,
  refetchIntervalInBackground: false,
});
```

For the simplest possible approach (no extra library), a `router.refresh()` polling hook re-fetches all Server Component data every N seconds — zero-dependency and works well for a minimal admin panel.

### SSE is supported but overkill

Server-Sent Events work via Route Handlers using `ReadableStream`, but for a single-user admin panel checking digest status, **polling every 5-10 seconds is simpler and sufficient**. Reserve SSE for real-time push requirements.

**Do not poll Server Actions** — they use POST internally, lack caching/deduplication, and serialize sequentially. Use Route Handlers or `router.refresh()` for polling.

---

## 7. Forms should combine React Hook Form with useActionState

### The recommended stack remains RHF + Zod + ShadCN Form

ShadCN's official documentation specifically recommends and documents `react-hook-form` + `zod` + `@hookform/resolvers`. The `<Form>` component wraps RHF's `useForm` and auto-renders Zod validation errors via `<FormMessage>`.

**`useActionState` does not replace React Hook Form** — they solve different problems. `useActionState` provides automatic pending state and progressive enhancement but lacks client-side instant validation, field-level error tracking, and dirty/touched state. For Redgest's CRUD forms with multiple fields, use both together: RHF for client-side validation (mode `onBlur`) and `useActionState` for server-side validation and pending state.

### Server action validation pattern

The established pattern: `safeParse()` with Zod, return `error.flatten().fieldErrors` as a `Record<string, string[]>`. Always return the same shape (`{ errors, message, success }`) from every action. The server action receives `(prevState, formData)` when used with `useActionState`.

### Shared Zod schemas in the monorepo

Create a `packages/schemas/` (or embed in `@redgest/core`) package exporting Zod schemas with JIT packaging (raw `.ts` exports). Use `.partial()`, `.pick()`, and `.extend()` to derive create/update/filter variants from base schemas. The same schema validates client-side (via `zodResolver`) and server-side (via `safeParse` in Server Actions), providing a **single source of truth** with full TypeScript inference via `z.infer<>`.

---

## 8. Testing strategy: Vitest for units, Playwright for flows

### The critical limitation

**Async Server Components cannot be unit tested** with Vitest or Jest — this is explicitly stated in the Next.js docs. Both tools fail to render `async` RSC. The official recommendation: use E2E testing for async components and reserve unit tests for client components, utility functions, and synchronous server components.

### Recommended two-tool strategy

- **Vitest** (~4.x) + React Testing Library for unit and integration tests — **10-20x faster** than Jest in watch mode, native ESM, Next.js officially supports it.
- **Playwright** (~1.49+) for E2E tests against a production build — auto-starts the Next.js server via `webServer` config.

For Redgest's 4 screens, target approximately **25-35 unit tests** (form validation, utility functions, client components), **8-12 integration tests** (component compositions), and **10-15 E2E tests** (critical user flows per screen).

### Testing Server Actions

Use a three-tier approach: extract business logic into pure testable functions (Tier 1), unit test Server Actions directly with `vi.mock()` for `next/cache` and `next/navigation` (Tier 2), and E2E test actions through the browser with Playwright (Tier 3 — most reliable).

ShadCN components are your own code (copied into your project), so testing them is standard React Testing Library work. The main gotcha: ShadCN's Radix-based `<Select>` is not a native `<select>` — use `getByRole('combobox')` and click-to-select patterns instead of `selectOptions()`.

---

## 9. Recommended dependency versions and decisions summary

| Dependency | Version | Decision |
|---|---|---|
| **Next.js** | 16.1.x | Current stable LTS |
| **React** | 19.2 | Ships with Next.js 16 |
| **Prisma** | 7.4.x | Rust-free ESM client; requires `@prisma/adapter-pg` |
| **Tailwind CSS** | 4.x | CSS-first config, no `tailwind.config.js` |
| **ShadCN/ui** | Latest | Monorepo mode with `packages/ui/` |
| **TanStack Query** | 5.x | Polling + mutations + server prefetch hydration |
| **React Hook Form** | Latest | With `@hookform/resolvers` + Zod |
| **Zod** | 3.23+ | Shared schemas in `@redgest/core` |
| **next-themes** | 0.4.x | Dark mode via `defaultTheme="dark"` |
| **TanStack Table** | 8.x | DataTable for Subreddit Manager and Run History |
| **react-markdown** | 10.x | Digest output rendering with `remark-gfm` |
| **Trigger.dev** | 4.4.x | Task triggering from Server Actions |
| **Vitest** | 4.x | Unit/integration testing |
| **Playwright** | 1.49+ | E2E testing |
| **Turborepo** | 2.x | Build orchestration |

## Conclusion

The Next.js 16 + React 19 + Prisma 7 stack is production-ready for Redgest but carries a heavier-than-usual migration burden. **Prisma 7's mandatory driver adapters and required output paths** are the most disruptive change — expect to rewrite client initialization entirely. **Turbopack's monorepo transpilation bugs** (issue #85316) mean JIT packaging for internal packages is essential; if problems arise, the `--webpack` escape hatch remains available. The architecture naturally maps to CQRS: Server Components call query handlers from `@redgest/core`, Server Actions call command handlers, and `@redgest/db` encapsulates all Prisma access behind a DAL with serialization-safe DTOs. Self-hosting via Docker is straightforward for a single-user tool — the features that degrade outside Vercel (edge middleware, multi-instance ISR, CDN cache propagation) are irrelevant at this scale. The one non-obvious insight: **avoid `NEXT_PUBLIC_*` environment variables** in the Docker build to maintain environment portability — instead, read `process.env` in Server Components and pass values to clients through the component tree.