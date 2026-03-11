# Trigger.dev Worker

Task definitions for Redgest's async job queue. Three tasks in `src/trigger/`:

- **`generate-digest`** — Wraps `runDigestPipeline()`, triggers `deliver-digest` on completion. Retry: 2.
- **`deliver-digest`** — Loads digest, dispatches to email/Slack via `Promise.allSettled`. Retry: 3.
- **`scheduled-digest`** — Cron (`DIGEST_CRON`, default `0 7 * * *`), creates Job, triggers `generate-digest`.

## Project-Specific Patterns

- `trigger.config.ts` uses `prismaExtension()` with modern mode + `@prisma/instrumentation`
- Tasks use `loadConfig()` from `@redgest/config` for env vars
- `deliver-digest` uses dynamic import to avoid circular: `const { deliverDigest } = await import("./deliver-digest.js")`
- `idempotencyKeys.create()` used on all child task triggers for retry safety
- `logger` from `@trigger.dev/sdk/v3` for structured logging (not `console.log`)

## Gotchas

- `tsconfig.json` needs `"jsx": "react-jsx"` — transitive `.tsx` imports from `@redgest/email`
- `trigger.config.ts` has a hardcoded project ID (TD-006) — extract to env var when deploying to multiple environments
- No unit tests yet (TD-005) — mock Prisma, pipeline deps, and SDK for testing

---

<!-- TRIGGER.DEV advanced-tasks START -->
# Trigger.dev Advanced Tasks (v4)

**Advanced patterns and features for writing tasks**

## Tags & Organization

```ts
import { task, tags } from "@trigger.dev/sdk";

export const processUser = task({
  id: "process-user",
  run: async (payload: { userId: string; orgId: string }, { ctx }) => {
    await tags.add(`user_${payload.userId}`);
    await tags.add(`org_${payload.orgId}`);
    return { processed: true };
  },
});

// Trigger with tags
await processUser.trigger(
  { userId: "123", orgId: "abc" },
  { tags: ["priority", "user_123", "org_abc"] } // Max 10 tags per run
);
```

**Tag Best Practices:**
- Use prefixes: `user_123`, `org_abc`, `video:456`
- Max 10 tags per run, 1-64 characters each
- Tags don't propagate to child tasks automatically

## Concurrency & Queues

```ts
import { task, queue } from "@trigger.dev/sdk";

const emailQueue = queue({
  name: "email-processing",
  concurrencyLimit: 5,
});

export const oneAtATime = task({
  id: "sequential-task",
  queue: { concurrencyLimit: 1 },
  run: async (payload) => {
    // Critical section - only one instance runs
  },
});

export const emailTask = task({
  id: "send-email",
  queue: emailQueue,
  run: async (payload: { to: string }) => {},
});
```

## Error Handling & Retries

```ts
import { task, retry, AbortTaskRunError } from "@trigger.dev/sdk";

export const resilientTask = task({
  id: "resilient-task",
  retry: {
    maxAttempts: 10,
    factor: 1.8,
    minTimeoutInMs: 500,
    maxTimeoutInMs: 30_000,
    randomize: false,
  },
  catchError: async ({ error, ctx }) => {
    if (error.code === "FATAL_ERROR") {
      throw new AbortTaskRunError("Cannot retry this error");
    }
    return { retryAt: new Date(Date.now() + 60000) };
  },
  run: async (payload) => {
    const result = await retry.onThrow(
      async () => await unstableApiCall(payload),
      { maxAttempts: 3 }
    );
    return result;
  },
});
```

## Idempotency

```ts
import { task, idempotencyKeys } from "@trigger.dev/sdk";

export const paymentTask = task({
  id: "process-payment",
  retry: { maxAttempts: 3 },
  run: async (payload: { orderId: string; amount: number }) => {
    const idempotencyKey = await idempotencyKeys.create(`payment-${payload.orderId}`);
    await chargeCustomer.trigger(payload, {
      idempotencyKey,
      idempotencyKeyTTL: "24h",
    });
  },
});
```

## Metadata & Progress Tracking

```ts
import { task, metadata } from "@trigger.dev/sdk";

export const batchProcessor = task({
  id: "batch-processor",
  run: async (payload: { items: any[] }) => {
    metadata.set("progress", 0).set("totalItems", payload.items.length);

    for (let i = 0; i < payload.items.length; i++) {
      await processItem(payload.items[i]);
      metadata.set("progress", ((i + 1) / payload.items.length) * 100)
        .increment("processedItems", 1);
    }

    metadata.set("status", "completed");
  },
});
```

## Machines & Performance

```ts
export const heavyTask = task({
  id: "heavy-computation",
  machine: { preset: "large-2x" }, // 8 vCPU, 16 GB RAM
  maxDuration: 1800,
  run: async (payload) => {},
});
```

**Machine Presets:** `micro` (0.25/0.25) | `small-1x` (0.5/0.5, default) | `small-2x` (1/1) | `medium-1x` (1/2) | `medium-2x` (2/4) | `large-1x` (4/8) | `large-2x` (8/16)

