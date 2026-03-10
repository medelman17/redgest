# Global Settings Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a settings page to view/edit the global config singleton (LLM provider, delivery channel, schedule, etc.)

**Architecture:** Server Component root fetches config via DAL, serializes Date field, passes to client `<SettingsForm>`. Form uses `useActionState` + `updateConfigAction`. Backend extended with 2 new fields (`defaultDelivery`, `schedule`).

**Tech Stack:** Next.js 16, React 19, ShadCN (Select, Input, Textarea, Label, Button), Vitest

**Spec:** `docs/superpowers/specs/2026-03-10-global-settings-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/commands/types.ts` | Modify | Add `defaultDelivery` and `schedule` to `UpdateConfig` params |
| `packages/core/src/commands/handlers/update-config.ts` | Modify | Handle new fields in upsert |
| `packages/core/src/__tests__/command-handlers.test.ts` | Modify | Add tests for new fields |
| `apps/web/lib/actions.ts` | Modify | Extend `updateConfigSchema` with 2 new fields |
| `apps/web/lib/types.ts` | Modify | Add `SerializedConfig` type + `serializeConfig()` helper |
| `apps/web/app/settings/page.tsx` | Modify | Wire as async Server Component with config fetch |
| `apps/web/components/settings-form.tsx` | Create | Client form with 6 fields + `useActionState` |

---

## Chunk 1: Backend — Extend UpdateConfig command

### Task 1: Extend CommandMap and handler for new fields

**Files:**
- Modify: `packages/core/src/commands/types.ts:28-33`
- Modify: `packages/core/src/commands/handlers/update-config.ts`
- Modify: `packages/core/src/__tests__/command-handlers.test.ts`

- [ ] **Step 1: Add `defaultDelivery` and `schedule` to CommandMap**

In `packages/core/src/commands/types.ts`, extend the `UpdateConfig` entry:

```typescript
UpdateConfig: {
  globalInsightPrompt?: string;
  defaultLookbackHours?: number;
  llmProvider?: string;
  llmModel?: string;
  defaultDelivery?: import("@redgest/db").DeliveryChannel;  // NEW
  schedule?: string | null;                                   // NEW
};
```

Note: `DeliveryChannel` is a Prisma enum (`NONE | EMAIL | SLACK | ALL`). Use `import()` type to avoid a runtime import.

- [ ] **Step 2: Write failing tests for new fields**

Add two tests to `packages/core/src/__tests__/command-handlers.test.ts` inside the `handleUpdateConfig` describe block:

```typescript
it("passes defaultDelivery to upsert", async () => {
  const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
  const ctx = makeCtx({ config: { upsert: mockUpsert } });

  const result = await handleUpdateConfig(
    { defaultDelivery: "EMAIL" as const },
    ctx,
  );

  expect(result.event).toEqual({
    changes: { defaultDelivery: "EMAIL" },
  });
  expect(mockUpsert).toHaveBeenCalledWith({
    where: { id: 1 },
    update: { defaultDelivery: "EMAIL" },
    create: expect.objectContaining({
      id: 1,
      defaultDelivery: "EMAIL",
    }),
  });
});

it("passes schedule (including null to disable) to upsert", async () => {
  const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
  const ctx = makeCtx({ config: { upsert: mockUpsert } });

  const result = await handleUpdateConfig(
    { schedule: "0 7 * * *" },
    ctx,
  );

  expect(result.event).toEqual({
    changes: { schedule: "0 7 * * *" },
  });

  // Test null (disable schedule)
  await handleUpdateConfig({ schedule: null }, ctx);
  expect(mockUpsert).toHaveBeenLastCalledWith({
    where: { id: 1 },
    update: { schedule: null },
    create: expect.objectContaining({ id: 1, schedule: null }),
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/command-handlers.test.ts`
Expected: FAIL — handler doesn't process `defaultDelivery` or `schedule` yet.

- [ ] **Step 4: Update handler to process new fields**

In `packages/core/src/commands/handlers/update-config.ts`, add two new `if` blocks after the existing ones (before the `await ctx.db.config.upsert` call):

```typescript
if (params.defaultDelivery !== undefined) {
  changes.defaultDelivery = params.defaultDelivery;
}
if (params.schedule !== undefined) {
  changes.schedule = params.schedule;
}
```

No conversion needed — both store as-is. Note: `schedule: null` passes through the `!== undefined` guard correctly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @redgest/core exec vitest run src/__tests__/command-handlers.test.ts`
Expected: All tests PASS (including the existing 3 UpdateConfig tests).

- [ ] **Step 6: Run full check**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/commands/types.ts packages/core/src/commands/handlers/update-config.ts packages/core/src/__tests__/command-handlers.test.ts
git commit -m "feat(core): extend UpdateConfig with defaultDelivery and schedule fields"
```

---

### Task 2: Extend updateConfigSchema in actions.ts

**Files:**
- Modify: `apps/web/lib/actions.ts:35-40`

- [ ] **Step 1: Add new fields to the Zod schema**

In `apps/web/lib/actions.ts`, extend `updateConfigSchema`:

```typescript
const updateConfigSchema = z.object({
  globalInsightPrompt: z.string().optional(),
  defaultLookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  llmProvider: z.string().optional(),
  llmModel: z.string().optional(),
  defaultDelivery: z.enum(["NONE", "EMAIL", "SLACK", "ALL"]).optional(),
  schedule: z.preprocess(
    (v) => (v === "" ? null : v),
    z.string().nullable().optional(),
  ),
});
```

