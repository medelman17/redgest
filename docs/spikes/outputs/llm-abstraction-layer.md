# Trigger.dev v4 integration blueprint for Redgest

**Trigger.dev v4 (SDK 4.4.2, GA since late 2025) works cleanly as a standalone Node.js task runner in a TurboRepo monorepo — no web framework required.** The architecture separates *task definition* (bundled and executed on Trigger.dev infrastructure) from *task triggering* (a lightweight SDK client callable from any Node.js process, including your MCP server). Prisma v7 is supported via the extension's `modern` mode, which externalizes `@prisma/client` from esbuild bundling. The critical tradeoff: self-hosted v4 lacks checkpointing and warm starts, making Cloud the better starting point for Redgest's multi-phase digest pipeline.

---

## A. Integration architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  TurboRepo Monorepo                                             │
│                                                                 │
│  ┌──────────────────┐     ┌──────────────────┐                  │
│  │ apps/mcp-server   │     │ packages/core     │                  │
│  │                  │     │ (CQRS domain)     │                  │
│  │ MCP Tool Handler │     │                  │                  │
│  │       │          │     │ Commands/Queries  │                  │
│  │       ▼          │     │ Event Bus         │                  │
│  │ tasks.trigger()  │     │       │           │                  │
│  │ runs.retrieve()  │     │       ▼           │                  │
│  │   (SDK client)   │     │ Event Handlers    │                  │
│  └───────┬──────────┘     │ → tasks.trigger() │                  │
│          │                └────────┬─────────┘                  │
│          │                         │                            │
│  ┌───────┴─────────────────────────┴──────────────────────┐     │
│  │ packages/worker                                         │     │
│  │ trigger.config.ts + src/trigger/*.ts                    │     │
│  │                                                         │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐   │     │
│  │  │ digestTask   │  │ summarize   │  │ dailyCron     │   │     │
│  │  │ (orchestrator│  │ Task        │  │ (scheduled)   │   │     │
│  │  │  pipeline)   │  │             │  │               │   │     │
│  │  └──────┬───────┘  └─────────────┘  └───────────────┘   │     │
│  │         │ imports from @repo/core & @repo/database       │     │
│  └─────────┼───────────────────────────────────────────────┘     │
│            │                                                     │
│  ┌─────────┴──────────┐                                         │
│  │ packages/database   │                                         │
│  │ Prisma v7 schema    │                                         │
│  │ Generated client    │                                         │
│  │ PrismaPg adapter    │                                         │
│  └─────────┬──────────┘                                         │
└────────────┼────────────────────────────────────────────────────┘
             │
    ─────────┼──── HTTPS ──────────────────────
             │
             ▼
┌────────────────────────────┐     ┌──────────────────┐
│  Trigger.dev Cloud/Self    │     │                  │
│                            │◄────│  Postgres (app)  │
│  Run Engine 2              │     │                  │
│  • Warm starts (Cloud)     │     └──────────────────┘
│  • CRIU checkpoints (Cloud)│
│  • Task containers         │
│  • Cron scheduler          │
│  • Realtime API            │
└────────────────────────────┘
```

The MCP server and CQRS event handlers both act as **trigger clients** — they call `tasks.trigger()` over HTTPS to Trigger.dev's API. Task code executes on Trigger.dev's infrastructure in isolated containers, with full access to your Prisma client and domain logic bundled from the monorepo. The Trigger.dev platform manages scheduling, retries, queuing, and observability.

---

## B. Code patterns for Redgest

### trigger.config.ts (packages/worker/)

```typescript
import { defineConfig } from "@trigger.dev/sdk";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

export default defineConfig({
  project: "proj_redgest_xxxx", // from Trigger.dev dashboard
  dirs: ["./src/trigger"],
  maxDuration: 600, // 10 min global default
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: [
      prismaExtension({
        mode: "modern", // Prisma v7 — no Rust engine, just externalizes @prisma/client
      }),
    ],
  },
});
```

### Task definition with phases, progress, and idempotency (packages/worker/src/trigger/digestTask.ts)

```typescript
import { task, metadata, idempotencyKeys, queue } from "@trigger.dev/sdk";
import { db } from "@repo/database";

const digestQueue = queue({
  name: "digest-processing",
  concurrencyLimit: 3, // max 3 concurrent digests
});

export const generateDigestTask = task({
  id: "generate-digest",
  queue: digestQueue,
  maxDuration: 300, // 5 minutes
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { digestConfigId: string; userId: string }) => {
    const { digestConfigId, userId } = payload;

    // Phase 1: Fetch subreddit posts
    metadata.set("phase", "fetch").set("progress", 0.1);
    const fetchKey = await idempotencyKeys.create(`fetch-${digestConfigId}`);
    const posts = await fetchSubredditPosts.triggerAndWait(
      { digestConfigId },
      { idempotencyKey: fetchKey }
    );

    // Phase 2: Triage — score and filter posts
    metadata.set("phase", "triage").set("progress", 0.3);
    const triageKey = await idempotencyKeys.create(`triage-${digestConfigId}`);
    const triaged = await triagePosts.triggerAndWait(
      { posts: posts.output, digestConfigId },
      { idempotencyKey: triageKey }
    );

    // Phase 3: Summarize top posts via LLM
    metadata.set("phase", "summarize").set("progress", 0.5);
    const summaryKey = await idempotencyKeys.create(`summarize-${digestConfigId}`);
    const summaries = await summarizePosts.triggerAndWait(
      { posts: triaged.output },
      { idempotencyKey: summaryKey }
    );

    // Phase 4: Assemble digest
    metadata.set("phase", "assemble").set("progress", 0.8);
    const digest = await db.digest.create({
      data: {
        userId,
        configId: digestConfigId,
        content: summaries.output,
        generatedAt: new Date(),
      },
    });

    // Phase 5: Deliver
    metadata.set("phase", "deliver").set("progress", 0.95);
    await deliverDigest.trigger({ digestId: digest.id });

    metadata.set("phase", "complete").set("progress", 1.0);
    return { digestId: digest.id, postCount: triaged.output.length };
  },
});

// Subtasks — each independently retryable
export const fetchSubredditPosts = task({
  id: "fetch-subreddit-posts",
  retry: { maxAttempts: 5 },
  run: async (payload: { digestConfigId: string }) => {
    const config = await db.digestConfig.findUniqueOrThrow({
      where: { id: payload.digestConfigId },
      include: { subreddits: true },
    });
    // ... fetch from Reddit API ...
    return posts;
  },
});

export const triagePosts = task({
  id: "triage-posts",
  run: async (payload: { posts: RedditPost[]; digestConfigId: string }) => {
    // ... scoring logic ...
    return scoredPosts.filter((p) => p.score > threshold);
  },
});

export const summarizePosts = task({
  id: "summarize-posts",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: async (payload: { posts: TriagedPost[] }) => {
    // ... LLM summarization ...
    return summaries;
  },
});

export const deliverDigest = task({
  id: "deliver-digest",
  run: async (payload: { digestId: string }) => {
    // ... email, push notification, etc. ...
  },
});
```

### Scheduled task (packages/worker/src/trigger/dailyDigest.ts)

```typescript
import { schedules } from "@trigger.dev/sdk";
import { db } from "@repo/database";
import { generateDigestTask } from "./digestTask";

// Declarative — synced on deploy
export const dailyDigestCron = schedules.task({
  id: "daily-digest-cron",
  cron: {
    pattern: "0 7 * * *",        // 7 AM daily
    timezone: "America/New_York",
    environments: ["PRODUCTION"],
  },
  run: async (payload) => {
    const activeConfigs = await db.digestConfig.findMany({
      where: { active: true },
      include: { user: true },
    });

    // Fan out: trigger one digest generation per user config
    for (const config of activeConfigs) {
      await generateDigestTask.trigger({
        digestConfigId: config.id,
        userId: config.userId,
      });
    }

    return { triggered: activeConfigs.length };
  },
});
```

Runtime schedule creation (from MCP server or API):

```typescript
import { schedules } from "@trigger.dev/sdk";

// Create a per-user custom schedule
const schedule = await schedules.create({
  task: "daily-digest-cron",
  cron: "0 9 * * 1-5",              // weekdays at 9 AM
  timezone: "Europe/London",
  externalId: `user_${userId}`,
  deduplicationKey: `user_${userId}-digest`, // upserts on re-create
});

// Update later
await schedules.update(schedule.id, { cron: "0 8 * * *" });

// Deactivate/reactivate
await schedules.deactivate(schedule.id);
await schedules.activate(schedule.id);
```

### Triggering from MCP server (apps/mcp-server/)

```typescript
import { tasks, runs, configure } from "@trigger.dev/sdk";
import type { generateDigestTask } from "@repo/worker/trigger/digestTask";

// Optional explicit configuration (otherwise uses TRIGGER_SECRET_KEY env var)
configure({
  secretKey: process.env.TRIGGER_SECRET_KEY, // e.g. tr_prod_xxxxx
  // baseURL: "https://self-hosted.example.com" // only for self-hosted
});

// MCP tool: trigger digest generation
async function handleGenerateDigest(params: { digestConfigId: string; userId: string }) {
  const handle = await tasks.trigger<typeof generateDigestTask>(
    "generate-digest",
    { digestConfigId: params.digestConfigId, userId: params.userId },
    {
      tags: [`user:${params.userId}`],
      metadata: { source: "mcp", requestedAt: new Date().toISOString() },
    }
  );
  return { runId: handle.id }; // returns immediately
}

// MCP tool: check digest status
async function handleDigestStatus(params: { runId: string }) {
  const run = await runs.retrieve<typeof generateDigestTask>(params.runId);
  return {
    status: run.status,       // QUEUED | EXECUTING | WAITING | COMPLETED | FAILED | ...
    phase: run.metadata?.phase,
    progress: run.metadata?.progress,
    output: run.isSuccess ? run.output : undefined,
    error: run.isFailed ? run.error : undefined,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

// MCP tool: subscribe to realtime updates
async function handleWatchDigest(params: { runId: string }) {
  for await (const run of runs.subscribeToRun(params.runId)) {
    // Yields on every status/metadata change (SSE-based)
    console.log(run.status, run.metadata?.progress);
    if (run.isCompleted) break;
  }
}

// Trigger and wait synchronously (blocks until complete)
async function handleGenerateAndWait(params: { digestConfigId: string; userId: string }) {
  const run = await tasks.triggerAndPoll<typeof generateDigestTask>(
    "generate-digest",
    { digestConfigId: params.digestConfigId, userId: params.userId },
    { pollIntervalMs: 2_000 }
  );
  return run.output; // typed output
}
```

### Prisma v7 shared database package (packages/database/)

```prisma
// packages/database/prisma/schema.prisma
generator client {
  provider               = "prisma-client"
  output                 = "../src/generated/prisma"
  moduleFormat           = "esm"
  generatedFileExtension = "ts"
  importFileExtension    = "ts"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model DigestConfig {
  id         String   @id @default(cuid())
  userId     String
  active     Boolean  @default(true)
  subreddits String[]
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id])
  digests    Digest[]
}
// ... other models
```

```typescript
// packages/database/src/index.ts
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
export const db = new PrismaClient({ adapter });
export * from "./generated/prisma/client.js";
```

**Build pipeline in turbo.json:**

```json
{
  "tasks": {
    "db:generate": {
      "inputs": ["prisma/schema.prisma"],
      "outputs": ["src/generated/**"],
      "cache": true
    },
    "build": {
      "dependsOn": ["^db:generate", "^build"]
    },
    "deploy:trigger": {
      "dependsOn": ["^db:generate"],
      "cache": false
    }
  }
}
```

Run `prisma generate` before any Trigger.dev dev/deploy since `modern` mode does not auto-generate.

---

## C. Connecting CQRS domain events to Trigger.dev

Trigger.dev v4 has **no native event bus** — the old `client.sendEvent()` / `eventTrigger()` from v2 was removed entirely. The v4 model is direct: you call `tasks.trigger()` to start a task. This is actually a clean fit for CQRS.

**Recommended pattern: thin adapter in your event bus handlers.**

```typescript
// packages/core/src/events/handlers/digestRequested.handler.ts
import { tasks } from "@trigger.dev/sdk";
import type { generateDigestTask } from "@repo/worker/trigger/digestTask";
import type { DigestRequestedEvent } from "../types";

export function registerDigestHandlers(eventBus: EventBus) {
  eventBus.on("digest.requested", async (event: DigestRequestedEvent) => {
    const handle = await tasks.trigger<typeof generateDigestTask>(
      "generate-digest",
      {
        digestConfigId: event.payload.digestConfigId,
        userId: event.payload.userId,
      },
      {
        tags: [`user:${event.payload.userId}`, `config:${event.payload.digestConfigId}`],
        idempotencyKey: `digest-${event.payload.digestConfigId}-${event.payload.requestId}`,
      }
    );

    // Optionally store the run ID back in your domain
    await commandBus.execute(new TrackDigestRunCommand({
      digestConfigId: event.payload.digestConfigId,
      triggerRunId: handle.id,
    }));
  });
}
```

This pattern keeps your domain events in-process and synchronous, while the actual heavy computation is offloaded asynchronously to Trigger.dev. The **idempotency key** prevents duplicate runs if the same event fires twice. The run ID is stored in your domain model for status tracking.

**Why this beats alternatives:** A "router task" pattern (one Trigger.dev task that dispatches to others) adds an unnecessary network hop and consumes a task slot. A webhook pattern requires exposing an endpoint. The direct `tasks.trigger()` call from the event handler is the simplest, lowest-latency approach — it's just an HTTPS POST under the hood.

For lifecycle callbacks, use the task's `onSuccess`/`onFailure` hooks to emit domain events back:

```typescript
export const generateDigestTask = task({
  id: "generate-digest",
  onSuccess: async (payload, output, { ctx }) => {
    // Write completion status to your Postgres directly
    await db.digestRun.update({
      where: { triggerRunId: ctx.run.id },
      data: { status: "COMPLETED", completedAt: new Date(), output },
    });
  },
  onFailure: async (payload, error, { ctx }) => {
    await db.digestRun.update({
      where: { triggerRunId: ctx.run.id },
      data: { status: "FAILED", error: String(error) },
    });
  },
  run: async (payload) => { /* ... */ },
});
```

Tasks **can and should** write directly to your application Postgres via the shared Prisma client. This gives you a parallel status tracking mechanism independent of the Trigger.dev API — critical for reducing vendor coupling.

---

## D. Cloud → self-hosted migration playbook

### Step 1: Understand what changes

| Aspect | Cloud | Self-hosted v4 |
|--------|-------|-----------------|
| SDK API | Identical | Identical |
| Checkpointing (CRIU) | ✅ Waits free | ❌ Process stays alive |
| Warm starts | ✅ 100–300ms | ❌ Cold start every run |
| Auto-scaling | ✅ | ❌ Manual |
| Infrastructure | Managed | You operate it |
| Builds | Depot cloud builds | Local Docker Buildx |
| Cost model | Per-compute-second | Your server costs |

**The SDK code, task definitions, and trigger.config.ts do not change.** Only environment variables and deployment targets change.

### Step 2: Provision infrastructure

Minimum for a personal tool: **single machine, 4 vCPU, 8 GB RAM** running both webapp and worker. For Redgest's workload (a few digests per day), this is sufficient.

### Step 3: Deploy the self-hosted stack

```bash
git clone --depth=1 https://github.com/triggerdotdev/trigger.dev
cd trigger.dev/hosting/docker
cp .env.example .env
```

Edit `.env` — critical variables:

```env
APP_ORIGIN=https://trigger.redgest.example.com
LOGIN_ORIGIN=https://trigger.redgest.example.com
DATABASE_URL=postgresql://postgres:password@postgres:5432/trigger
SESSION_SECRET=$(openssl rand -hex 32)
MAGIC_LINK_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
ADMIN_EMAILS=^you@example\.com$
```

Start the combined stack:

```bash
docker compose -f webapp/docker-compose.yml -f worker/docker-compose.yml up -d
```

Services started: **webapp, postgres, redis, clickhouse, electric, minio, registry, supervisor, docker-socket-proxy** (9 containers total).

### Step 4: Create project and get credentials

1. Open `https://trigger.redgest.example.com`, sign in with your admin email
2. Create a new project → copy the project ref and secret keys
3. Note the worker token printed in webapp logs (needed if running worker separately)