## Key Points

- **Result vs Output**: `triggerAndWait()` returns `{ ok, output, error }` — NOT direct output
- **Type safety**: Use `import type` for task references when triggering from backend
- **Waits > 5 seconds**: Automatically checkpointed, don't count toward compute
- Never wrap `triggerAndWait` or `wait` calls in `Promise.all`/`Promise.allSettled`
- Design tasks to be stateless, idempotent, and resilient to failures

<!-- TRIGGER.DEV advanced-tasks END -->

<!-- TRIGGER.DEV config START -->
# Trigger.dev Configuration (v4)

## Basic Configuration

```ts
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "<project-ref>",
  dirs: ["./trigger"],
  runtime: "node",
  logLevel: "info",
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2, randomize: true },
  },
  build: {
    autoDetectExternal: true,
    keepNames: true,
    minify: false,
    extensions: [],
  },
});
```

## Build Extensions

### Prisma

```ts
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

extensions: [
  prismaExtension({
    schema: "prisma/schema.prisma",
    version: "5.19.0",
    migrate: true,
    directUrlEnvVarName: "DIRECT_DATABASE_URL",
    typedSql: true,
  }),
];
```

### System Packages

```ts
import { aptGet } from "@trigger.dev/build/extensions/core";
extensions: [aptGet({ packages: ["ffmpeg", "imagemagick"] })];
```

### Additional Files

```ts
import { additionalFiles } from "@trigger.dev/build/extensions/core";
extensions: [additionalFiles({ files: ["wrangler.toml", "./assets/**"] })];
```

### Environment Variable Sync

```ts
import { syncEnvVars } from "@trigger.dev/build/extensions/core";
extensions: [
  syncEnvVars(async (ctx) => [
    { name: "SECRET_KEY", value: await getSecret(ctx.environment) },
  ]),
];
```

### Telemetry

```ts
import { PrismaInstrumentation } from "@prisma/instrumentation";

export default defineConfig({
  telemetry: {
    instrumentations: [new PrismaInstrumentation()],
  },
});
```

## Best Practices

- Pin extension versions for reproducible builds
- Add native addons to `build.external` array
- Use `--log-level debug --dry-run` for troubleshooting
- Extensions only affect deployment, not local development

<!-- TRIGGER.DEV config END -->

<!-- TRIGGER.DEV scheduled-tasks START -->
# Scheduled Tasks (cron)

```ts
import { schedules } from "@trigger.dev/sdk";

export const task = schedules.task({
  id: "first-scheduled-task",
  cron: "0 */2 * * *", // Declarative — syncs on dev/deploy
  run: async (payload) => {
    payload.timestamp;     // Date (scheduled time, UTC)
    payload.lastTimestamp;  // Date | undefined
    payload.timezone;       // IANA, default "UTC"
    payload.scheduleId;     // string
    payload.externalId;     // string | undefined
  },
});

// With timezone
schedules.task({
  id: "tokyo-5am",
  cron: { pattern: "0 5 * * *", timezone: "Asia/Tokyo" },
  run: async () => {},
});
```

**Imperative (SDK):**

```ts
await schedules.create({
  task: task.id,
  cron: "0 0 * * *",
  timezone: "America/New_York",
  externalId: "user_123",
  deduplicationKey: "user_123-daily",
});
```

**Cron syntax:** `min hour day-of-month month day-of-week` (no seconds)

**When schedules won't trigger:**
- Dev: only when dev CLI is running
- Staging/Production: only for tasks in latest deployment

<!-- TRIGGER.DEV scheduled-tasks END -->

<!-- TRIGGER.DEV realtime START -->
# Trigger.dev Realtime (v4)

## Public Access Tokens

```ts
import { auth } from "@trigger.dev/sdk";

const publicToken = await auth.createPublicToken({
  scopes: { read: { runs: ["run_123"], tasks: ["my-task"] } },
  expirationTime: "1h",
});
```

## Subscribe to Runs (Backend)

```ts
import { runs, tasks } from "@trigger.dev/sdk";

const handle = await tasks.trigger("my-task", { data: "value" });

for await (const run of runs.subscribeToRun<typeof myTask>(handle.id)) {
  console.log(`Status: ${run.status}`);
  if (run.status === "COMPLETED") break;
}
```

## React Hooks

```tsx
import { useRealtimeTaskTrigger, useRealtimeRun } from "@trigger.dev/react-hooks";
import type { myTask } from "../trigger/tasks";

// Trigger with realtime updates
const { submit, run } = useRealtimeTaskTrigger<typeof myTask>("my-task", { accessToken });

// Subscribe to specific run
const { run, error } = useRealtimeRun<typeof myTask>(runId, { accessToken });
```

## Run Object Properties

`id`, `status` (`QUEUED`/`EXECUTING`/`COMPLETED`/`FAILED`/`CANCELED`), `payload`, `output`, `metadata`, `createdAt`, `updatedAt`, `costInCents`

<!-- TRIGGER.DEV realtime END -->
