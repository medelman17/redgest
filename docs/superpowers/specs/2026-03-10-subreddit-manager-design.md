# Subreddit Manager Page — Design Spec

**Date**: 2026-03-10
**Work Stream**: WS10 (Web UI / Config)
**Effort**: 2pt
**Status**: Approved

## Overview

CRUD page for managing monitored subreddits. Users can add, edit insight prompts, toggle active/inactive, and remove subreddits. Part of the Next.js config UI (apps/web).

## Architecture: Server Component Root + Client Islands

- `page.tsx` is an async Server Component — fetches subreddits via DAL at render time
- Passes serialized data to a `<SubredditTable>` client component
- Mutations use existing Server Actions (`actions.ts`) which call DAL → CQRS commands → `revalidatePath("/subreddits")`
- No TanStack Query needed — personal tool, no concurrent users, SSR fetch is sufficient

## Data Flow

```
page.tsx (Server Component)
  └─ await listSubreddits()  →  SubredditView[]
       └─ serialize dates to strings
            └─ <SubredditTable subreddits={...} />  (Client Component)
                 ├─ useOptimistic(subreddits)
                 ├─ "Add Subreddit" → <SubredditDialog mode="add" />
                 ├─ Row edit → <SubredditDialog mode="edit" subreddit={...} />
                 └─ Row delete → <DeleteSubredditDialog subreddit={...} />
```

Server Actions (already implemented in `lib/actions.ts`):
- `addSubredditAction` — Zod validates, calls `dal.addSubreddit()`, revalidates
- `updateSubredditAction` — Zod validates, calls `dal.updateSubreddit()`, revalidates
- `removeSubredditAction` — Zod validates, calls `dal.removeSubreddit()`, revalidates

## Files

| File | Type | Purpose |
|------|------|---------|
| `app/subreddits/page.tsx` | Server Component | Async fetch + serialize + render table |
| `components/subreddit-table.tsx` | Client Component | Table, empty state, optimistic state, dialog triggers |
| `components/subreddit-dialog.tsx` | Client Component | Add/edit form in ShadCN Dialog |
| `components/delete-subreddit-dialog.tsx` | Client Component | Remove confirmation dialog |
| `lib/types.ts` | Shared types | `SerializedSubreddit` (dates as strings) |

## Component Details

### page.tsx

- Async Server Component (~15 lines)
- Calls `listSubreddits()` from DAL
- Converts `Date` fields to ISO strings (`SerializedSubreddit`)
- Renders page header + `<SubredditTable>`

### subreddit-table.tsx

- Receives `subreddits: SerializedSubreddit[]` prop
- `useOptimistic` reducer handles add/remove/update actions for instant UI
- Table columns:
  - **Name** — `r/{name}` in monospace
  - **Insight Prompt** — truncated to ~60 chars, tooltip for full text
  - **Max Posts** — number
  - **Status** — green "Active" / gray "Inactive" Badge
  - **Last Digest** — relative time (e.g., "2 hours ago") or "Never"
  - **Actions** — Edit button (pencil icon) + Delete button (trash icon)
- Empty state: text message + "Add your first subreddit" CTA button
- Header area: page title + "Add Subreddit" button (top right)

### subreddit-dialog.tsx

- Props: `mode: "add" | "edit"`, optional `subreddit` for edit prefill, `onOptimistic` callback
- Dialog title: "Add Subreddit" / "Edit Subreddit"
- **Add mode** fields:
  - **Name** — text input, required (Reddit subreddit name, e.g. "MachineLearning"). UI strips leading "r/" if user types it. Validated: 3-21 chars, alphanumeric + underscores.
  - **Insight Prompt** — textarea, optional, placeholder explaining purpose
  - **Max Posts** — number input, default 5, range 1-100
  - **NSFW** — Checkbox, default off. Note: `includeNsfw` can only be set at creation time (UpdateSubreddit does not support changing it).
- **Edit mode** fields (matches `UpdateSubreddit` command contract exactly):
  - **Name** — displayed as read-only text (not an input), for context
  - **Insight Prompt** — textarea, prefilled with current value
  - **Max Posts** — number input, prefilled with current value
  - **Active** — Checkbox toggle, prefilled with current `isActive` state