### Step 5: Update your SDK configuration

```bash
# .env in your monorepo
TRIGGER_SECRET_KEY=tr_dev_xxxxx           # dev key from dashboard
TRIGGER_API_URL=https://trigger.redgest.example.com  # point at self-hosted
```

For CI/CD:

```bash
TRIGGER_ACCESS_TOKEN=tr_pat_xxxxx         # personal access token
TRIGGER_API_URL=https://trigger.redgest.example.com
```

### Step 6: Login and deploy

```bash
npx trigger.dev@latest login -a https://trigger.redgest.example.com
docker login localhost:5000  # registry-user / your-password
npx trigger.dev@latest deploy
```

### Step 7: Adjust task patterns for no checkpointing

On self-hosted, `triggerAndWait()` still works but the parent process stays alive (no CRIU freeze). This consumes more resources. For Redgest's digest pipeline, this is likely fine — each run takes minutes, not hours. If resource usage becomes a concern, switch to fire-and-forget subtasks with status tracking in your own Postgres rather than `triggerAndWait()`.

### Step 8: Postgres considerations

Self-hosted Trigger.dev uses its own Postgres with its own schema (runs Prisma migrations + Graphile Worker migrations on startup). **Use a separate database** from your application — not just a separate schema, but a separate database instance or at minimum a separate logical database. The default Docker Compose provisions a dedicated Postgres container.