Key: `schedule` uses `z.preprocess` to convert empty string `""` (from cleared form input) to `null` (disable scheduled digest).

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — the Zod output type is compatible with `CommandMap["UpdateConfig"]`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions.ts
git commit -m "feat(web): extend updateConfigSchema with delivery and schedule fields"
```

---

## Chunk 2: Frontend — Settings page and form

### Task 3: Add SerializedConfig type to lib/types.ts

**Files:**
- Modify: `apps/web/lib/types.ts`

- [ ] **Step 1: Add SerializedConfig and serializeConfig**

Add to `apps/web/lib/types.ts` (after existing exports, before `ActionResult`):

```typescript
import type { Config } from "@redgest/db";

export type SerializedConfig = {
  [K in keyof Config]: Config[K] extends Date
    ? string
    : Config[K] extends Date | null
      ? string | null
      : Config[K];
};

export function serializeConfig(config: Config): SerializedConfig {
  return {
    ...config,
    updatedAt: config.updatedAt.toISOString(),
  };
}
```

Note: The `SubredditView` import is already at the top — add `Config` to the same import from `@redgest/db`.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/types.ts
git commit -m "feat(web): add SerializedConfig type for settings page"
```

---

### Task 4: Build SettingsForm client component

**Files:**
- Create: `apps/web/components/settings-form.tsx`

- [ ] **Step 1: Create the settings form component**

Create `apps/web/components/settings-form.tsx`:

```tsx
"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateConfigAction } from "@/lib/actions";
import type { SerializedConfig, ActionResult } from "@/lib/types";

function parseLookbackHours(lookback: string): number {
  const match = lookback.match(/^(\d+)h$/);
  return match ? Number(match[1]) : 24;
}

interface SettingsFormProps {
  config: SerializedConfig;
}

export function SettingsForm({ config }: SettingsFormProps) {
  const [state, formAction, isPending] = useActionState<
    ActionResult<{ success: true }>,
    FormData
  >(updateConfigAction, null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Settings saved");
    } else {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="globalInsightPrompt">Global Insight Prompt</Label>
        <Textarea
          id="globalInsightPrompt"
          name="globalInsightPrompt"
          placeholder="e.g. Focus on practical insights, new tools, and industry trends"
          defaultValue={config.globalInsightPrompt}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Guides LLM triage across all subreddits. Subreddit-level prompts
          take precedence.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="defaultLookbackHours">Default Lookback (hours)</Label>
          <Input
            id="defaultLookbackHours"
            name="defaultLookbackHours"
            type="number"
            min={1}
            max={168}
            defaultValue={parseLookbackHours(config.defaultLookback)}
          />
          <p className="text-xs text-muted-foreground">
            How far back to look for posts (1–168 hours)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="defaultDelivery">Delivery Channel</Label>
          <Select
            name="defaultDelivery"
            defaultValue={config.defaultDelivery}
          >
            <SelectTrigger id="defaultDelivery">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">None</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="SLACK">Slack</SelectItem>
              <SelectItem value="ALL">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="llmProvider">LLM Provider</Label>
          <Select name="llmProvider" defaultValue={config.llmProvider}>
            <SelectTrigger id="llmProvider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="llmModel">LLM Model</Label>
          <Input
            id="llmModel"
            name="llmModel"
            placeholder="claude-sonnet-4-20250514"
            defaultValue={config.llmModel}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="schedule">Digest Schedule (cron)</Label>
        <Input
          id="schedule"
          name="schedule"
          placeholder="0 7 * * *"
          defaultValue={config.schedule ?? ""}
        />
        <p className="text-xs text-muted-foreground">
          Cron expression for scheduled digests (e.g. &quot;0 7 * * *&quot; =
          daily at 7 AM). Leave empty to disable.
        </p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
        Save Settings
      </Button>
    </form>
  );
}
```

**Key details:**
- `parseLookbackHours("24h")` → `24` for the number input default
- ShadCN `<Select>` for provider and delivery channel (already installed)
- `schedule` defaults to `""` when null — the Zod `preprocess` in actions.ts converts `""` back to `null`
- No `startTransition` / `useOptimistic` needed — single form, not a list
- Toast only (no inline error), matching the pattern from Subreddit Manager

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/settings-form.tsx
git commit -m "feat(web): build SettingsForm with 6-field config form"
```

---

### Task 5: Wire settings page as async Server Component

**Files:**
- Modify: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: Update page.tsx to fetch config and render form**

Replace `apps/web/app/settings/page.tsx` with:

```tsx
import { getConfig } from "@/lib/dal";
import { serializeConfig } from "@/lib/types";
import type { SerializedConfig } from "@/lib/types";
import { SettingsForm } from "@/components/settings-form";

const DEFAULT_CONFIG: SerializedConfig = {
  id: 1,
  globalInsightPrompt: "",
  defaultLookback: "24h",
  defaultDelivery: "NONE",
  llmProvider: "anthropic",
  llmModel: "claude-sonnet-4-20250514",
  schedule: null,
  updatedAt: new Date().toISOString(),
};

export default async function SettingsPage() {
  const config = await getConfig();
  const serialized = config ? serializeConfig(config) : DEFAULT_CONFIG;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure digest generation, LLM providers, and delivery channels
        </p>
      </div>
      <SettingsForm config={serialized} />
    </div>
  );
}
```

**Key details:**
- `getConfig()` returns `Config | null` — null on first run before any config is saved
- `DEFAULT_CONFIG` provides sensible defaults matching the command handler's upsert create block
- `serializeConfig()` converts `updatedAt: Date` → `string` for the RSC→client boundary

- [ ] **Step 2: Run full check**

Run: `pnpm check`
Expected: All lint, typecheck, and tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/settings/page.tsx
git commit -m "feat(web): wire settings page as async Server Component"
```

---

## Verification

After all tasks, run:

```bash
pnpm check
```

All 364+ tests should pass. The settings page should be accessible at `/settings` in the Next.js dev server.
