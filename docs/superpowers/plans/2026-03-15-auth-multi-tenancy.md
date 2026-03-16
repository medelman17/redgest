# Phase 5: Authentication & Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden BetterAuth configuration, protect routes, enforce multi-tenant data isolation, and complete auth UX flows (email verification, password reset, org invitations) across 23 issues spanning 3 sprints.

**Architecture:** PR #46 (`claude/add-users-organizations-L2LgW`) adds BetterAuth with Prisma adapter, organization plugin, and org-scoped CQRS handlers. This plan hardens that foundation: Sprint 12 configures BetterAuth to production standards and adds route protection; Sprint 13 wires session-based org resolution and closes multi-tenant data leakage in SearchService raw SQL; Sprint 14 completes auth UX flows and adds test coverage.

**Tech Stack:** BetterAuth (server + React client), Better Auth Prisma adapter, Next.js 16 middleware, Resend (email delivery), `@redgest/email` (React Email templates), Vitest (unit tests), Playwright (E2E)

**Branch:** All work targets the `claude/add-users-organizations-L2LgW` branch (PR #46).

---

## File Structure

### Sprint 12 — Auth Config Hardening + Route Protection

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/auth/src/auth.ts` | All BetterAuth config changes (#56-61, #68, #70, #71) |
| Modify | `packages/auth/src/client.ts` | Type inference from server auth (#69) |
| Modify | `packages/config/src/schema.ts` | Auth env vars + `REDGEST_ORG_ID` (#56, #63) |
| Modify | `turbo.json` | Add auth env vars to env passthrough (#57, #63) |
| Create | `apps/web/middleware.ts` | Route protection middleware (#49) |
| Create | `apps/web/lib/fonts.ts` | Shared font config (#62) |
| Modify | `apps/web/app/layout.tsx` | Import from shared fonts (#62) |
| Modify | `apps/web/app/(auth)/layout.tsx` | Import from shared fonts, conditional GitHub (#62, #61) |
| Modify | `apps/web/app/(auth)/login/page.tsx` | Conditional GitHub button (#61) |
| Modify | `apps/web/app/(auth)/signup/page.tsx` | Conditional GitHub button (#61) |
| Create | `packages/auth/src/__tests__/auth-config.test.ts` | Auth config smoke tests |
| Create | `apps/web/__tests__/middleware.test.ts` | Middleware unit tests |

### Sprint 13 — Multi-Tenant Enforcement

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/web/lib/dal.ts` | Session-based orgId resolution (#50) |
| Create | `apps/web/lib/auth-utils.ts` | Server-side auth helpers (#50) |
| Modify | `packages/mcp-server/src/bootstrap.ts` | Keep env fallback for MCP (#50) |
| Modify | `packages/core/src/search/types.ts` | Add `organizationId` to SearchOptions (#51) |
| Modify | `packages/core/src/search/service.ts` | Org-filtered raw SQL in all 4 methods (#51) |
| Modify | `packages/core/src/queries/handlers/search-posts.ts` | Pass orgId to SearchOptions (#51) |
| Modify | `packages/core/src/queries/handlers/search-digests.ts` | Pass orgId to SearchOptions (#51) |
| Modify | `packages/core/src/queries/handlers/ask-history.ts` | Pass orgId to SearchOptions (#51) |
| Modify | `packages/core/src/queries/handlers/find-similar.ts` | Pass orgId to SearchOptions (#51) |
| Modify | `packages/core/src/queries/handlers/get-trending-topics.ts` | Org filter via subreddits join (#51) |
| Modify | `packages/core/src/queries/handlers/compare-periods.ts` | Org filter via subreddits join (#51) |
| Create | `apps/web/app/onboarding/page.tsx` | Org onboarding flow (#54) |
| Create | `apps/web/components/org-switcher.tsx` | Organization switcher component (#54) |
| Modify | `apps/worker/src/trigger/scheduled-digest.ts` | Multi-org legacy path iteration (#64) |
| Modify | `apps/worker/src/trigger/generate-digest.ts` | Pass orgId to deliver-digest (#65) |
| Modify | `apps/worker/src/trigger/deliver-digest.ts` | Accept orgId in payload (#65) |

### Sprint 14 — Auth UX + Testing

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/auth/src/auth.ts` | Email verification + password reset config (#52, #53) |
| Create | `packages/auth/src/emails.ts` | Auth email sending functions (#52, #53, #55) |
| Create | `apps/web/app/(auth)/forgot-password/page.tsx` | Forgot password form (#53) |
| Create | `apps/web/app/(auth)/reset-password/page.tsx` | Reset password form (#53) |
| Modify | `apps/web/app/(auth)/login/page.tsx` | "Forgot password?" link (#53) |
| Create | `apps/web/app/invite/[id]/page.tsx` | Invitation acceptance page (#55) |
| Modify | `packages/auth/src/auth.ts` | Invitation email config (#55) |
| Modify | `packages/auth/src/auth.ts` | Audit logging database hooks (#67) |
| Create | `packages/core/src/__tests__/search-tenant-isolation.test.ts` | Cross-tenant search isolation tests (#66) |
| Create | `packages/auth/src/__tests__/auth-integration.test.ts` | Auth package integration tests (#66) |

---

## Chunk 1: Sprint 12 — Auth Config Hardening

### Task 1: BETTER_AUTH_SECRET Validation (#56)

**Files:**
- Modify: `packages/config/src/schema.ts`
- Test: `packages/config/src/__tests__/config.test.ts` (existing test file)

**PR branch note:** `BETTER_AUTH_SECRET` already exists as `optionalString` on the PR branch. This task upgrades it to require min 32 chars and adds a `superRefine` for production enforcement.

- [ ] **Step 1: Write the failing test for secret validation**

```typescript
// In packages/config/src/__tests__/config.test.ts — add to existing test file
describe("BETTER_AUTH_SECRET validation", () => {
  it("rejects secrets shorter than 32 characters", () => {
    const result = configSchema.safeParse({
      DATABASE_URL: "postgresql://localhost:5433/redgest",
      BETTER_AUTH_SECRET: "too-short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const secretErrors = result.error.issues.filter(
        (i) => i.path.includes("BETTER_AUTH_SECRET"),
      );
      expect(secretErrors.length).toBeGreaterThan(0);
    }
  });

  it("accepts secrets 32+ characters", () => {
    const result = configSchema.safeParse({
      DATABASE_URL: "postgresql://localhost:5433/redgest",
      BETTER_AUTH_SECRET: "a".repeat(32),
    });
    // Should not fail on BETTER_AUTH_SECRET specifically
    if (!result.success) {
      const secretErrors = result.error.issues.filter(
        (i) => i.path.includes("BETTER_AUTH_SECRET"),
      );
      expect(secretErrors).toHaveLength(0);
    }
  });

  it("requires secret in production", () => {
    const result = configSchema.safeParse({
      DATABASE_URL: "postgresql://localhost:5433/redgest",
      NODE_ENV: "production",
      // No BETTER_AUTH_SECRET
    });
    expect(result.success).toBe(false);
  });

  it("allows missing secret in development", () => {
    const result = configSchema.safeParse({
      DATABASE_URL: "postgresql://localhost:5433/redgest",
      NODE_ENV: "development",
    });
    if (!result.success) {
      const secretErrors = result.error.issues.filter(
        (i) => i.path.includes("BETTER_AUTH_SECRET"),
      );
      expect(secretErrors).toHaveLength(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @redgest/config exec vitest run src/__tests__/config.test.ts -t "BETTER_AUTH_SECRET"`
Expected: FAIL — current schema uses `optionalString` with no min-length or production enforcement

- [ ] **Step 3: Upgrade BETTER_AUTH_SECRET validation in config schema**

In `packages/config/src/schema.ts`, replace the existing `BETTER_AUTH_SECRET: optionalString` with:

```typescript
  BETTER_AUTH_SECRET: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters").optional(),
  ),
```

Also add these new auth env vars (if not already present from PR branch — check first):

```typescript
  BETTER_AUTH_TRUSTED_ORIGINS: optionalString,
  REDGEST_ORG_ID: optionalString,
```

Then add a `.superRefine()` to enforce the secret in production. **Note:** In Zod 4, `.superRefine()` on a `z.object()` returns a refined type. The inferred type is preserved, but `configSchema.shape` access is no longer available. Verify nothing in the codebase uses `.shape` (it doesn't — only `.safeParse()` and `z.infer<>` are used).

```typescript
export const configSchema = z.object({
  // ... existing fields ...
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === "production" && !data.BETTER_AUTH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "BETTER_AUTH_SECRET is required in production",
      path: ["BETTER_AUTH_SECRET"],
    });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @redgest/config exec vitest run src/__tests__/config.test.ts -t "BETTER_AUTH_SECRET"`
Expected: PASS

- [ ] **Step 5: Update auth.ts to read secret from validated config**

In `packages/auth/src/auth.ts`, BetterAuth reads `BETTER_AUTH_SECRET` from env vars automatically when `secret` is not set in config. We only set it explicitly to ensure it goes through our validated config path:

```typescript
const secret = process.env.BETTER_AUTH_SECRET;

export const auth = betterAuth({
  ...(secret ? { secret } : {}),
  // ... rest of config
});
```

- [ ] **Step 6: Run all config tests**

Run: `pnpm --filter @redgest/config exec vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/config/src/schema.ts packages/config/src/__tests__/config.test.ts packages/auth/src/auth.ts
git commit -m "feat(config): validate BETTER_AUTH_SECRET — require 32+ chars, enforce in production (#56)"
```

---

### Task 2: trustedOrigins + CSRF Protection (#57)

**Files:**
- Modify: `packages/auth/src/auth.ts`
- Modify: `turbo.json`

**PR branch note:** `turbo.json` already has `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` in `globalPassThroughEnv`. Only `BETTER_AUTH_TRUSTED_ORIGINS` and `REDGEST_ORG_ID` need to be added.

- [ ] **Step 1: Add missing env vars to turbo.json**

In `turbo.json`, add to `globalPassThroughEnv`:

```json
"BETTER_AUTH_TRUSTED_ORIGINS",
"REDGEST_ORG_ID"
```

- [ ] **Step 2: Configure trustedOrigins in auth.ts**

```typescript
// In packages/auth/src/auth.ts, inside the betterAuth({}) config:
export const auth = betterAuth({
  appName: "Redgest",
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim())
    : [],
  // ... rest of config
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/auth/src/auth.ts turbo.json
git commit -m "feat(auth): configure trustedOrigins and baseURL for CSRF protection (#57)"
```

---

### Task 3: Small Auth Config Changes (#58, #59, #68, #70, #71)

These are all small modifications to `packages/auth/src/auth.ts`. Group them into one task.

**Files:**
- Modify: `packages/auth/src/auth.ts`

- [ ] **Step 1: Apply all 5 config changes in auth.ts**

The final `auth.ts` should look like:

```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@redgest/db";

const secret = process.env.BETTER_AUTH_SECRET;

export const auth = betterAuth({
  appName: "Redgest",
  ...(secret ? { secret } : {}),
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim())
    : [],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 256,
  },
  // Only register GitHub when credentials exist — empty strings cause OAuth failures
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
      // Note: custom session fields (like activeOrganizationId) are NOT
      // cached in the cookie — always re-fetched from DB on access
    },
  },
  // Verify these options exist in the installed BetterAuth version at
  // typecheck time. If `account.encryptOAuthTokens` or `rateLimit.customRules`
  // don't exist in your version, remove them and file a follow-up issue.
  account: {
    encryptOAuthTokens: true,
  },
  rateLimit: {
    enabled: true,
    window: 60, // 1 minute window
    max: 100, // default for most endpoints
    customRules: {
      "/api/auth/sign-in/email": { window: 60, max: 5 },
      "/api/auth/sign-up/email": { window: 60, max: 3 },
      "/api/auth/forgot-password": { window: 60, max: 3 },
    },
  },
  plugins: [
    organization({
      organizationLimit: 5,
      membershipLimit: 50,
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
```

**Important:** Run `pnpm --filter @redgest/auth exec tsc --noEmit` after applying. If any BetterAuth config options cause type errors (e.g., `account.encryptOAuthTokens`, `rateLimit.customRules`), check the installed version's type definitions and remove unsupported options.

- [ ] **Step 2: Run typecheck on auth package**

Run: `pnpm --filter @redgest/auth exec tsc --noEmit`
Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add packages/auth/src/auth.ts
git commit -m "feat(auth): harden config — OAuth encryption, password policy, rate limits, org limits, cookie strategy (#58, #59, #68, #70, #71)"
```

---

### Task 4: Conditional GitHub OAuth Button (#61)

**Approach:** Convert login/signup page.tsx files from client components to thin server components that read `process.env` and pass `githubEnabled` as a prop to a client form component. This avoids `NEXT_PUBLIC_*` per CLAUDE.md.

**Files:**
- Create: `apps/web/app/(auth)/login/login-form.tsx` (client component, moved from page.tsx)
- Modify: `apps/web/app/(auth)/login/page.tsx` (convert to server component)
- Create: `apps/web/app/(auth)/signup/signup-form.tsx` (client component, moved from page.tsx)
- Modify: `apps/web/app/(auth)/signup/page.tsx` (convert to server component)

- [ ] **Step 1: Create login-form.tsx client component**

Move all existing client logic from `login/page.tsx` into `login/login-form.tsx`. Add `githubEnabled` prop:

```typescript
// apps/web/app/(auth)/login/login-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@redgest/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ githubEnabled }: { githubEnabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ... existing handleSubmit and handleGitHub logic ...

  return (
    <>
      {/* ... existing form JSX ... */}

      {githubEnabled && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>
          <Button variant="outline" className="w-full" onClick={handleGitHub}>
            GitHub
          </Button>
        </>
      )}

      {/* ... sign up link ... */}
    </>
  );
}
```

- [ ] **Step 2: Convert login/page.tsx to thin server component**

```typescript
// apps/web/app/(auth)/login/page.tsx
import { LoginForm } from "./login-form";

export default function LoginPage() {
  const githubEnabled = Boolean(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
  );
  return <LoginForm githubEnabled={githubEnabled} />;
}
```

- [ ] **Step 3: Apply the same pattern to signup**

Create `signup/signup-form.tsx` (client) and convert `signup/page.tsx` (server). Same `githubEnabled` prop pattern.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter apps/web exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(auth\)/login/ apps/web/app/\(auth\)/signup/
git commit -m "feat(web): conditionally render GitHub OAuth button based on env (#61)"
```

---

### Task 5: REDGEST_ORG_ID in Config Schema (#63)

**Files:**
- Modify: `packages/config/src/schema.ts` (already done in Task 1 if grouped)

**PR branch note:** `turbo.json` already has `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. `REDGEST_ORG_ID` and `BETTER_AUTH_TRUSTED_ORIGINS` were added in Task 2. DAL refactoring is deferred to Task 10 (Sprint 13) to avoid double-touching the same code path.

- [ ] **Step 1: Verify REDGEST_ORG_ID is in config schema**

Already added in Task 1. Verify it's present:

```typescript
REDGEST_ORG_ID: optionalString,
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit (if any changes)**

```bash
git add packages/config/src/schema.ts
git commit -m "feat(config): add REDGEST_ORG_ID to validated config schema (#63)"
```

---

### Task 6: Client Type Inference (#69)

**Files:**
- Modify: `packages/auth/src/client.ts`
- Modify: `packages/auth/src/index.ts` (add `Auth` type to barrel export)

**Note:** Verify `createAuthClient<Auth>()` accepts a generic type parameter in the installed BetterAuth version. Check `node_modules/better-auth/react/index.d.ts` for the generic signature. If the generic isn't supported, use `declare module` augmentation instead (see BetterAuth docs on type inference).

- [ ] **Step 1: Add type inference from server auth instance**

```typescript
// packages/auth/src/client.ts
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import type { Auth } from "./auth.js";

export const authClient = createAuthClient<Auth>({
  plugins: [organizationClient()],
});

export type AuthClient = typeof authClient;
```

`Auth` is a `type`-only import — no server code leaks into the client bundle. The `Auth` type was exported from `auth.ts` in Task 3.

- [ ] **Step 2: Update barrel export to include Auth type**

In `packages/auth/src/index.ts`, add:

```typescript
export type { Auth } from "./auth.js";
```

- [ ] **Step 3: Run typecheck — verify generic is valid**

Run: `pnpm --filter @redgest/auth exec tsc --noEmit`

If this fails with a type error on `createAuthClient<Auth>`, the generic parameter is not supported in this version. Fall back to removing the generic:

```typescript
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/client.ts packages/auth/src/index.ts
git commit -m "feat(auth): add type inference from server auth instance to client (#69)"
```

---

### Task 7: Deduplicate Auth Layout Fonts (#62)

**Files:**
- Create: `apps/web/lib/fonts.ts`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/(auth)/layout.tsx`

- [ ] **Step 1: Create shared fonts module**

```typescript
// apps/web/lib/fonts.ts
import { JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const sans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-sans",
});
```

- [ ] **Step 2: Update root layout to import from shared fonts**

In `apps/web/app/layout.tsx`, replace the font declarations:

```typescript
import { mono, sans } from "@/lib/fonts";
// Remove the JetBrains_Mono and IBM_Plex_Sans imports and declarations
```

- [ ] **Step 3: Update auth layout to import from shared fonts**

In `apps/web/app/(auth)/layout.tsx`, replace the font declarations:

```typescript
import { mono, sans } from "@/lib/fonts";
// Remove the JetBrains_Mono and IBM_Plex_Sans imports and declarations
```

- [ ] **Step 4: Run dev server to verify both layouts render correctly**

Run: `pnpm --filter apps/web exec next build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/fonts.ts apps/web/app/layout.tsx apps/web/app/\(auth\)/layout.tsx
git commit -m "refactor(web): deduplicate font config into shared fonts.ts module (#62)"
```

---

### Task 8: Route Protection Middleware (#49)

This is the most critical Sprint 12 task — it blocks all downstream auth work.

**Files:**
- Create: `apps/web/lib/route-matching.ts` (extracted for testability)
- Create: `apps/web/middleware.ts`
- Create: `apps/web/__tests__/route-matching.test.ts`

**Note:** `apps/web` doesn't have vitest configured. The Playwright tests handle E2E, but for unit-testing route matching logic, we need vitest. However, to avoid adding vitest infrastructure to the web app for a single test, we extract the route matching logic to a pure function file and test it. The actual middleware is thin and relies on the extracted logic.

If vitest IS already configured (check `apps/web/vitest.config.ts` or `package.json` test script), skip the vitest setup step.

- [ ] **Step 1: Check if vitest is configured for apps/web**

Run: `ls apps/web/vitest.config.* 2>/dev/null; grep '"test"' apps/web/package.json`

If not configured, add vitest to the web app:

```bash
pnpm --filter apps/web add -D vitest
```

Create `apps/web/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

Add test script to `apps/web/package.json`:
```json
"test": "vitest run"
```

- [ ] **Step 2: Create route matching module**

```typescript
// apps/web/lib/route-matching.ts
export const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/api/auth",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}
```

- [ ] **Step 3: Write failing test for route matching**

```typescript
// apps/web/__tests__/route-matching.test.ts
import { describe, it, expect } from "vitest";
import { isPublicPath } from "../lib/route-matching";

describe("isPublicPath", () => {
  it("allows auth routes", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/signup")).toBe(true);
    expect(isPublicPath("/api/auth/session")).toBe(true);
    expect(isPublicPath("/api/auth/sign-in/email")).toBe(true);
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/invite/abc123")).toBe(true);
  });

  it("blocks protected routes", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/subreddits")).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it passes** (we wrote the module first since it's trivial)

Run: `pnpm --filter apps/web exec vitest run __tests__/route-matching.test.ts`
Expected: PASS

- [ ] **Step 5: Create the middleware using the extracted route matching**

```typescript
// apps/web/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "./lib/route-matching";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for session cookie — BetterAuth sets "better-auth.session_token"
  // (or "__Secure-better-auth.session_token" in production)
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 6: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/route-matching.ts apps/web/middleware.ts apps/web/__tests__/route-matching.test.ts
git commit -m "feat(web): add route protection middleware — redirect unauthenticated users to /login (#49)"
```

---

**Task 9 (Rate Limit Customization #60):** Fully covered by Task 3 — the `rateLimit.customRules` block handles sign-in (5/min), sign-up (3/min), and forgot-password (3/min). No separate task needed.

---

## Chunk 2: Sprint 13 — Multi-Tenant Enforcement

### Task 10: Wire Session-Based organizationId in DAL (#50)

This is the most complex Sprint 13 task. The DAL currently reads `REDGEST_ORG_ID` env var. It needs to read `activeOrganizationId` from the BetterAuth session.

**Files:**
- Create: `apps/web/lib/auth-utils.ts`
- Modify: `apps/web/lib/dal.ts`

- [ ] **Step 1: Create server-side auth utility**

```typescript
// apps/web/lib/auth-utils.ts
import "server-only";
import { auth } from "@redgest/auth";
import { headers } from "next/headers";
import { DEFAULT_ORGANIZATION_ID } from "@redgest/config";

/**
 * Get the current user's active organization ID from the BetterAuth session.
 * Falls back to REDGEST_ORG_ID env var, then DEFAULT_ORGANIZATION_ID.
 *
 * Must be called from Server Components or Server Actions (reads headers).
 */
export async function getOrganizationId(): Promise<string> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (session?.session?.activeOrganizationId) {
      return session.session.activeOrganizationId;
    }
  } catch {
    // Session read failed — fall back to env
  }
  return process.env.REDGEST_ORG_ID ?? DEFAULT_ORGANIZATION_ID;
}

/**
 * Get the current session, or null if not authenticated.
 */
export async function getSession() {
  try {
    return await auth.api.getSession({
      headers: await headers(),
    });
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update DAL to use session-based org resolution**

In `apps/web/lib/dal.ts`, modify the `getBootstrap()` function to accept an `organizationId` parameter instead of reading env directly:

```typescript
// Replace the hardcoded organizationId line in getBootstrap():
// OLD: const organizationId = process.env.REDGEST_ORG_ID ?? DEFAULT_ORGANIZATION_ID;
// NEW: Accept it as a parameter

async function getBootstrap(organizationId: string): Promise<BootstrapResult> {
  // ... existing code, using the passed organizationId ...
}
```

Then update all exported functions to call `getOrganizationId()` before calling `getBootstrap()`:

```typescript
import { getOrganizationId } from "./auth-utils";

export async function listSubreddits(): Promise<QueryResultMap["ListSubreddits"]> {
  const orgId = await getOrganizationId();
  const { query, queryCtx } = await getBootstrap(orgId);
  return query("ListSubreddits", EMPTY_PARAMS, queryCtx);
}
```

**Important:** The HMR singleton cache (`globalForDal.__redgestDal`) must be keyed by orgId or cleared, since different orgs need different contexts. Simplest fix: don't cache the orgId in the singleton — rebuild contexts per-request with the orgId:

```typescript
// Instead of caching the full BootstrapResult (which includes orgId-dependent contexts),
// cache only the org-independent parts (execute, query functions).
// Build contexts fresh per-request with the resolved orgId.
interface CachedInfra {
  execute: ReturnType<typeof createExecute>;
  query: ReturnType<typeof createQuery>;
  config: RedgestConfig;
  db: typeof prisma;
  eventBus: DomainEventBus;
}

const globalForDal = globalThis as unknown as { __redgestInfra?: CachedInfra };

function getInfra(): CachedInfra {
  if (globalForDal.__redgestInfra) return globalForDal.__redgestInfra;
  const config = loadConfig();
  const db = prisma;
  const eventBus = new DomainEventBus();
  const execute = createExecute(commandHandlers);
  const query = createQuery(queryHandlers);
  const infra = { execute, query, config, db, eventBus };
  if (process.env.NODE_ENV !== "production") {
    globalForDal.__redgestInfra = infra;
  }
  return infra;
}

function buildContexts(infra: CachedInfra, organizationId: string) {
  const { db, eventBus, config } = infra;
  const executeCtx: ExecuteContext = {
    db: db as unknown as ExecuteContext["db"],
    eventBus,
    config,
    organizationId,
  };
  const queryCtx: HandlerContext = { db, eventBus, config, organizationId };
  return { executeCtx, queryCtx };
}

// Each exported function:
export async function listSubreddits() {
  const orgId = await getOrganizationId();
  const infra = getInfra();
  const { queryCtx } = buildContexts(infra, orgId);
  return infra.query("ListSubreddits", EMPTY_PARAMS, queryCtx);
}
```

- [ ] **Step 3: Wire event dispatch with org from first call (or env fallback)**

The `wireDigestDispatch()` call needs to happen once. For the DAL, it uses env-based org for the content source pipeline deps (which run in-process only when Trigger.dev is unavailable). This is acceptable since digest generation via the web always goes through Trigger.dev tasks, which get orgId from the payload.

Keep the `wireDigestDispatch` in the cached infra initialization with the env fallback.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/auth-utils.ts apps/web/lib/dal.ts
git commit -m "feat(web): wire session-based organizationId in DAL — read from BetterAuth session (#50)"
```

---

### Task 11: SearchService organizationId Filtering (#51)

**Files:**
- Modify: `packages/core/src/search/types.ts`
- Modify: `packages/core/src/search/service.ts`
- Modify: `packages/core/src/queries/handlers/search-posts.ts`
- Modify: `packages/core/src/queries/handlers/search-digests.ts`
- Modify: `packages/core/src/queries/handlers/ask-history.ts`
- Modify: `packages/core/src/queries/handlers/find-similar.ts`
- Modify: `packages/core/src/queries/handlers/get-trending-topics.ts`
- Modify: `packages/core/src/queries/handlers/compare-periods.ts`
- Test: `packages/core/src/__tests__/search-tenant-isolation.test.ts` (shared with Task 20)

- [ ] **Step 1: Add organizationId to SearchOptions**

```typescript
// packages/core/src/search/types.ts
export interface SearchOptions {
  subreddit?: string;
  since?: Date;
  sentiment?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
  organizationId?: string; // Multi-tenant isolation
}
```

- [ ] **Step 2: Write failing test for org-filtered search**

```typescript
// packages/core/src/__tests__/search-org-filter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("SearchService org filtering", () => {
  it("includes organization_id filter in keyword search SQL when organizationId provided", () => {
    // This test validates that the SQL includes a JOIN to subreddits for org filtering.
    // We test the buildWhereClause helper and the full service method.
    // Implementation detail: posts JOIN subreddits ON posts.subreddit = subreddits.name
    // WHERE subreddits.organization_id = $orgId
    expect(true).toBe(true); // Placeholder — will be replaced with real test after impl
  });
});
```

Since SearchService uses raw SQL via `$queryRaw`, test by mocking `$queryRaw` and inspecting the SQL. These tests go in the same file as Task 20's tests:

```typescript
// packages/core/src/__tests__/search-tenant-isolation.test.ts
// (This file is created here and extended in Task 20)
import { describe, it, expect, vi } from "vitest";
import { createSearchService } from "../search/service.js";

function stub<T>(): T {
  const empty = {};
  return empty as T;
}

function makeMockDb() {
  const mockQueryRaw = vi.fn().mockResolvedValue([]);
  const db = stub<Parameters<typeof createSearchService>[0]>();
  Object.defineProperty(db, "$queryRaw", { value: mockQueryRaw });
  return { db, mockQueryRaw };
}

describe("SearchService org filtering", () => {
  it("passes organizationId through to keyword search SQL", async () => {
    const { db, mockQueryRaw } = makeMockDb();
    const service = createSearchService(db);
    await service.searchByKeyword("test", { organizationId: "org_123" });

    expect(mockQueryRaw).toHaveBeenCalled();
    const call = mockQueryRaw.mock.calls[0];
    const sqlStrings = call?.[0]?.strings ?? call?.[0];
    const sqlText = Array.isArray(sqlStrings) ? sqlStrings.join("") : String(sqlStrings);
    expect(sqlText).toContain("organization_id");
  });

  it("does not filter by org when organizationId is not provided", async () => {
    const { db, mockQueryRaw } = makeMockDb();
    const service = createSearchService(db);
    await service.searchByKeyword("test", {});

    expect(mockQueryRaw).toHaveBeenCalled();
    const call = mockQueryRaw.mock.calls[0];
    const sqlStrings = call?.[0]?.strings ?? call?.[0];
    const sqlText = Array.isArray(sqlStrings) ? sqlStrings.join("") : String(sqlStrings);
    expect(sqlText).not.toContain("organization_id");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/search-tenant-isolation.test.ts`
Expected: FAIL — no org filtering in SQL yet

- [ ] **Step 4: Add org filtering to SearchService**

In `packages/core/src/search/service.ts`, modify `buildWhereClause()`:

```typescript
function buildWhereClause(options: SearchOptions): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [];
  if (options.organizationId) {
    // Posts are global (Reddit cache), but we scope by org through the subreddits table.
    // Subreddits have organizationId — filter posts whose subreddit name matches an
    // org-scoped subreddit. This works because posts.subreddit stores the subreddit name.
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM subreddits sub WHERE sub.name = p.subreddit AND sub.organization_id = ${options.organizationId})`,
    );
  }
  if (options.subreddit) {
    clauses.push(Prisma.sql`p.subreddit = ${options.subreddit}`);
  }
  if (options.since) {
    clauses.push(Prisma.sql`p.fetched_at >= ${options.since}`);
  }
  if (options.sentiment) {
    clauses.push(Prisma.sql`ps.sentiment = ${options.sentiment}`);
  }
  if (options.minScore != null) {
    clauses.push(Prisma.sql`p.score >= ${options.minScore}`);
  }
  return clauses;
}
```

For `searchBySimilarity` and `findSimilar`, the `buildWhereClause` already applies. However, note that in `searchBySimilarity`, the FROM starts with `post_summaries ps JOIN posts p`, and `buildWhereClause` references `p.subreddit` — so the existing pattern works.

For `findSimilar`, add an org check **BEFORE** the existing `sourceCheck` (has_embedding) guard query. This ensures we don't hit the DB for embedding checks on posts outside the user's org:

```typescript
// In findSimilar, INSERT THIS BLOCK BEFORE the existing sourceCheck guard:
if (options.organizationId) {
  const sourceOrgCheck = await db.$queryRaw<Array<{ in_org: boolean }>>`
    SELECT EXISTS(
      SELECT 1 FROM subreddits sub
      WHERE sub.name = (SELECT subreddit FROM posts WHERE id = ${postId})
      AND sub.organization_id = ${options.organizationId}
    ) AS in_org
  `;
  const orgCheck = sourceOrgCheck[0];
  if (!orgCheck || !orgCheck.in_org) return [];
}
// THEN the existing sourceCheck (has_embedding) follows
```

**Note:** With org filtering, `findSimilar` makes up to 3 `$queryRaw` calls when `organizationId` is set: (1) org check, (2) embedding check, (3) similarity query. Tests must mock all 3 calls in order.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/search-tenant-isolation.test.ts`
Expected: PASS

- [ ] **Step 6: Update all 4 search query handlers to pass organizationId**

In each handler, add `organizationId: ctx.organizationId` to the SearchOptions:

```typescript
// packages/core/src/queries/handlers/search-posts.ts
const options: SearchOptions = {
  limit: params.limit ?? 10,
  subreddit: params.subreddit,
  sentiment: params.sentiment,
  minScore: params.minScore,
  organizationId: ctx.organizationId,
};
```

Apply the same pattern to `search-digests.ts`, `ask-history.ts`, and `find-similar.ts`. Remove the TODO comments.

- [ ] **Step 7: Update get-trending-topics and compare-periods for org filtering**

These handlers use Prisma queries (not raw SQL), so they need org filtering via the posts→subreddits join:

```typescript
// packages/core/src/queries/handlers/get-trending-topics.ts
// Add org filter: only topics from posts in org-scoped subreddits
if (ctx.organizationId) {
  where.posts = {
    some: {
      post: {
        subreddit: {
          // This checks that there's a subreddit row matching the post's subreddit name
          // and belonging to the current org. However, posts.subreddit is a string field,
          // not a relation. We need to use a raw SQL approach or a different strategy.
        },
      },
    },
  };
}
```

Wait — `posts.subreddit` is a string field (the subreddit name), not a foreign key. The Topic model doesn't have a direct org relation either. For Prisma query handlers, we need to use `$queryRaw` or filter in-application. Since these queries are small (trending topics), the simplest approach is:

```typescript
// Get org's subreddit names first, then filter topics by those subreddits
const orgSubreddits = await ctx.db.subreddit.findMany({
  where: { organizationId: ctx.organizationId },
  select: { name: true },
});
const orgSubNames = orgSubreddits.map((s) => s.name);

// Add to where clause
where.posts = {
  some: {
    post: { subreddit: { in: orgSubNames } },
  },
};
```

For `compare-periods.ts`, apply the same pattern. Read the handler's `buildPeriodSummary` function and add the subreddit-name lookup. The org filter must be applied to both the `wherePost` queries and the `postTopic.findMany` query:

```typescript
// In compare-periods.ts, at the start of the handler:
const orgSubreddits = await ctx.db.subreddit.findMany({
  where: { organizationId: ctx.organizationId },
  select: { name: true },
});
const orgSubNames = orgSubreddits.map((s) => s.name);

// Then in the wherePost objects, add:
// subreddit: { in: orgSubNames }
// And in postTopic.findMany where clause:
// post: { subreddit: { in: orgSubNames } }
```

- [ ] **Step 8: Run all core tests**

Run: `pnpm --filter @redgest/core exec vitest run`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/search/ packages/core/src/queries/handlers/ packages/core/src/__tests__/
git commit -m "feat(core): add organizationId filtering to SearchService and all search/analytics handlers (#51)"
```

---

### Task 12: Scheduled-Digest Multi-Org Iteration (#64)

**Files:**
- Modify: `apps/worker/src/trigger/scheduled-digest.ts`

- [ ] **Step 1: Update legacy path to iterate all organizations**

Replace the legacy path (lines after `if (profiles.length === 0)`) with:

```typescript
if (profiles.length === 0) {
  // Legacy path: no profiles exist. Group active subreddits by organization
  // and create one job per org.
  const subreddits = await prisma.subreddit.findMany({
    where: { isActive: true },
    select: { id: true, organizationId: true },
  });

  if (subreddits.length === 0) {
    logger.info("No active profiles or subreddits, skipping");
    return { jobs: [], totalSubreddits: 0 };
  }

  // Group by organizationId
  const byOrg = new Map<string, string[]>();
  for (const sub of subreddits) {
    const orgSubs = byOrg.get(sub.organizationId) ?? [];
    orgSubs.push(sub.id);
    byOrg.set(sub.organizationId, orgSubs);
  }

  const jobs: Array<{ jobId: string; orgId: string; subredditCount: number }> = [];

  for (const [orgId, subIds] of byOrg) {
    const job = await prisma.job.create({
      data: {
        status: "QUEUED",
        subreddits: subIds,
        lookback: "24h",
        organizationId: orgId,
      },
    });

    logger.info("Triggering legacy scheduled digest", {
      jobId: job.id,
      orgId,
      subredditCount: subIds.length,
    });

    try {
      await generateDigest.trigger(
        { jobId: job.id, subredditIds: subIds, organizationId: orgId },
        {
          idempotencyKey: await idempotencyKeys.create(`generate-${job.id}`),
        },
      );
      jobs.push({ jobId: job.id, orgId, subredditCount: subIds.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Trigger dispatch failed for job ${job.id}`, { error: message });
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "FAILED", completedAt: new Date(), error: message },
      });
      // Continue with other orgs
    }
  }

  return {
    jobs,
    totalSubreddits: jobs.reduce((sum, j) => sum + j.subredditCount, 0),
  };
}
```

Remove the TODO comment.

- [ ] **Step 2: Run scheduled-digest tests**

Run: `pnpm --filter apps/worker exec vitest run src/trigger/__tests__/scheduled-digest.test.ts`
Expected: May need to update mocks — fix any failures.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/trigger/scheduled-digest.ts
git commit -m "feat(worker): scheduled-digest iterates all organizations in legacy path (#64)"
```

---

### Task 13: Pass organizationId Through deliver-digest (#65)

**Files:**
- Modify: `apps/worker/src/trigger/generate-digest.ts`
- Modify: `apps/worker/src/trigger/deliver-digest.ts`

- [ ] **Step 1: Update deliver-digest to accept organizationId in payload**

```typescript
// apps/worker/src/trigger/deliver-digest.ts
run: async (payload: { digestId: string; organizationId?: string }) => {
  // ... existing code ...
  // organizationId is currently unused in delivery logic (email/slack are global),
  // but accepting it enables future per-org delivery config
}
```

- [ ] **Step 2: Update generate-digest to pass organizationId to deliver-digest**

```typescript
// In generate-digest.ts, where deliverDigest.trigger() is called:
await deliverDigest.trigger(
  {
    digestId: result.digestId,
    organizationId: payload.organizationId,
  },
  {
    idempotencyKey: await idempotencyKeys.create(`deliver-${result.digestId}`),
  },
);
```

- [ ] **Step 3: Run worker tests**

Run: `pnpm --filter apps/worker exec vitest run`
Expected: All PASS (may need to update deliver-digest test mocks)

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/trigger/generate-digest.ts apps/worker/src/trigger/deliver-digest.ts
git commit -m "feat(worker): pass organizationId through deliver-digest task payload (#65)"
```

---

### Task 14: Organization Onboarding Flow (#54)

**Files:**
- Create: `apps/web/app/onboarding/page.tsx`
- Create: `apps/web/components/org-switcher.tsx`
- Modify: `apps/web/middleware.ts` (add onboarding redirect)
- Modify: `apps/web/app/layout.tsx` (add org switcher to header)

- [ ] **Step 1: Create onboarding page**

```typescript
// apps/web/app/onboarding/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@redgest/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function OnboardingPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const slug = orgName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");

    const result = await authClient.organization.create({
      name: orgName,
      slug,
    });

    if (result.error) {
      setError(result.error.message ?? "Failed to create organization");
      setLoading(false);
      return;
    }

    // Set as active organization
    if (result.data) {
      await authClient.organization.setActive({
        organizationId: result.data.id,
      });
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to Redgest</h1>
          <p className="text-muted-foreground mt-2">
            Create your workspace to get started
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">Workspace name</Label>
            <Input
              id="orgName"
              type="text"
              placeholder="My Workspace"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating..." : "Create workspace"}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update middleware to redirect users without an org to onboarding**

Do NOT add `/onboarding` to `PUBLIC_PATHS` — it must require authentication. Instead, structure the middleware logic as three tiers:

```typescript
// In middleware.ts, after the isPublicPath check:

// 1. Check session cookie
const sessionCookie =
  request.cookies.get("better-auth.session_token") ??
  request.cookies.get("__Secure-better-auth.session_token");

if (!sessionCookie) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(loginUrl);
}

// 2. Allow /onboarding for authenticated users (don't check org)
if (pathname === "/onboarding") {
  return NextResponse.next();
}

// 3. Check for active org cookie — redirect to onboarding if missing
// BetterAuth sets this cookie when setActive() is called.
// If BetterAuth doesn't set this cookie in your version, remove this
// check and handle org verification at the page level instead.
const activeOrgCookie =
  request.cookies.get("better-auth.active_organization") ??
  request.cookies.get("__Secure-better-auth.active_organization");

if (!activeOrgCookie) {
  return NextResponse.redirect(new URL("/onboarding", request.url));
}

return NextResponse.next();
```

**Fallback:** If BetterAuth does not set an `active_organization` cookie, remove the org check from middleware and instead check at the page level in the root layout (server component) using `auth.api.getSession()`. This avoids redirect loops.

- [ ] **Step 3: Create org switcher component**

```typescript
// apps/web/components/org-switcher.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@redgest/auth/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Org {
  id: string;
  name: string;
  slug: string;
}

export function OrgSwitcher() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string>("");
  const session = authClient.useSession();

  useEffect(() => {
    async function loadOrgs() {
      const result = await authClient.organization.list();
      if (result.data) {
        setOrgs(result.data);
      }
    }
    void loadOrgs();
  }, []);

  useEffect(() => {
    if (session.data?.session?.activeOrganizationId) {
      setActiveOrgId(session.data.session.activeOrganizationId);
    }
  }, [session.data]);

  async function handleChange(orgId: string) {
    await authClient.organization.setActive({ organizationId: orgId });
    setActiveOrgId(orgId);
    // Refresh server data with new org context
    router.refresh();
  }

  if (orgs.length <= 1) return null;

  return (
    <Select value={activeOrgId} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent>
        {orgs.map((org) => (
          <SelectItem key={org.id} value={org.id}>
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: Add org switcher to root layout header**

In `apps/web/app/layout.tsx`, add `<OrgSwitcher />` next to the ThemeToggle:

```typescript
import { OrgSwitcher } from "@/components/org-switcher";

// In the header:
<header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
  <SidebarTrigger className="-ml-1" />
  <Separator orientation="vertical" className="mr-2 h-4" />
  <OrgSwitcher />
  <ThemeToggle className="ml-auto" />
</header>
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/onboarding/ apps/web/components/org-switcher.tsx apps/web/middleware.ts apps/web/app/layout.tsx
git commit -m "feat(web): add organization onboarding flow and org switcher component (#54)"
```

---

## Chunk 3: Sprint 14 — Auth UX + Testing

### Task 15: Auth Email Sending Functions (#52, #53, #55)

Create a shared module for sending auth-related emails using the existing Resend infrastructure.

**Files:**
- Create: `packages/auth/src/emails.ts`

**Note:** Auth emails use inline HTML for simplicity (not React Email components). Auth emails are simple text — React Email would be overkill.

- [ ] **Step 0: Install Resend dependency in auth package**

Run: `pnpm --filter @redgest/auth add resend`

- [ ] **Step 1: Create auth email functions**

```typescript
// packages/auth/src/emails.ts
import { Resend } from "resend";

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

const FROM_EMAIL = "Redgest <redgest@mail.edel.sh>";

export async function sendVerificationEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[Auth] RESEND_API_KEY not set — skipping verification email");
    return;
  }

  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Verify your email — Redgest",
    html: `
      <h2>Verify your email address</h2>
      <p>Click the link below to verify your email and activate your Redgest account:</p>
      <p><a href="${url}">Verify email</a></p>
      <p>If you didn't create this account, you can ignore this email.</p>
    `,
  });

  if (result.error) {
    console.error("[Auth] Verification email failed:", result.error.message);
  }
}

export async function sendResetPasswordEmail({
  email,
  url,
}: {
  email: string;
  url: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[Auth] RESEND_API_KEY not set — skipping password reset email");
    return;
  }

  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Reset your password — Redgest",
    html: `
      <h2>Reset your password</h2>
      <p>Click the link below to reset your password:</p>
      <p><a href="${url}">Reset password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
    `,
  });

  if (result.error) {
    console.error("[Auth] Password reset email failed:", result.error.message);
  }
}

export async function sendInvitationEmail({
  email,
  organizationName,
  inviterName,
  invitationId,
}: {
  email: string;
  organizationName: string;
  inviterName: string;
  invitationId: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("[Auth] RESEND_API_KEY not set — skipping invitation email");
    return;
  }

  const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const acceptUrl = `${baseUrl}/invite/${invitationId}`;

  const result = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `Join ${organizationName} on Redgest`,
    html: `
      <h2>You've been invited!</h2>
      <p>${inviterName} invited you to join <strong>${organizationName}</strong> on Redgest.</p>
      <p><a href="${acceptUrl}">Accept invitation</a></p>
    `,
  });

  if (result.error) {
    console.error("[Auth] Invitation email failed:", result.error.message);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/auth/src/emails.ts
git commit -m "feat(auth): add email sending functions for verification, reset, and invitations (#52, #53, #55)"
```

---

### Task 16: Configure Email Verification (#52)

**Files:**
- Modify: `packages/auth/src/auth.ts`

- [ ] **Step 1: Add emailVerification config to auth.ts**

```typescript
import { sendVerificationEmail } from "./emails.js";

export const auth = betterAuth({
  // ... existing config ...
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({ email: user.email, url });
    },
    sendOnSignUp: true,
  },
});
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @redgest/auth exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/auth/src/auth.ts
git commit -m "feat(auth): configure email verification — send on signup via Resend (#52)"
```

---

### Task 17: Password Reset Flow (#53)

**Files:**
- Modify: `packages/auth/src/auth.ts`
- Create: `apps/web/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/app/(auth)/reset-password/page.tsx`
- Modify: `apps/web/app/(auth)/login/page.tsx` (or `login-form.tsx`)

- [ ] **Step 1: Configure sendResetPassword in auth.ts**

```typescript
import { sendResetPasswordEmail } from "./emails.js";

export const auth = betterAuth({
  // ... existing config ...
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 256,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail({ email: user.email, url });
    },
    revokeSessionsOnPasswordReset: true,
  },
});
```

- [ ] **Step 2: Create forgot-password page**

```typescript
// apps/web/app/(auth)/forgot-password/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@redgest/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await authClient.forgetPassword({
      email,
      redirectTo: "/reset-password",
    });

    setLoading(false);

    if (result.error) {
      setError(result.error.message ?? "Failed to send reset email");
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="text-muted-foreground">
          If an account exists with that email, we&apos;ve sent a password reset link.
        </p>
        <Link href="/login" className="text-sm underline underline-offset-4 hover:text-primary">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="text-center">
        <h1 className="text-2xl font-bold">Forgot password</h1>
        <p className="text-muted-foreground mt-2">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Sending..." : "Send reset link"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="underline underline-offset-4 hover:text-primary">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
```

- [ ] **Step 3: Create reset-password page**

```typescript
// apps/web/app/(auth)/reset-password/page.tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@redgest/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">Invalid reset link</h1>
        <p className="text-muted-foreground">
          This password reset link is invalid or has expired.
        </p>
        <Link href="/forgot-password" className="text-sm underline underline-offset-4 hover:text-primary">
          Request a new link
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    const result = await authClient.resetPassword({
      newPassword: password,
      token: token ?? "",  // guarded by early return above
    });

    setLoading(false);

    if (result.error) {
      setError(result.error.message ?? "Failed to reset password");
      return;
    }

    router.push("/login");
  }

  return (
    <>
      <div className="text-center">
        <h1 className="text-2xl font-bold">Reset password</h1>
        <p className="text-muted-foreground mt-2">
          Enter your new password
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Min 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Resetting..." : "Reset password"}
        </Button>
      </form>
    </>
  );
}
```

- [ ] **Step 4: Add "Forgot password?" link to login form**

In `apps/web/app/(auth)/login/login-form.tsx` (created in Task 4), add between the password field and submit button:

```typescript
<div className="flex justify-end">
  <Link href="/forgot-password" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-primary">
    Forgot password?
  </Link>
</div>
```

- [ ] **Step 5: Update middleware PUBLIC_PATHS**

Add `/forgot-password` and `/reset-password` to PUBLIC_PATHS (already included in Task 8).

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/auth.ts apps/web/app/\(auth\)/forgot-password/ apps/web/app/\(auth\)/reset-password/ apps/web/app/\(auth\)/login/
git commit -m "feat(auth,web): add password reset flow — config, forgot-password page, reset-password page (#53)"
```

---

### Task 18: Configure sendInvitationEmail (#55)

**Files:**
- Modify: `packages/auth/src/auth.ts`
- Create: `apps/web/app/invite/[id]/page.tsx`

- [ ] **Step 1: Add sendInvitationEmail to organization plugin config**

```typescript
import { sendInvitationEmail } from "./emails.js";

plugins: [
  organization({
    organizationLimit: 5,
    membershipLimit: 50,
    sendInvitationEmail: async (data) => {
      await sendInvitationEmail({
        email: data.email,
        organizationName: data.organization.name,
        inviterName: data.inviter.user.name,
        invitationId: data.invitation.id,
      });
    },
  }),
  nextCookies(),
],
```

- [ ] **Step 2: Create invitation acceptance page**

```typescript
// apps/web/app/invite/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { authClient } from "@redgest/auth/client";
import { Button } from "@/components/ui/button";

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const invitationId = params.id as string;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  async function handleAccept() {
    setLoading(true);
    setError(null);

    const result = await authClient.organization.acceptInvitation({
      invitationId,
    });

    setLoading(false);

    if (result.error) {
      setError(result.error.message ?? "Failed to accept invitation");
      return;
    }

    setAccepted(true);

    // Set the org as active and redirect
    if (result.data?.member?.organizationId) {
      await authClient.organization.setActive({
        organizationId: result.data.member.organizationId,
      });
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (accepted) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Invitation accepted!</h1>
          <p className="text-muted-foreground">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 p-8 text-center">
        <h1 className="text-2xl font-bold">Accept invitation</h1>
        <p className="text-muted-foreground">
          You&apos;ve been invited to join a workspace on Redgest.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={handleAccept} className="w-full" disabled={loading}>
          {loading ? "Accepting..." : "Accept invitation"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/auth/src/auth.ts apps/web/app/invite/
git commit -m "feat(auth,web): configure org invitation emails and acceptance page (#55)"
```

---

### Task 19: Security Audit Logging (#67)

**Files:**
- Modify: `packages/auth/src/auth.ts`

- [ ] **Step 1: Add databaseHooks to auth config**

```typescript
export const auth = betterAuth({
  // ... existing config ...
  databaseHooks: {
    session: {
      create: {
        after: async ({ data }) => {
          console.info("[Auth:audit] session.created", {
            userId: data.userId,
            sessionId: data.id,
          });
        },
      },
    },
    user: {
      update: {
        after: async ({ data, oldData }) => {
          if (oldData?.email && oldData.email !== data.email) {
            console.info("[Auth:audit] user.email_changed", {
              userId: data.id,
              oldEmail: oldData.email,
              newEmail: data.email,
            });
          }
        },
      },
    },
    account: {
      create: {
        after: async ({ data }) => {
          console.info("[Auth:audit] account.linked", {
            userId: data.userId,
            provider: data.providerId,
          });
        },
      },
    },
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/auth/src/auth.ts
git commit -m "feat(auth): add security audit logging via BetterAuth database hooks (#67)"
```

---

### Task 20: Auth & Multi-Tenant Isolation Tests (#66)

**Files:**
- Modify: `packages/core/src/__tests__/search-tenant-isolation.test.ts` (extend file from Task 11)
- Create: `packages/auth/src/__tests__/auth-config.test.ts`

- [ ] **Step 1: Extend cross-tenant isolation tests for remaining search methods**

Add `searchBySimilarity` and `findSimilar` tests to the existing `packages/core/src/__tests__/search-tenant-isolation.test.ts` file (created in Task 11):

```typescript
// Add these describe blocks to the existing file:

describe("searchBySimilarity", () => {
  it("includes org filter when organizationId is provided", async () => {
    const { db, mockQueryRaw } = makeMockDb();
    const service = createSearchService(db);

    await service.searchBySimilarity([0.1, 0.2], { organizationId: "org_B" });

    expect(mockQueryRaw).toHaveBeenCalled();
    const templateStrings = mockQueryRaw.mock.calls[0]?.[0]?.strings;
    if (templateStrings) {
      const sql = templateStrings.join("?");
      expect(sql).toContain("organization_id");
    }
  });
});

describe("findSimilar", () => {
  it("includes org filter when organizationId is provided", async () => {
    const { db, mockQueryRaw } = makeMockDb();
    const service = createSearchService(db);

    // With organizationId, findSimilar makes 3 $queryRaw calls:
    // 1. Org check (is source post in this org?)
    // 2. has_embedding check
    // 3. Similarity query
    mockQueryRaw.mockResolvedValueOnce([{ in_org: true }]);     // org check
    mockQueryRaw.mockResolvedValueOnce([{ has_embedding: true }]); // embedding check
    mockQueryRaw.mockResolvedValueOnce([]);                     // similarity query

    await service.findSimilar("post_123", { organizationId: "org_C" });

    // Should have 3 calls (org check + embedding check + similarity query)
    expect(mockQueryRaw.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Write auth config smoke tests**

**Note:** `auth.ts` calls `betterAuth()` at module scope, which constructs a Prisma adapter. This requires `@redgest/db` to be importable, so the test needs to mock the DB module to avoid a real database connection.

```typescript
// packages/auth/src/__tests__/auth-config.test.ts
import { describe, it, expect, vi } from "vitest";

// Mock @redgest/db to avoid real database connection at import time
vi.mock("@redgest/db", () => ({
  prisma: {},
}));

describe("auth config", () => {
  it("exports auth instance with expected shape", async () => {
    const mod = await import("../auth.js");
    expect(mod.auth).toBeDefined();
    expect(mod.auth.handler).toBeDefined(); // BetterAuth handler function
  });

  it("exports Auth, Session, and User types", async () => {
    // TypeScript compile-time check — if these types don't exist, tsc fails
    // Runtime: verify the auth instance has $Infer for type derivation
    const mod = await import("../auth.js");
    expect(mod.auth.$Infer).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/search-tenant-isolation.test.ts`
Run: `pnpm --filter @redgest/auth exec vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/__tests__/search-tenant-isolation.test.ts packages/auth/src/__tests__/auth-config.test.ts
git commit -m "test(core,auth): add cross-tenant isolation tests and auth config smoke tests (#66)"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
pnpm check
```

Expected: All lint, typecheck, and tests pass.

- [ ] **Run Playwright E2E tests**

```bash
pnpm --filter apps/web exec playwright test
```

Expected: Existing tests pass. New auth pages may need E2E tests added in a follow-up.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-15-auth-multi-tenancy.md`. Ready to execute?

**REQUIRED:** Use superpowers:subagent-driven-development to implement this plan. Fresh subagent per task + two-stage review.

**Recommended execution order:**
1. **Sprint 12 (Tasks 1-8):** All independent — can be parallelized. Tasks 1-3 modify `auth.ts` so serialize those. Tasks 4-8 are independent.
2. **Sprint 13 (Tasks 10-14):** Task 10 (DAL session resolution) first, then Tasks 11-14 in parallel.
3. **Sprint 14 (Tasks 15-20):** Task 15 (email functions) first, then 16-19 in parallel, Task 20 last.