---

## E. Risk register

### High risk: self-hosted loses checkpointing and warm starts

Self-hosted v4 does **not** support CRIU checkpointing or warm starts. Every run cold-starts a new container. For Redgest's multi-phase digest pipeline using `triggerAndWait()`, the orchestrator process stays alive during all subtask execution — consuming CPU and memory the entire time. **Mitigation:** Start on Trigger.dev Cloud (free tier: **30,000 compute seconds/month**, 10 schedules, 60 API requests/min). Migrate to self-hosted only when costs justify it, and restructure to fire-and-forget subtasks with application-level orchestration if needed.

### Medium risk: Prisma v7 + esbuild bundling friction

Prisma v7's new `prisma-client` generator has confirmed esbuild compatibility issues (dynamic `require()` errors in ESM mode). Trigger.dev's `modern` mode mitigates this by externalizing `@prisma/client` from the bundle entirely. However, this is a **relatively new code path** (mode-based API shipped in Trigger.dev 4.1.1, November 2025). Edge cases may exist. **Mitigation:** Pin exact Prisma and Trigger.dev SDK versions. Test deployment thoroughly. If issues arise, temporarily use `prisma-client-js` provider (still works in Prisma v7) with `legacy` mode as a fallback.

### Medium risk: monorepo path alias limitations

