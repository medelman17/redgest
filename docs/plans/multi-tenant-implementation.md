# Multi-Tenant Implementation Plan

## Overview

Transform Redgest from a single-user system to a multi-tenant platform with BetterAuth authentication and organization-based data isolation.

## Design Decisions

### Tenant Isolation Strategy
- **Posts/PostComments** → Shared globally (Reddit content cache). Multiple orgs tracking the same subreddit share the same post records.
- **Subreddits** → Per-org. Each org configures which subs to track with its own insight prompts. Same Reddit sub name can exist for different orgs. Unique constraint: `[name, organizationId]`.
- **Config** → Per-org. Each org gets its own config row. Singleton pattern becomes `@@unique([organizationId])`.
- **Jobs, Digests, DigestPosts, PostSummaries, LlmCalls, Deliveries** → Per-org via Job's `organizationId`. Summaries/digests inherit org scope through their job FK.
- **Events** → Per-org. Add `organizationId` column.
- **DigestProfiles** → Per-org. Add `organizationId`. Unique: `[name, organizationId]`.
- **Topics/PostTopics** → Global (extracted from shared post data).

### Auth Stack
- **BetterAuth** with Prisma adapter (provider: "postgresql")
- **Organization plugin** for multi-org membership
- **Email/password** + **GitHub OAuth**
- **Session** stores `activeOrganizationId`
- Users can belong to multiple orgs and switch between them

### Auth Package Location
- New `packages/auth` package in the monorepo
- Shared between `apps/web` (Next.js) and `packages/mcp-server`

---

## Implementation Steps

### Step 1: Create `packages/auth`

**New files:**
- `packages/auth/package.json` — deps: `better-auth`, `@redgest/db`, `@redgest/config`
- `packages/auth/tsconfig.json` — inherits base
- `packages/auth/src/index.ts` — server-side auth instance export
- `packages/auth/src/auth.ts` — BetterAuth config with Prisma adapter, org plugin, email/password, GitHub
- `packages/auth/src/client.ts` — `createAuthClient` with org plugin for React

**Auth config:**
```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@redgest/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  plugins: [organization(), nextCookies()],
});
```

**Env additions** (in `@redgest/config`):
- `GITHUB_CLIENT_ID` (optional)
- `GITHUB_CLIENT_SECRET` (optional)
- `BETTER_AUTH_SECRET` (required — session signing key)
- `BETTER_AUTH_URL` (optional — base URL)

### Step 2: Prisma Schema Migration

**New BetterAuth tables** (generated via `npx auth@latest generate`):
- `user` — id, name, email, emailVerified, image, createdAt, updatedAt
- `session` — id, userId, token, expiresAt, ipAddress, userAgent, activeOrganizationId
- `account` — id, userId, accountId, providerId, accessToken, refreshToken, etc.
- `verification` — id, identifier, value, expiresAt, createdAt, updatedAt

**Organization plugin tables:**
- `organization` — id, name, slug, logo, createdAt, metadata
- `member` — id, organizationId, userId, role, createdAt
- `invitation` — id, organizationId, email, role, status, expiresAt, inviterId

**Add `organizationId` to existing tables:**
- `subreddits` → `organization_id` (required FK). Drop `@@unique(name)`, add `@@unique([name, organizationId])`
- `config` → `organization_id` (required FK). Change from `CHECK(id=1)` singleton to `@@unique([organizationId])`
- `jobs` → `organization_id` (required FK)
- `events` → `organization_id` (nullable — backward compatible, some system events have no org)
- `digest_profiles` → `organization_id` (required FK). Drop `@@unique(name)`, add `@@unique([name, organizationId])`

**Update views:** All 6 views need `organization_id` added and exposed.

### Step 3: Update Core CQRS for Org Scoping

**HandlerContext changes:**
```typescript
export type HandlerContext = {
  db: DbClient;
  eventBus: DomainEventBus;
  config: RedgestConfig;
  searchService?: SearchService;
  organizationId: string;  // NEW — required for all handlers
};
```

