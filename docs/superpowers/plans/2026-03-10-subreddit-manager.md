# Subreddit Manager Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Subreddit Manager CRUD page — list, add, edit, and remove subreddits with optimistic updates.

**Architecture:** Async Server Component root fetches data via DAL, passes serialized props to client components. Dialogs handle mutations via `useActionState` with existing Server Actions. `useOptimistic` provides instant UI feedback.

**Tech Stack:** Next.js 16, React 19, ShadCN/ui (Dialog, Table, Badge, Button, Input, Textarea, Label, Tooltip, Sonner), Tailwind v4, TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-03-10-subreddit-manager-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/web/lib/types.ts` | Create | `SerializedSubreddit` type, `serializeSubreddit()` helper, `ActionResult` type |
| `apps/web/app/subreddits/page.tsx` | Modify | Async Server Component — fetch, serialize, render table |
| `apps/web/components/subreddit-table.tsx` | Create | Client table with optimistic state, empty state, dialog triggers |
| `apps/web/components/subreddit-dialog.tsx` | Create | Add/edit form dialog |
| `apps/web/components/delete-subreddit-dialog.tsx` | Create | Remove confirmation dialog |

**Existing files used (no changes needed):**
- `apps/web/lib/dal.ts` — `listSubreddits()`, `addSubreddit()`, etc.
- `apps/web/lib/actions.ts` — `addSubredditAction`, `updateSubredditAction`, `removeSubredditAction`
- `apps/web/components/ui/*` — ShadCN components (Dialog, Table, Badge, Button, Input, Textarea, Label, Tooltip, Sonner)

---

## Chunk 1: Types + Server Component

### Task 1: Create SerializedSubreddit type

**Files:**
- Create: `apps/web/lib/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// apps/web/lib/types.ts
import type { SubredditView } from "@redgest/db";

/**
 * SubredditView with Date fields converted to ISO strings
 * for crossing the RSC → client component boundary.
 */
export type SerializedSubreddit = {
  [K in keyof SubredditView]: SubredditView[K] extends Date
    ? string
    : SubredditView[K] extends Date | null
      ? string | null
      : SubredditView[K];
};

export function serializeSubreddit(sub: SubredditView): SerializedSubreddit {
  return {
    ...sub,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    lastDigestDate: sub.lastDigestDate?.toISOString() ?? null,
  };
}

/** Shared action result type — matches Server Action return shapes in actions.ts */
export type ActionResult<T = { subredditId: string }> =
  | { ok: true; data: T }
  | { ok: false; error: string }
  | null;
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @redgest/web exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/types.ts
git commit -m "feat(web): add SerializedSubreddit type for RSC boundary"
```

---

### Task 2: Implement the Subreddits page Server Component

**Files:**
- Modify: `apps/web/app/subreddits/page.tsx`

**Docs to check:**
- `apps/web/lib/dal.ts` — `listSubreddits()` returns `SubredditView[]`
- Next.js 16: async Server Components fetch data directly, no `use()` needed

- [ ] **Step 1: Replace placeholder with async Server Component**

```tsx
// apps/web/app/subreddits/page.tsx
import { listSubreddits } from "@/lib/dal";
import { serializeSubreddit } from "@/lib/types";
import { SubredditTable } from "@/components/subreddit-table";

export default async function SubredditsPage() {
  const subreddits = await listSubreddits();
  const serialized = subreddits.map(serializeSubreddit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Subreddits
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your monitored subreddits and insight prompts
        </p>
      </div>
      <SubredditTable subreddits={serialized} />
    </div>
  );
}
```

Note: This will not compile yet because `SubredditTable` doesn't exist. That's expected — we create it in Task 3.

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/subreddits/page.tsx
git commit -m "feat(web): wire subreddits page as async Server Component"
```

---

## Chunk 2: SubredditTable (client component)

### Task 3: Build the SubredditTable component

**Files:**
- Create: `apps/web/components/subreddit-table.tsx`