TypeScript path aliases (e.g., `@/` or `~`) are **not supported in trigger.config.ts itself** — you must use relative imports there. Path aliases in task code are resolved by esbuild during bundling, so they work fine in task files. **Mitigation:** Use relative imports in `trigger.config.ts`. Define build extensions and any config-level imports with full relative paths. Task code can use aliases normally.

### Medium risk: `prisma generate` not automatic in modern mode

The `modern` mode extension does **not** run `prisma generate` — you must ensure it runs before `trigger dev` and `trigger deploy`. In a TurboRepo, a missed generation step silently breaks the build. **Mitigation:** Add `db:generate` as a pipeline dependency in `turbo.json` and as a `prebuild` script. In CI/CD, explicitly run `pnpm --filter @repo/database db:generate` before `trigger deploy`.

### Low risk: vendor lock-in

Trigger.dev tasks are plain TypeScript functions. The `task()` wrapper is thin. Domain logic in `packages/core/` is completely decoupled. The Trigger.dev-specific surface is limited to: `trigger.config.ts`, task wrappers, `tasks.trigger()` calls, and `metadata`/`runs` APIs. **Mitigation:** Keep domain logic in `packages/core/`. The event bus adapter pattern (Section C) means replacing Trigger.dev requires only rewriting the thin adapter layer and the task wrappers — the domain logic and event bus are untouched.

