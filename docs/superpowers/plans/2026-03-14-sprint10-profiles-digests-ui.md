# Sprint 10: Profiles UI + Digest Browsing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship web UI for digest profiles (CRUD) and digest browsing (list, view, delivery status) — the two highest-impact missing feature areas.

**Architecture:** Follow established WS10 patterns exactly: async Server Components for data loading, client component islands for interactivity, DAL wrappers over CQRS dispatch, Server Actions with Zod validation, `Serialized<T>` types for RSC→client boundary, `useActionToast` for feedback. New `/profiles` and `/digests` routes added to sidebar.

**Tech Stack:** Next.js 16 + React 19, ShadCN/ui, TanStack React Table, Tailwind v4, Zod 4, `@redgest/core` CQRS, `@redgest/db` Prisma types.

**Vercel React Best Practices:**
- `async-parallel` — Promise.all for independent queries in page RSCs
- `server-serialization` — Serialize only what client components need
- `async-suspense-boundaries` — Not needed (pages are simple enough for single RSC fetch)
- `bundle-barrel-imports` — Import directly from `@redgest/db`, `@redgest/core`

---

## Chunk 1: DAL + Types + Server Actions (WS14 + WS15)

### File Structure

```
apps/web/
├── lib/
│   ├── dal.ts              # MODIFY — add profile + digest DAL wrappers
│   ├── types.ts            # MODIFY — add SerializedProfile, SerializedDigest, ProfileOptimisticAction
│   └── actions.ts          # MODIFY — add profile + digest Server Actions
```

### Task 1: Profile + Digest Serialized Types

**Files:**
- Modify: `apps/web/lib/types.ts`

- [ ] **Step 1: Add SerializedProfile type and serializer**

```typescript
import type { Config, SubredditView, RunView, DigestView, ProfileView } from "@redgest/db";

// ... existing Serialized<T> type and serializers ...

export type SerializedProfile = Serialized<ProfileView>;

export function serializeProfile(profile: ProfileView): SerializedProfile {
  return {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}
```

Note: `ProfileView.subredditList` is `JsonValue` (already serializable). `ProfileView.delivery` is `string` (already serializable).

- [ ] **Step 2: Add ProfileOptimisticAction type**

```typescript
export type ProfileOptimisticAction =
  | { type: "add"; profile: SerializedProfile }
  | { type: "remove"; id: string }
  | { type: "update"; id: string; changes: Partial<SerializedProfile> };
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm turbo typecheck --filter=@redgest/web`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/types.ts
git commit -m "feat(web): add SerializedProfile type and ProfileOptimisticAction"
```

---

### Task 2: DAL Wrappers — Profiles, Delivery, Cancel

**Files:**
- Modify: `apps/web/lib/dal.ts`

**Note:** `listDigests`, `getDigest`, `getDigestByJobId`, `listRuns`, and `getRunStatus` already exist in dal.ts. Do NOT re-add them. Only add the functions listed below.

**Also modify:** The existing `listDigests` function to accept an optional `cursor` parameter:
```typescript
// MODIFY existing function (currently only accepts limit)
export async function listDigests(
  limit?: number,
  cursor?: string,  // ADD this parameter
): Promise<QueryResultMap["ListDigests"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("ListDigests", { limit, cursor }, queryCtx);
}
```

- [ ] **Step 1: Add new DAL wrappers (profiles + delivery + cancel only)**

Add to existing imports in dal.ts:
```typescript
import type { CommandMap, CommandResultMap, QueryResultMap } from "@redgest/core";
```

Add these NEW functions after the existing command wrappers:

```typescript
// --- Profile queries (NEW) ---

export async function listProfiles(): Promise<QueryResultMap["ListProfiles"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("ListProfiles", EMPTY_PARAMS, queryCtx);
}

export async function getProfile(
  profileId: string,
): Promise<QueryResultMap["GetProfile"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetProfile", { profileId }, queryCtx);
}

// --- Delivery queries (NEW) ---

