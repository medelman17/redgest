# Global Settings Page — Design Spec

**Date**: 2026-03-10
**Work Stream**: WS10 (Web UI / Config)
**Effort**: 1.5pt
**Status**: Approved

## Overview

Single-form page for editing the global config singleton. Extends the `UpdateConfig` command to include `defaultDelivery` and `schedule` fields, then builds the UI.

## Architecture: Server Component Root + Client Form

- `page.tsx` is an async Server Component — fetches config via `getConfig()` DAL
- Serializes `updatedAt: Date` to ISO string for RSC→client boundary
- Passes to `<SettingsForm>` client component
- Form uses `useActionState` with `updateConfigAction` (already exists, extended with 2 new fields)
- On success: `revalidatePath("/settings")` (already wired in the action)
- No optimistic updates — single form, not a list

## Data Flow

```
page.tsx (Server Component)
  └─ await getConfig()  →  Config | null
       └─ serialize updatedAt to string, apply defaults for null config
            └─ <SettingsForm config={...} />  (Client Component)
                 └─ useActionState(updateConfigAction, null)
                      └─ form action → Server Action → DAL → CQRS → revalidatePath
```

## Backend Changes

### 1. Extend CommandMap["UpdateConfig"]

Add two optional fields to the params type:

```typescript
UpdateConfig: {
  globalInsightPrompt?: string;
  defaultLookbackHours?: number;
  llmProvider?: string;
  llmModel?: string;
  defaultDelivery?: DeliveryChannel;  // NEW
  schedule?: string | null;           // NEW (null = disable scheduled digest)
};
```

`DeliveryChannel` is the existing Prisma enum: `NONE | EMAIL | SLACK | ALL`.

### 2. Update command handler

Add `defaultDelivery` and `schedule` to the `data` and `update` objects in the upsert call. No conversion needed — both are stored as-is.

### 3. Extend updateConfigSchema in actions.ts

```typescript
const updateConfigSchema = z.object({
  globalInsightPrompt: z.string().optional(),
  defaultLookbackHours: z.coerce.number().int().min(1).max(168).optional(),
  llmProvider: z.string().optional(),
  llmModel: z.string().optional(),
  defaultDelivery: z.enum(["NONE", "EMAIL", "SLACK", "ALL"]).optional(),  // NEW
  schedule: z.string().optional(),                                        // NEW
});
```

### 4. Extend ConfigUpdated event schema

Add `defaultDelivery` and `schedule` to the `changes` record in the event payload. No schema change needed — the event payload is `{ changes: Record<string, unknown> }`, so it already accommodates arbitrary fields.

## Frontend Files

| File | Type | Purpose |
|------|------|---------|
| `app/settings/page.tsx` | Server Component | Fetch config, serialize, render form |
| `components/settings-form.tsx` | Client Component | Form with 6 fields, useActionState |
| `lib/types.ts` | Types | Add `SerializedConfig` mapped type |

## Component Details

### page.tsx

- Async Server Component (~20 lines)
- Calls `getConfig()` from DAL
- Handles null config (first run — no config row yet) by providing defaults
- Converts `updatedAt: Date` to ISO string
- Renders page header + `<SettingsForm config={...} />`

**Default config when null:**

```typescript
const defaults: SerializedConfig = {
  id: 1,
  globalInsightPrompt: "",
  defaultLookback: "24h",
  defaultDelivery: "NONE",
  llmProvider: "anthropic",
  llmModel: "claude-sonnet-4-20250514",
  schedule: null,
  updatedAt: new Date().toISOString(),
};
```

### settings-form.tsx

- Receives `config: SerializedConfig` prop
- `useActionState(updateConfigAction, null)` for form submission
- `useEffect` for toast on success/error (same pattern as Subreddit Manager dialogs)
- Submit button with `isPending` spinner
- No dialog — the form is rendered directly on the page

**Form fields (6):**

1. **Global Insight Prompt** — `<Textarea>` with placeholder. Guides LLM triage across all subreddits. `defaultValue={config.globalInsightPrompt}`.

2. **Default Lookback** — `<Input type="number">` for hours (1-168). Displayed with label "Default Lookback (hours)". `defaultValue` derived from `config.defaultLookback` by parsing the `"Nh"` string to extract N.

3. **LLM Provider** — `<Select>` with options: `anthropic`, `openai`. `defaultValue={config.llmProvider}`.

4. **LLM Model** — `<Input type="text">` with placeholder (e.g., "claude-sonnet-4-20250514"). `defaultValue={config.llmModel}`.

5. **Delivery Channel** — `<Select>` with options: `None`, `Email`, `Slack`, `All`. Maps to enum values `NONE/EMAIL/SLACK/ALL`. `defaultValue={config.defaultDelivery}`.

6. **Schedule** — `<Input type="text">` with placeholder "0 7 * * *" and helper text explaining cron format. Empty = no scheduled digest. `defaultValue={config.schedule ?? ""}`.

**Form layout:** Single column, `space-y-6` between field groups. "Save Settings" button at bottom.

## Serialization

Config has one Date field (`updatedAt`). Add to `lib/types.ts`:

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

## ShadCN Select Component

The form needs `<Select>` for LLM Provider and Delivery Channel. Check if ShadCN `select.tsx` is installed. If not, use native HTML `<select>` styled with Tailwind (same approach as checkbox in Subreddit Manager — avoid adding components for two dropdowns).

## Error Handling

- **Validation errors**: Zod failures surface as `state.error` string, shown via toast
- **Server errors**: CQRS failures caught in Server Action, returned as `{ ok: false, error }`
- **Toast on success**: "Settings saved"
- **No inline error display** — toast only (per simplification from Subreddit Manager)

## Null Config Handling

`getConfig()` returns `Config | null`. On first app use, no config row exists. The page must handle this:
- Server Component provides defaults when config is null
- Form submits to `updateConfigAction` which upserts (creates if not exists)
- After first save, config row exists for all future loads

## Dependencies

ShadCN components already installed: Button, Input, Textarea, Label, Sonner (toast).
May need: Select (or use native HTML select).

No new npm packages required.

## Decisions

- **Extend UpdateConfig rather than new command** — Same command, 2 additional optional fields. Simpler than a separate command for delivery/schedule.
- **No optimistic updates** — Single form, not a list. Submit → wait → toast is sufficient.
- **Defaults in Server Component** — Handle null config at the page level, not in the form component. Form always receives a complete config object.
- **Cron input as plain text** — No cron builder widget. Power user tool, cron expressions are fine. Helper text explains format.
- **Native select over ShadCN Select** — Only if ShadCN select isn't installed. Avoids adding a component for two dropdowns.