### Low risk: free tier limits for scheduled tasks

Cloud free tier allows **10 schedules per project**. If Redgest evolves to per-user custom schedules, this limit hits fast. **Mitigation:** Hobby tier ($10/mo) gives 100 schedules. Alternatively, use a single cron task that fans out to all active users (as shown in the code pattern above), which uses only 1 schedule slot regardless of user count.

### Low risk: ESM compatibility

Trigger.dev bundles all task code with esbuild, resolving ESM/CJS differences at build time. Workspace protocol dependencies (`workspace:*`) are resolved and bundled. The generated deployment image runs the bundled output, not your source. This makes ESM/CJS issues at the task execution level rare. The primary risk area is `@prisma/client` in ESM mode, which the `modern` extension handles.

---

## F. Open questions and uncertainties

**`experimental_processKeepAlive` stability.** The v4 warm start optimization flag `experimental_processKeepAlive` in `trigger.config.ts` is still prefixed `experimental_`. Its behavior with stateful singletons like Prisma client instances (connection pools surviving between runs) is not well-documented. For Redgest, this is relevant for Cloud deployment — test whether the Prisma connection pool behaves correctly across warm-started runs, or instantiate the client fresh per run.

**Prisma v7 driver adapter in Trigger.dev containers.** Prisma v7 requires explicit driver adapters (`@prisma/adapter-pg`). The Trigger.dev deployment container needs the `pg` package (or `@neondatabase/serverless` etc.) available at runtime. Since `modern` mode externalizes `@prisma/client`, confirm that the adapter package and its native dependencies (if any) are included in the deployment image. The `pg` package is pure JS and should bundle fine, but `@prisma/adapter-pg` compatibility with esbuild externalization is worth verifying in a test deployment.