export async function getDeliveryStatus(
  digestId?: string,
  limit?: number,
): Promise<QueryResultMap["GetDeliveryStatus"]> {
  const { query, queryCtx } = await getBootstrap();
  return query("GetDeliveryStatus", { digestId, limit }, queryCtx);
}

// --- Profile commands (NEW) ---

export async function createProfile(
  params: CommandMap["CreateProfile"],
): Promise<CommandResultMap["CreateProfile"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("CreateProfile", params, executeCtx);
}

export async function updateProfile(
  params: CommandMap["UpdateProfile"],
): Promise<CommandResultMap["UpdateProfile"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("UpdateProfile", params, executeCtx);
}

export async function deleteProfile(
  profileId: string,
): Promise<CommandResultMap["DeleteProfile"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("DeleteProfile", { profileId }, executeCtx);
}

// --- Run commands ---

export async function cancelRun(
  jobId: string,
): Promise<CommandResultMap["CancelRun"]> {
  const { execute, executeCtx } = await getBootstrap();
  return execute("CancelRun", { jobId }, executeCtx);
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm turbo typecheck --filter=@redgest/web`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/dal.ts
git commit -m "feat(web): add DAL wrappers for profiles, digests, delivery, cancelRun"
```

---

### Task 3: Profile Server Actions

**Files:**
- Modify: `apps/web/lib/actions.ts`

- [ ] **Step 1: Add profile Zod schemas**

```typescript
import { DeliveryChannel } from "@redgest/db";
import { serializeDigest, serializeRun, serializeProfile, type ActionResult } from "@/lib/types";

const createProfileSchema = z.object({
  name: z.string().min(1),
  insightPrompt: z.string().optional(),
  schedule: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().nullable().optional(),
  ),
  lookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  maxPosts: z.coerce.number().int().min(1).max(100).optional(),
  delivery: z.enum(
    Object.values(DeliveryChannel) as [DeliveryChannel, ...DeliveryChannel[]],
  ).optional(),
  subredditIds: z.array(z.string()).optional(),
});

const updateProfileSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1).optional(),
  insightPrompt: z.string().optional(),
  schedule: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().nullable().optional(),
  ),
  lookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  maxPosts: z.coerce.number().int().min(1).max(100).optional(),
  delivery: z.enum(
    Object.values(DeliveryChannel) as [DeliveryChannel, ...DeliveryChannel[]],
  ).optional(),
  subredditIds: z.array(z.string()).optional(),
  active: formDataBoolean.optional(),
});

const deleteProfileSchema = z.object({
  profileId: z.string().min(1),
});

const cancelRunSchema = z.object({
  jobId: z.string().min(1),
});
```

- [ ] **Step 2: Add profile Server Action functions**

```typescript
export async function createProfileAction(
  _prevState: ActionResult<{ profileId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ profileId: string }>> {
  const raw = Object.fromEntries(formData.entries());
  const subredditIds = typeof raw.subredditIds === "string" && raw.subredditIds
    ? raw.subredditIds.split(",")
    : undefined;
  const parsed = createProfileSchema.safeParse({ ...raw, subredditIds });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.createProfile(parsed.data);
    revalidatePath("/profiles");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function updateProfileAction(
  _prevState: ActionResult<{ profileId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ profileId: string }>> {
  const raw = Object.fromEntries(formData.entries());
  const subredditIds = typeof raw.subredditIds === "string" && raw.subredditIds
    ? raw.subredditIds.split(",")
    : undefined;
  const parsed = updateProfileSchema.safeParse({ ...raw, subredditIds });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.updateProfile(parsed.data);
    revalidatePath("/profiles");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function deleteProfileAction(
  _prevState: ActionResult<{ profileId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ profileId: string }>> {
  const parsed = deleteProfileSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.deleteProfile(parsed.data.profileId);
    revalidatePath("/profiles");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function cancelRunAction(
  _prevState: ActionResult<{ jobId: string; status: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jobId: string; status: string }>> {
  const parsed = cancelRunSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const result = await dal.cancelRun(parsed.data.jobId);
    revalidatePath("/history");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
```

- [ ] **Step 3: Add query actions for client-side fetching**

```typescript
export async function fetchProfiles() {
  const profiles = await dal.listProfiles();
  return profiles.map(serializeProfile);
}

export async function fetchDigests(limit?: number) {
  const result = await dal.listDigests(limit);
  return {
    items: result.items.map(serializeDigest),
    nextCursor: result.nextCursor,
  };
}

export async function fetchDeliveryStatus(digestId: string) {
  return dal.getDeliveryStatus(digestId);
}
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm turbo typecheck --filter=@redgest/web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions.ts
git commit -m "feat(web): add Server Actions for profiles, digests, cancelRun"
```

---

## Chunk 2: Profiles Page (WS14)

### File Structure

```
apps/web/
├── app/
│   └── profiles/
│       └── page.tsx            # CREATE — async Server Component
├── components/
│   ├── profile-table.tsx       # CREATE — client component with useOptimistic
│   ├── profile-dialog.tsx      # CREATE — create/edit dialog
│   └── delete-profile-dialog.tsx # CREATE — delete confirmation
│   └── app-sidebar.tsx         # MODIFY — add Profiles nav item
```

### Task 4: Update Sidebar Navigation

**Files:**
- Modify: `apps/web/components/app-sidebar.tsx`

- [ ] **Step 1: Add Profiles nav item**

Add `Layers` icon import and Profiles entry to `NAV_ITEMS`:

```typescript
import { Rss, Settings, Clock, Play, Layers } from "lucide-react";

const NAV_ITEMS = [
  { title: "Subreddits", href: "/subreddits", icon: Rss },
  { title: "Profiles", href: "/profiles", icon: Layers },
  { title: "Settings", href: "/settings", icon: Settings },
  { title: "History", href: "/history", icon: Clock },
  { title: "Trigger", href: "/trigger", icon: Play },
] as const;
```

- [ ] **Step 2: Verify it renders**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/subreddits`
Expected: 200

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/app-sidebar.tsx
git commit -m "feat(web): add Profiles to sidebar navigation"
```

---

### Task 5: Profiles Page (RSC)

**Files:**
- Create: `apps/web/app/profiles/page.tsx`

- [ ] **Step 1: Create the async Server Component**

```typescript
import { listProfiles, listSubreddits } from "@/lib/dal";
import { serializeProfile, serializeSubreddit } from "@/lib/types";
import { ProfileTable } from "@/components/profile-table";

export default async function ProfilesPage() {
  const [profiles, subreddits] = await Promise.all([
    listProfiles(),
    listSubreddits(),
  ]);
  const serializedProfiles = profiles.map(serializeProfile);
  const serializedSubreddits = subreddits.map(serializeSubreddit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Profiles
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage digest profiles — group subreddits with schedule, delivery, and post limits
        </p>
      </div>
      <ProfileTable
        profiles={serializedProfiles}
        subreddits={serializedSubreddits}
      />
    </div>
  );
}
```

Key: `Promise.all` for parallel fetch (async-parallel rule). Both profiles and subreddits needed — subreddits for the create/edit dialog multi-select.

- [ ] **Step 2: Verify page loads**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/profiles`
Expected: 200 (or 500 if ProfileTable not yet created — that's fine, we'll create it next)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/profiles/page.tsx
git commit -m "feat(web): add Profiles page RSC with parallel data loading"
```

---

### Task 6: Profile Table Component

**Files:**
- Create: `apps/web/components/profile-table.tsx`

- [ ] **Step 1: Create the ProfileTable client component**

Pattern: Mirror `subreddit-table.tsx` — `useOptimistic`, add/edit/delete dialogs via state.

```typescript
"use client";

import { useOptimistic, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type {
  SerializedProfile, SerializedSubreddit, ProfileOptimisticAction,
} from "@/lib/types";
import { ProfileDialog } from "@/components/profile-dialog";
import { DeleteProfileDialog } from "@/components/delete-profile-dialog";

interface ProfileTableProps {
  profiles: SerializedProfile[];
  subreddits: SerializedSubreddit[];
}

export function ProfileTable({ profiles, subreddits }: ProfileTableProps) {
  const [optimisticProfiles, dispatchOptimistic] = useOptimistic(
    profiles,
    (state: SerializedProfile[], action: ProfileOptimisticAction) => {
      switch (action.type) {
        case "add":
          return [...state, action.profile];
        case "remove":
          return state.filter((p) => p.profileId !== action.id);
        case "update":
          return state.map((p) =>
            p.profileId === action.id ? { ...p, ...action.changes } : p,
          );
      }
    },
  );

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<SerializedProfile | null>(null);
  const [deleteProfile, setDeleteProfile] = useState<SerializedProfile | null>(null);

  // Parse subredditList JSON for display
  function getSubredditNames(profile: SerializedProfile): string[] {
    if (!Array.isArray(profile.subredditList)) return [];
    return (profile.subredditList as Array<{ name?: string }>)
      .map((s) => s.name)
      .filter((n): n is string => !!n);
  }

  return (
    <>
      {optimisticProfiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <p className="text-sm text-muted-foreground">
            No profiles configured yet
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-1.5 size-4" />
            Create your first profile
          </Button>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="mr-1.5 size-4" />
              Create Profile
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subreddits</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Max Posts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optimisticProfiles.map((profile) => (
                <TableRow key={profile.profileId}>
                  <TableCell className="font-mono font-medium">
                    {profile.name}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <span className="text-sm text-muted-foreground">
                      {profile.subredditCount === 0
                        ? "\u2014"
                        : getSubredditNames(profile).map((n) => `r/${n}`).join(", ")}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {profile.schedule ?? "\u2014"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{profile.delivery}</Badge>
                  </TableCell>
                  <TableCell>{profile.maxPosts}</TableCell>
                  <TableCell>
                    <Badge variant={profile.isActive ? "default" : "secondary"}>
                      {profile.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setEditProfile(profile)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">Edit {profile.name}</span>
                      </Button>
                      {profile.name !== "Default" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteProfile(profile)}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Delete {profile.name}</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {addDialogOpen && (
        <ProfileDialog
          mode="add"
          open={true}
          onOpenChange={(o) => { if (!o) setAddDialogOpen(false); }}
          onOptimistic={dispatchOptimistic}
          subreddits={subreddits}
        />
      )}

      {editProfile && (
        <ProfileDialog
          mode="edit"
          profile={editProfile}
          open={true}
          onOpenChange={(open) => { if (!open) setEditProfile(null); }}
          onOptimistic={dispatchOptimistic}
          subreddits={subreddits}
        />
      )}

      {deleteProfile && (
        <DeleteProfileDialog
          profile={deleteProfile}
          open={true}
          onOpenChange={(open) => { if (!open) setDeleteProfile(null); }}
          onOptimistic={dispatchOptimistic}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/profile-table.tsx
git commit -m "feat(web): add ProfileTable component with useOptimistic"
```

---

### Task 7: Profile Dialog (Create/Edit)

**Files:**
- Create: `apps/web/components/profile-dialog.tsx`

- [ ] **Step 1: Create ProfileDialog component**

Pattern: Mirror `subreddit-dialog.tsx`. Uses `useActionState` + `useActionToast`. Multi-select for subreddits via checkboxes.

Key fields: name, insightPrompt (textarea), schedule (cron input), lookbackHours, maxPosts, delivery (select), subreddits (multi-checkbox), active (edit only).

The form must pass `subredditIds` as comma-separated hidden field (same pattern as DigestTriggerForm).

Component should handle both "add" and "edit" modes via discriminated union props:
```typescript
type ProfileDialogProps =
  | { mode: "add"; profile?: undefined; ... }
  | { mode: "edit"; profile: SerializedProfile; ... }
```

Form fields: name, insightPrompt, schedule, lookbackHours, maxPosts, delivery (Select with NONE/EMAIL/SLACK/ALL), subredditIds (checkboxes from subreddits prop), active (checkbox, edit only).

Uses `createProfileAction` for add, `updateProfileAction` for edit. Hidden `profileId` field in edit mode.

- [ ] **Step 2: Verify compile**

Run: `pnpm turbo typecheck --filter=@redgest/web`

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/profile-dialog.tsx
git commit -m "feat(web): add ProfileDialog for create/edit profiles"
```

---

### Task 8: Delete Profile Dialog

**Files:**
- Create: `apps/web/components/delete-profile-dialog.tsx`

- [ ] **Step 1: Create DeleteProfileDialog component**

Pattern: Mirror `delete-subreddit-dialog.tsx`. Confirmation dialog with profile name. Uses `deleteProfileAction`. Cannot delete "Default" profile (button hidden in table, but also guard in dialog).

- [ ] **Step 2: Verify profiles page loads end-to-end**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/profiles`
Expected: 200

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/delete-profile-dialog.tsx
git commit -m "feat(web): add DeleteProfileDialog component"
```

---

### Task 9: Update Trigger Page — Profile Selection

**Files:**
- Modify: `apps/web/app/trigger/page.tsx`
- Modify: `apps/web/components/digest-trigger-form.tsx`

- [ ] **Step 1: Load profiles in trigger page RSC**

Update `trigger/page.tsx` to also fetch profiles:

```typescript
import { listSubreddits, getConfig, listProfiles } from "@/lib/dal";
import { serializeSubreddit, serializeProfile } from "@/lib/types";
// ...
const [subreddits, config, profiles] = await Promise.all([
  listSubreddits(),
  getConfig(),
  listProfiles(),
]);
// Pass serialized profiles to DigestTriggerForm
```

- [ ] **Step 2: Add profile dropdown to DigestTriggerForm**

Add a `Select` before the subreddit checkboxes. When a profile is selected, pre-fill:
- `selectedIds` — set to the profile's subreddit IDs
- `lookbackHours` — set to profile's lookbackHours
- Add hidden `profileId` field to form

"Custom" option leaves current manual selection intact.

- [ ] **Step 3: Update generateDigestAction to accept profileId**

Add `profileId` to `generateDigestSchema`:
```typescript
const generateDigestSchema = z.object({
  subredditIds: z.array(z.string()).optional(),
  lookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  profileId: z.string().optional(),
});
```

Pass `profileId` to `dal.generateDigest(parsed.data)`.

- [ ] **Step 4: Verify trigger page loads with profile dropdown**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/trigger`
Expected: 200

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/trigger/page.tsx apps/web/components/digest-trigger-form.tsx apps/web/lib/actions.ts
git commit -m "feat(web): add profile selection to trigger page"
```

---

## Chunk 3: Digests Page (WS15)

### File Structure

```
apps/web/
├── app/
│   └── digests/
│       └── page.tsx            # CREATE — async Server Component
├── components/
│   ├── digest-table.tsx        # CREATE — digest list with expandable rows
│   ├── digest-content.tsx      # CREATE — rendered markdown viewer
│   └── delivery-badges.tsx     # CREATE — delivery status indicators
│   └── app-sidebar.tsx         # MODIFY — add Digests nav item
```

### Task 10: Add Digests to Sidebar

**Files:**
- Modify: `apps/web/components/app-sidebar.tsx`

- [ ] **Step 1: Add Digests nav item**

```typescript
import { Rss, Settings, Clock, Play, Layers, BookOpen } from "lucide-react";

const NAV_ITEMS = [
  { title: "Subreddits", href: "/subreddits", icon: Rss },
  { title: "Profiles", href: "/profiles", icon: Layers },
  { title: "Digests", href: "/digests", icon: BookOpen },
  { title: "Settings", href: "/settings", icon: Settings },
  { title: "History", href: "/history", icon: Clock },
  { title: "Trigger", href: "/trigger", icon: Play },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/app-sidebar.tsx
git commit -m "feat(web): add Digests to sidebar navigation"
```

---

### Task 11: Delivery Badges Component

**Files:**
- Create: `apps/web/components/delivery-badges.tsx`

- [ ] **Step 1: Create DeliveryBadges component**

Small presentational component that renders delivery status badges. Used in both digest table and history detail panel.

```typescript
import { Badge } from "@/components/ui/badge";
import type { DeliveryStatusChannel } from "@redgest/core";

interface DeliveryBadgesProps {
  channels: DeliveryStatusChannel[];
}

export function DeliveryBadges({ channels }: DeliveryBadgesProps) {
  if (channels.length === 0) return <span className="text-muted-foreground">\u2014</span>;

  return (
    <div className="flex gap-1">
      {channels.map((ch) => (
        <Badge
          key={ch.channel}
          variant={
            ch.status === "SENT" ? "default" :
            ch.status === "FAILED" ? "destructive" :
            "secondary"
          }
        >
          {ch.channel} {ch.status.toLowerCase()}
        </Badge>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/delivery-badges.tsx
git commit -m "feat(web): add DeliveryBadges component"
```

---

### Task 12: Digest Content Viewer

**Files:**
- Create: `apps/web/components/digest-content.tsx`

- [ ] **Step 1: Create DigestContent component**

Renders markdown content from a digest. Uses `react-markdown` (already in deps).

```typescript
"use client";

import Markdown from "react-markdown";

interface DigestContentProps {
  markdown: string;
}

export function DigestContent({ markdown }: DigestContentProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <Markdown>{markdown}</Markdown>
    </div>
  );
}
```

Note: `RunDetailPanel` already has inline markdown rendering — consider refactoring it to use `DigestContent` as a follow-up to avoid duplication.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/digest-content.tsx
git commit -m "feat(web): add DigestContent markdown viewer"
```

---

### Task 13: Digest Table Component

**Files:**
- Create: `apps/web/components/digest-table.tsx`

- [ ] **Step 1: Create DigestTable client component**

Collapsible rows pattern — click a row to expand and show rendered markdown + delivery status. Uses TanStack React Table or simple expand state.

Key columns: date (createdAt), post count, subreddits, status (jobStatus), delivery badges. Expanded section shows DigestContent + DeliveryBadges.

Fetches delivery status on demand when row is expanded (via `fetchDeliveryStatus` query action).

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/digest-table.tsx
git commit -m "feat(web): add DigestTable with expandable content rows"
```

---

### Task 14: Digests Page (RSC)

**Files:**
- Create: `apps/web/app/digests/page.tsx`

- [ ] **Step 1: Create the async Server Component**

```typescript
import { listDigests } from "@/lib/dal";
import { serializeDigest } from "@/lib/types";
import { DigestTable } from "@/components/digest-table";

export default async function DigestsPage() {
  const result = await listDigests(20);
  const serialized = result.items.map(serializeDigest);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Digests
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse generated digests, view content, and check delivery status
        </p>
      </div>
      <DigestTable digests={serialized} />
    </div>
  );
}
```

- [ ] **Step 2: Verify digests page loads**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/digests`
Expected: 200

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/digests/page.tsx
git commit -m "feat(web): add Digests page RSC"
```

---

### Task 15: Enhanced History Page — Cancel Button

**Files:**
- Modify: `apps/web/components/run-detail-panel.tsx`

- [ ] **Step 1: Read the existing RunDetailPanel**

Read `apps/web/components/run-detail-panel.tsx` to understand its current structure.

- [ ] **Step 2: Add cancel button for in-progress runs**

Add a "Cancel Run" button that appears when `run.status === "RUNNING" || run.status === "QUEUED"`. Uses `cancelRunAction` Server Action via form submission.

- [ ] **Step 3: Add link to digest from completed runs**

When a run is COMPLETED, add a "View Digest" link that navigates to `/digests` (or opens the digest inline if digestId is available).

- [ ] **Step 4: Verify history page still works**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/history`
Expected: 200

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/run-detail-panel.tsx
git commit -m "feat(web): add cancel button and digest link to run detail panel"
```

---

## Chunk 4: Playwright Tests + Final Verification

### Task 16: Update Playwright Smoke Tests

**Files:**
- Modify: `apps/web/tests/smoke.spec.ts`
- Modify: `apps/web/tests/interactions.spec.ts`

- [ ] **Step 1: Add Profiles page smoke tests**

```typescript
test.describe("Profiles Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/profiles");
    await expect(
      page.getByRole("heading", { name: "Profiles" }),
    ).toBeVisible();
    await expect(
      page.getByText("Manage digest profiles"),
    ).toBeVisible();
  });
});
```

- [ ] **Step 2: Add Digests page smoke tests**

```typescript
test.describe("Digests Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/digests");
    await expect(
      page.getByRole("heading", { name: "Digests" }),
    ).toBeVisible();
    await expect(
      page.getByText("Browse generated digests"),
    ).toBeVisible();
  });
});
```

- [ ] **Step 3: Update navigation test to include new pages**

Update the "can navigate to all pages via sidebar" test to also navigate to `/profiles` and `/digests`.

- [ ] **Step 4: Add Profiles interaction tests**

Test: table or empty state renders, "Create Profile" button exists, Default profile cannot be deleted.

- [ ] **Step 5: Run all Playwright tests**

Run: `cd apps/web && npx playwright test --reporter=list`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/tests/
git commit -m "test(web): add Playwright tests for Profiles and Digests pages"
```