**Docs to check:**
- ShadCN Table: `apps/web/components/ui/table.tsx` — exports `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`
- ShadCN Badge: `apps/web/components/ui/badge.tsx`
- ShadCN Button: `apps/web/components/ui/button.tsx`
- ShadCN Tooltip: `apps/web/components/ui/tooltip.tsx`
- `lucide-react` icons: `Pencil`, `Trash2`, `Plus`

- [ ] **Step 1: Create the table component with optimistic state**

```tsx
// apps/web/components/subreddit-table.tsx
"use client";

import { useOptimistic, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SerializedSubreddit } from "@/lib/types";
import { SubredditDialog } from "@/components/subreddit-dialog";
import { DeleteSubredditDialog } from "@/components/delete-subreddit-dialog";

export type OptimisticAction =
  | { type: "add"; subreddit: SerializedSubreddit }
  | { type: "remove"; id: string }
  | { type: "update"; id: string; changes: Partial<SerializedSubreddit> };

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
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

interface SubredditTableProps {
  subreddits: SerializedSubreddit[];
}

export function SubredditTable({ subreddits }: SubredditTableProps) {
  const [optimisticSubs, dispatchOptimistic] = useOptimistic(
    subreddits,
    (state: SerializedSubreddit[], action: OptimisticAction) => {
      switch (action.type) {
        case "add":
          return [...state, action.subreddit];
        case "remove":
          return state.filter((s) => s.id !== action.id);
        case "update":
          return state.map((s) =>
            s.id === action.id ? { ...s, ...action.changes } : s,
          );
      }
    },
  );

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editSub, setEditSub] = useState<SerializedSubreddit | null>(null);
  const [deleteSub, setDeleteSub] = useState<SerializedSubreddit | null>(null);

  return (
    <>
      {optimisticSubs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <p className="text-sm text-muted-foreground">
            No subreddits configured yet
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="mr-1.5 size-4" />
            Add your first subreddit
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
              Add Subreddit
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Insight Prompt</TableHead>
                <TableHead>Max Posts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Digest</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optimisticSubs.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-mono">r/{sub.name}</TableCell>
                  <TableCell className="max-w-[200px]">
                    {sub.insightPrompt ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate cursor-default">
                            {sub.insightPrompt}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          className="max-w-sm whitespace-pre-wrap"
                        >
                          {sub.insightPrompt}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{sub.maxPosts}</TableCell>
                  <TableCell>
                    <Badge variant={sub.isActive ? "default" : "secondary"}>
                      {sub.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(sub.lastDigestDate)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => setEditSub(sub)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">Edit {sub.name}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteSub(sub)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Delete {sub.name}</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <SubredditDialog
        mode="add"
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onOptimistic={dispatchOptimistic}
      />

      {editSub && (
        <SubredditDialog
          mode="edit"
          subreddit={editSub}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditSub(null);
          }}
          onOptimistic={dispatchOptimistic}
        />
      )}

      {deleteSub && (
        <DeleteSubredditDialog
          subreddit={deleteSub}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteSub(null);
          }}
          onOptimistic={dispatchOptimistic}
        />
      )}
    </>
  );
}
```

Note: This will not compile yet — `SubredditDialog` and `DeleteSubredditDialog` are created in Tasks 4 and 5. That's expected.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/subreddit-table.tsx
git commit -m "feat(web): add SubredditTable with optimistic updates"
```

---

## Chunk 3: Dialogs

### Task 4: Build the SubredditDialog (add/edit)

**Files:**
- Create: `apps/web/components/subreddit-dialog.tsx`

**Docs to check:**
- `apps/web/lib/actions.ts` — `addSubredditAction` expects `FormData` with `name`, `displayName`, `insightPrompt`, `maxPosts`, `nsfw`. `updateSubredditAction` expects `subredditId`, `insightPrompt`, `maxPosts`, `active`.
- React 19: `useActionState(action, initialState)` returns `[state, formAction, isPending]`
- The `addSubredditSchema` in `actions.ts` requires `displayName` — pass `name` value as `displayName` via hidden input since the DB handler ignores it.

- [ ] **Step 1: Create the dialog component**

```tsx
// apps/web/components/subreddit-dialog.tsx
"use client";