**Self-hosted resource consumption without checkpointing.** For the multi-phase digest pipeline using `triggerAndWait()`, the parent task's container stays alive for the entire duration on self-hosted. With 3 concurrent digests each taking 2–3 minutes, that's 3 containers × 3 minutes of continuous resource consumption. Exact memory footprint per container (base image + Node.js + bundled code) is not documented for typical workloads. Profile this before committing to self-hosted.

**Metadata size limit for progress tracking.** Run metadata is capped at **256 KB** per run. For Redgest, this is ample for progress percentages and phase tracking. But if you plan to store intermediate results (e.g., post titles, summaries) in metadata for real-time display, measure the payload size to stay within limits.

**Trigger.dev Prisma extension version matrix accuracy.** The docs say `modern` mode works with "Prisma 6.20+ / 7.x" but don't specify which Prisma 7.x minor versions have been tested. Prisma 7 is evolving rapidly (v7.0 → v7.3+ in ~3 months). Pin your versions and test deployment before upgrading either package.

**ClickHouse requirement for self-hosted.** The self-hosted Docker Compose includes ClickHouse for observability/metrics. It's unclear whether ClickHouse is optional or required for core functionality. For a personal tool, ClickHouse adds meaningful resource overhead (~1–2 GB RAM). If it's only for dashboard metrics and can be disabled, that reduces the self-hosted footprint significantly. This requires testing or asking in the Trigger.dev Discord.

**Rate limits on `tasks.trigger()` from event handlers.** If the CQRS event bus fires many events in bursts (e.g., bulk import triggers 50 digest requests), the Cloud free tier's **60 API requests/min** limit could throttle your triggers. The paid tier raises this to 1,500/min. For self-hosted, rate limits are configurable via environment variables. Design your event handlers with backpressure or use `tasks.batchTrigger()` (up to 1,000 items per call) for bulk scenarios.