- Uses `useActionState` with `addSubredditAction` or `updateSubredditAction`
- Submit button shows pending spinner via `isPending` (third return value of `useActionState`)
- Closes dialog on `actionState.ok === true` via `useEffect`
- Dispatches optimistic update via `startTransition` before form submit

**Note:** `CommandMap["AddSubreddit"]` accepts `displayName` but the handler ignores it (not stored in DB). The form omits it — `name` is passed as both `name` and `displayName` to satisfy the Zod schema.

### delete-subreddit-dialog.tsx

- Props: `subreddit` (name + id), `onOptimistic` callback
- Confirmation message: "Remove r/{name}? This will stop monitoring this subreddit."
- Uses `useActionState` with `removeSubredditAction`
- Hidden input with `subredditId`
- Dispatches optimistic removal on submit

## Optimistic Updates

```typescript
type OptimisticAction =
  | { type: "add"; subreddit: SerializedSubreddit }
  | { type: "remove"; id: string }
  | { type: "update"; id: string; changes: Partial<SerializedSubreddit> };

const [optimisticSubs, dispatchOptimistic] = useOptimistic(
  subreddits,
  (state, action: OptimisticAction) => {
    switch (action.type) {
      case "add": return [...state, action.subreddit];
      case "remove": return state.filter(s => s.id !== action.id);
      case "update": return state.map(s =>
        s.id === action.id ? { ...s, ...action.changes } : s
      );
    }
  }
);
```

Each dialog dispatches optimistic action before Server Action call. If action fails, `revalidatePath` triggers re-render with real data (automatic revert).

**Fabricating optimistic adds:** The "add" action requires a full `SerializedSubreddit`, but the client doesn't have the server-assigned `id` or analytics fields yet. Use `crypto.randomUUID()` for a temporary `id`, `new Date().toISOString()` for timestamps, `true` for `isActive`, `0` for all counter fields, and `null` for `lastDigestDate`. The temporary entry is replaced by real data when `revalidatePath` triggers the Server Component re-render.

## Serialization

`SubredditView` contains `Date` fields that can't cross the RSC→client boundary. A `SerializedSubreddit` type maps:

- `createdAt: Date` → `createdAt: string` (ISO)
- `updatedAt: Date` → `updatedAt: string` (ISO)
- `lastDigestDate: Date | null` → `lastDigestDate: string | null` (ISO)

All other fields (`id`, `name`, `insightPrompt`, `maxPosts`, `includeNsfw`, `isActive`, `postsInLastDigest`, `totalPostsFetched`, `totalDigestsAppearedIn`) pass through unchanged as primitives. Conversion happens in `page.tsx` before prop passing. The `SerializedSubreddit` type should be derived from `SubredditView` using a mapped type to stay in sync with schema changes.

## Error Handling

- **Validation errors**: Zod failures surface as `actionState.error` string below the form
- **Server errors**: CQRS failures (e.g., duplicate name unique constraint) caught in Server Action, returned as `{ ok: false, error: message }`
- **Toast notifications**: Sonner toast on success ("Subreddit added") and error ("Failed to add subreddit: ...")
- **No global error boundary**: Errors scoped to individual dialogs

## Styling

- Terminal-Luxe theme (already configured): slate dark, green accent
- ShadCN `<Table>` component (not TanStack Table — overkill for ~10 rows)
- Monospace font (`font-mono`) for subreddit names
- Active/Inactive: green/gray `<Badge>` variants
- Responsive: table scrolls horizontally on mobile, dialog is max-w-md

## Dependencies

All ShadCN components needed are already installed:
- Dialog, Table, Button, Input, Textarea, Label, Badge, Sonner (toast), Tooltip

Uses native HTML checkbox styled with Tailwind (not ShadCN Switch/Checkbox — avoids adding a component for two toggles).

No new npm packages required.

## Testing

- Async Server Component (`page.tsx`) cannot be unit tested — use Playwright E2E
- Client components can be tested with Vitest + Testing Library if needed
- Primary validation: E2E test that adds, edits, and removes a subreddit

## Decisions

- **ShadCN Table over TanStack Table** — No sorting/filtering/pagination needed for a personal tool with ~5-20 subreddits
- **Dialog over inline edit** — Cleaner UX, works well with `useActionState`, ShadCN Dialog already installed
- **Server Component root** — No need for client-side data fetching; SSR gives instant data on page load
- **Optimistic updates** — Instant UI feedback for a snappy feel; automatic revert on failure via revalidation