import { useActionState, useEffect, startTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addSubredditAction,
  updateSubredditAction,
} from "@/lib/actions";
import type { SerializedSubreddit, ActionResult } from "@/lib/types";
import type { OptimisticAction } from "@/components/subreddit-table";

interface SubredditDialogProps {
  mode: "add" | "edit";
  subreddit?: SerializedSubreddit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimistic: (action: OptimisticAction) => void;
}

function stripSubredditPrefix(name: string): string {
  return name.replace(/^r\//, "").trim();
}

export function SubredditDialog({
  mode,
  subreddit,
  open,
  onOpenChange,
  onOptimistic,
}: SubredditDialogProps) {
  const action = mode === "add" ? addSubredditAction : updateSubredditAction;
  const [state, formAction, isPending] = useActionState<ActionResult<{ subredditId: string }>, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(mode === "add" ? "Subreddit added" : "Subreddit updated");
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, mode, onOpenChange]);

  function handleSubmit(formData: FormData) {
    if (mode === "add") {
      const name = stripSubredditPrefix(formData.get("name") as string);
      formData.set("name", name);
      formData.set("displayName", name);

      const now = new Date().toISOString();
      startTransition(() => {
        onOptimistic({
          type: "add",
          subreddit: {
            id: crypto.randomUUID(),
            name,
            insightPrompt: (formData.get("insightPrompt") as string) || null,
            maxPosts: Number(formData.get("maxPosts")) || 5,
            includeNsfw: formData.get("nsfw") === "on",
            isActive: true,
            createdAt: now,
            updatedAt: now,
            lastDigestDate: null,
            postsInLastDigest: 0,
            totalPostsFetched: 0,
            totalDigestsAppearedIn: 0,
          },
        });
        formAction(formData);
      });
    } else if (subreddit) {
      startTransition(() => {
        onOptimistic({
          type: "update",
          id: subreddit.id,
          changes: {
            insightPrompt: (formData.get("insightPrompt") as string) || null,
            maxPosts: Number(formData.get("maxPosts")) || subreddit.maxPosts,
            isActive: formData.get("active") === "on",
          },
        });
        formAction(formData);
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">
            {mode === "add" ? "Add Subreddit" : "Edit Subreddit"}
          </DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Add a new subreddit to monitor for your digest."
              : `Editing r/${subreddit?.name}`}
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          {mode === "edit" && subreddit && (
            <input type="hidden" name="subredditId" value={subreddit.id} />
          )}

          {mode === "add" && (
            <div className="space-y-2">
              <Label htmlFor="name">Subreddit Name</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">r/</span>
                <Input
                  id="name"
                  name="name"
                  placeholder="MachineLearning"
                  pattern="[A-Za-z0-9_]{3,21}"
                  title="3-21 characters, letters, numbers, and underscores"
                  required
                  autoFocus
                />
              </div>
            </div>
          )}

          {mode === "edit" && subreddit && (
            <div className="space-y-2">
              <Label>Subreddit</Label>
              <p className="font-mono text-sm">r/{subreddit.name}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="insightPrompt">Insight Prompt</Label>
            <Textarea
              id="insightPrompt"
              name="insightPrompt"
              placeholder="e.g. Focus on practical tutorials and breakthrough research papers"
              defaultValue={subreddit?.insightPrompt ?? ""}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxPosts">Max Posts</Label>
            <Input
              id="maxPosts"
              name="maxPosts"
              type="number"
              min={1}
              max={100}
              defaultValue={subreddit?.maxPosts ?? 5}
            />
          </div>

          {mode === "add" && (
            <div className="flex items-center gap-2">
              <input
                id="nsfw"
                name="nsfw"
                type="checkbox"
                className="size-4 rounded border-border accent-primary"
              />
              <Label htmlFor="nsfw" className="text-sm font-normal">
                Include NSFW content
              </Label>
            </div>
          )}

          {mode === "edit" && (
            <div className="flex items-center gap-2">
              <input
                id="active"
                name="active"
                type="checkbox"
                defaultChecked={subreddit?.isActive}
                className="size-4 rounded border-border accent-primary"
              />
              <Label htmlFor="active" className="text-sm font-normal">
                Active (include in digests)
              </Label>
            </div>
          )}

          {state && !state.ok && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {mode === "add" ? "Add Subreddit" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/subreddit-dialog.tsx
git commit -m "feat(web): add SubredditDialog for add/edit subreddits"
```

---

### Task 5: Build the DeleteSubredditDialog

**Files:**
- Create: `apps/web/components/delete-subreddit-dialog.tsx`

**Docs to check:**
- `apps/web/lib/actions.ts` — `removeSubredditAction` expects `FormData` with `subredditId`

- [ ] **Step 1: Create the delete confirmation dialog**

```tsx
// apps/web/components/delete-subreddit-dialog.tsx
"use client";

import { useActionState, useEffect, startTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { removeSubredditAction } from "@/lib/actions";
import type { SerializedSubreddit, ActionResult } from "@/lib/types";
import type { OptimisticAction } from "@/components/subreddit-table";

interface DeleteSubredditDialogProps {
  subreddit: SerializedSubreddit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimistic: (action: OptimisticAction) => void;
}

export function DeleteSubredditDialog({
  subreddit,
  open,
  onOpenChange,
  onOptimistic,
}: DeleteSubredditDialogProps) {
  const [state, formAction, isPending] = useActionState<ActionResult<{ subredditId: string }>, FormData>(
    removeSubredditAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(`Removed r/${subreddit.name}`);
      onOpenChange(false);
    } else {
      toast.error(state.error);
    }
  }, [state, subreddit.name, onOpenChange]);

  function handleSubmit(formData: FormData) {
    startTransition(() => {
      onOptimistic({ type: "remove", id: subreddit.id });
      formAction(formData);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono">Remove Subreddit</DialogTitle>
          <DialogDescription>
            Remove <span className="font-mono font-medium">r/{subreddit.name}</span>?
            This will stop monitoring this subreddit.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit}>
          <input type="hidden" name="subredditId" value={subreddit.id} />

          {state && !state.ok && (
            <p className="mb-4 text-sm text-destructive">{state.error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/delete-subreddit-dialog.tsx
git commit -m "feat(web): add DeleteSubredditDialog with confirmation"
```

---

## Chunk 4: Integration verification

### Task 6: Verify full build passes

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: All packages pass with 0 errors

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: All packages pass

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: All existing tests pass (309+)

- [ ] **Step 4: Fix any issues found in steps 1-3**

If typecheck or lint fails, fix the issues and re-run. Common issues:
- Missing imports (check exact export names from ShadCN components)
- `useActionState` import should be from `react` (not `react-dom`)
- Strict TypeScript: ensure no `any` types, proper null narrowing

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -u
git commit -m "fix(web): resolve typecheck/lint issues in subreddit manager"
```

---

### Task 7: Manual smoke test (if database available)

- [ ] **Step 1: Start dev server**

Run: `turbo dev --filter=@redgest/web`

- [ ] **Step 2: Navigate to /subreddits**

Expected: Page loads showing either the empty state ("No subreddits configured yet" + CTA) or the table with existing subreddits.

- [ ] **Step 3: Test add flow**

Click "Add Subreddit" → fill in name, optional prompt → submit.
Expected: Toast "Subreddit added", row appears in table.

- [ ] **Step 4: Test edit flow**

Click pencil icon on a row → modify insight prompt → save.
Expected: Toast "Subreddit updated", row reflects changes.

- [ ] **Step 5: Test delete flow**

Click trash icon → confirm removal.
Expected: Toast "Removed r/{name}", row disappears from table.