---

### Task 17: Full Verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm turbo typecheck`
Expected: PASS across all packages

- [ ] **Step 2: Run lint**

Run: `pnpm turbo lint`
Expected: PASS

- [ ] **Step 3: Run all unit tests**

Run: `pnpm turbo test`
Expected: All 577+ tests pass

- [ ] **Step 4: Run Playwright tests**

Run: `cd apps/web && npx playwright test --reporter=list`
Expected: All tests pass

- [ ] **Step 5: Manual smoke test in browser**

Navigate to:
1. `/profiles` — should show Default profile in table
2. Create a new profile with 2 subreddits
3. Edit the profile
4. `/digests` — should show any previously generated digests
5. Expand a digest to view content
6. `/trigger` — should show profile dropdown
7. `/history` — run detail should show cancel button for active runs

---

## Implementation Notes

### Patterns to Follow (from WS10)

| Pattern | Where to Look |
|---------|---------------|
| Async RSC + client island | `app/subreddits/page.tsx` + `components/subreddit-table.tsx` |
| `useOptimistic` for CRUD tables | `components/subreddit-table.tsx` |
| `useActionState` + `useActionToast` | `components/settings-form.tsx`, `components/subreddit-dialog.tsx` |
| Server Action + Zod validation | `lib/actions.ts` — all 5 existing actions |
| `Serialized<T>` type + serializer | `lib/types.ts` — 4 existing serializers |
| Dialog pattern (add/edit modes) | `components/subreddit-dialog.tsx` |
| Delete confirmation dialog | `components/delete-subreddit-dialog.tsx` |
| DAL wrapper pattern | `lib/dal.ts` — getBootstrap() singleton |
| Hidden form fields for arrays | `components/digest-trigger-form.tsx` — subredditIds |

### Key Gotchas

1. `ProfileView.subredditList` is `JsonValue` — cast to `Array<{ id: string; name: string }>` for display
2. `ProfileView.delivery` is `string` (not enum) — comes from the SQL view's `::text` cast
3. Cannot delete "Default" profile — guard in both UI (hide button) and backend (handler throws)
4. `DeliveryStatusResult.digests[].channels` has the delivery info — not the digest itself
5. `react-markdown` is already in deps — no need to install
6. Existing `DigestView` has `contentMarkdown` field for rendered digest content