**Command handler updates (all 9):**
- `AddSubreddit` — set `organizationId` on created subreddit
- `UpdateSubreddit` — verify subreddit belongs to org before update
- `RemoveSubreddit` — verify subreddit belongs to org before delete
- `UpdateConfig` — upsert config by `organizationId` instead of `id=1`
- `GenerateDigest` — set `organizationId` on created job, scope profile/subreddit lookups
- `CancelRun` — verify job belongs to org
- `CreateProfile` — set `organizationId` on profile
- `UpdateProfile` — verify profile belongs to org
- `DeleteProfile` — verify profile belongs to org

**Query handler updates (all 21):**
- All queries add `WHERE organization_id = ?` filter
- View-based queries update to use new view definitions with org column

**Event persistence:**
- `persistEvent()` includes `organizationId` in event metadata or as column

### Step 4: Wire Auth in Next.js

**API route:**
- `apps/web/app/api/auth/[...all]/route.ts` — catch-all handler using `toNextJsHandler(auth)`

**Session access pattern:**
```typescript
// In server components / server actions:
import { auth } from "@redgest/auth";
import { headers } from "next/headers";

const session = await auth.api.getSession({ headers: await headers() });
const orgId = session?.session.activeOrganizationId;
```

**DAL update (`apps/web/lib/dal.ts`):**
- `getBootstrap()` now requires auth session
- All query/command wrappers extract `organizationId` from session
- Pass `organizationId` through `HandlerContext`

**Route protection:**
- Middleware/proxy for `/dashboard/*`, `/settings/*`, `/subreddits/*`, etc.
- Redirect to `/login` if no session
- Redirect to `/onboarding` if no active org

### Step 5: Auth UI Pages

**New pages:**
- `apps/web/app/(auth)/login/page.tsx` — Email/password + GitHub OAuth sign-in
- `apps/web/app/(auth)/signup/page.tsx` — Registration form
- `apps/web/app/(auth)/layout.tsx` — Centered auth layout (no sidebar)
- `apps/web/app/onboarding/page.tsx` — Create first org after signup
- `apps/web/app/settings/organization/page.tsx` — Org settings, members, invites

**New components:**
- `OrgSwitcher` — Dropdown in sidebar header, shows current org, lists all orgs, switch action
- `UserMenu` — Avatar + dropdown with profile, sign out
- `AuthForm` — Shared sign-in/sign-up form with social buttons

### Step 6: Update MCP Server Auth

**Current:** Optional bearer token (`MCP_SERVER_API_KEY`)
**New:** Support both:
1. **API key auth** (existing) — for MCP/Claude usage. API key maps to a specific org.
2. **Session auth** — for browser-based access. Extract org from session.

**Approach:** Add `organizationId` resolution to bootstrap. MCP tools receive org-scoped context.

### Step 7: Update Worker Tasks

**Trigger.dev tasks** (`apps/worker/src/trigger/`):
- `generate-digest` — receives `organizationId` in payload, passes through pipeline
- `deliver-digest` — loads delivery config from org's config row
- `scheduled-digest` — iterates all active orgs, triggers per-org digest generation

---

## Migration Strategy

Since this is a development project (not production with existing data), the migration can be destructive:
1. Add all new tables/columns in a single migration
2. BetterAuth tables created via Prisma migration (not BetterAuth CLI, since we manage schema manually)
3. Seed script creates a default org and migrates existing data to it

## File Change Summary

| Area | Files Changed | New Files |
|------|--------------|-----------|
| `packages/auth` | — | ~5 files |
| `packages/db` | schema.prisma, 1 migration | — |
| `packages/config` | src/index.ts | — |
| `packages/core` | context.ts, all 30 handlers, dispatch.ts, pipeline/* | — |
| `packages/mcp-server` | bootstrap.ts, auth.ts, tools.ts | — |
| `apps/web` | layout.tsx, dal.ts, actions.ts, all pages | ~8 new pages/components |
| `apps/worker` | all 3 tasks | — |
| Root | turbo.json, pnpm-workspace.yaml | — |

**Estimated scope:** ~60 files modified/created.
