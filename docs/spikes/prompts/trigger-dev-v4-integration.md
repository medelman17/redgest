# Research Task: Trigger.dev v4 Integration Spike for "Redgest"

## Context

I'm building **Redgest**, a personal Reddit digest engine structured as a TurboRepo monorepo. The system uses a CQRS architecture where commands mutate state and emit domain events, and queries read from Postgres views. The primary interface is an MCP (Model Context Protocol) server — a standalone Node.js process that AI agents use to trigger digests, query content, and manage configuration.

**Trigger.dev v4 is our chosen job orchestration layer.** It will handle durable task execution, retries, scheduling, and observability. We're starting with Trigger.dev Cloud (free tier) in Phase 1 and migrating to self-hosted Docker in Phase 2.

The core architectural question this spike must answer: **How does Trigger.dev v4 integrate with a standalone Node.js service (not Next.js, not a framework) that uses CQRS, Prisma v7, and an in-process event bus?**

## System Architecture (Relevant Parts)

### Monorepo Structure
```
redgest/
├── packages/
│   ├── core/           # CQRS infrastructure, domain logic, pipeline orchestration
│   ├── db/             # Prisma v7 schema, client, migrations
│   ├── reddit/         # Reddit API client
│   ├── llm/            # LLM provider abstraction (Vercel AI SDK)
│   ├── mcp-server/     # Standalone MCP server (NOT Next.js)
│   ├── email/          # React Email + Resend
│   └── slack/          # Slack webhook
├── apps/
│   ├── web/            # Next.js config UI (Phase 3, not relevant yet)
│   └── worker/         # Trigger.dev task definitions ← THIS IS THE FOCUS
├── docker-compose.yml
└── turbo.json
```

### CQRS Event Flow
The pipeline works like this:

1. MCP server receives `generate_digest` tool call
2. MCP server creates a `GenerateDigest` command
3. Command handler creates a job record in Postgres (status: `queued`), emits `DigestRequested` domain event, returns `{ jobId }`
4. **Something** (this is the integration point) picks up the `DigestRequested` event and triggers a Trigger.dev task
5. The Trigger.dev task executes the pipeline:
   - Fetches Reddit posts → emits `PostsFetched`
   - Runs LLM triage → emits `PostsTriaged`
   - Runs LLM summarization → emits `PostsSummarized`
   - Assembles digest → emits `DigestCompleted`
6. MCP server polls job status via `get_run_status` tool (reads from Postgres)

### Key Constraints
- **The MCP server is a standalone Node.js process.** It is NOT a Next.js app, Express app, or any web framework. It's built on the MCP SDK (transport TBD — could be Hono, Fastify, or MCP SDK native).
- **Prisma v7** — Rust-free, ESM-native, uses `prisma.config.ts`. The `@redgest/db` package exports the generated Prisma client.
- **In-process event bus** in Phase 1 — a typed EventEmitter pattern in `@redgest/core`. Events like `DigestRequested` are emitted in-process. This bus may be extracted to Postgres LISTEN/NOTIFY or Redis pub/sub in Phase 2.
- **ESM throughout.** TypeScript strict mode.
- **The `apps/worker/` directory** is where Trigger.dev task definitions live. It imports pipeline logic from `@redgest/core`.

### Planned Task Definitions
- **`digest.generate`** — Main pipeline task. Receives job parameters (subreddits, lookback period, delivery channels). Orchestrates the full Reddit fetch → LLM triage → LLM summarize → assemble → deliver pipeline. Long-running (could take 2-5 minutes for 10 subreddits).
- **`digest.schedule`** — Recurring scheduled task. Fires `digest.generate` with default config at configured intervals (e.g., daily at 7am).
- **`digest.deliver`** — Delivery task. Triggered after digest assembly. Sends email (Resend) and/or Slack (webhook) based on configuration.
- **`maintenance.cleanup`** — Periodic maintenance. Prunes old event log entries, refreshes materialized views if applicable.

## Research Questions

### 1. Trigger.dev v4 SDK Integration with Non-Framework Node.js Services

This is the most critical question. Most Trigger.dev documentation and examples show integration with Next.js, Remix, or Express. Our MCP server is none of these.

**Research:**
- How does the Trigger.dev v4 SDK work in a standalone Node.js/TypeScript service that isn't a web framework?
- What is the minimal setup to define tasks and trigger them programmatically from arbitrary Node.js code?
- Does the SDK require an HTTP endpoint for webhooks/callbacks, or can it work purely as an SDK client that triggers tasks and polls status?
- What does `trigger.config.ts` look like for a TurboRepo monorepo where tasks are in `apps/worker/` but business logic is in `packages/core/`?
- How do you deploy/register tasks with Trigger.dev Cloud from a monorepo?
- Is there a distinction between the "task definition runtime" (where tasks execute) and the "trigger client" (where you programmatically trigger tasks)? Can these be in different packages/services?

### 2. Triggering Tasks from the MCP Server

The MCP server needs to trigger `digest.generate` when it receives a `generate_digest` tool call. It also needs to check task/run status when it receives a `get_run_status` tool call.

**Research:**
- What is the API for programmatically triggering a Trigger.dev task from external code? Is it `tasks.trigger()`, `client.sendEvent()`, or something else in v4?
- What does the response look like? Does it return a run ID immediately (our job-based architecture needs this)?
- How do you poll or query the status of a run from external code? Is there a client API for this, or do you need to hit the Trigger.dev API directly?
- Can the MCP server import and use the Trigger.dev client SDK without also being a task execution environment?
- What's the authentication model? API key? How does the MCP server authenticate to Trigger.dev Cloud to trigger tasks?

### 3. Prisma v7 Integration

Trigger.dev has a Prisma extension that was redesigned for v7's Rust-free architecture.

**Research:**
- How does the Trigger.dev Prisma extension work with Prisma v7? What mode should we use (the extension has "legacy", "engine-only", and "modern" modes)?
- Does the extension handle `prisma generate` during deployment, or do we need to run it ourselves?
- Can the Prisma client from our `@redgest/db` package be used inside Trigger.dev tasks, or does Trigger.dev need its own Prisma client instance?
- Are there any issues with Prisma v7's ESM output and Trigger.dev's bundling/deployment?
- How do you configure the extension in `trigger.config.ts` for a monorepo where the Prisma schema is in a separate package?

### 4. Task Execution Model & Long-Running Tasks

Our `digest.generate` task could run for 2-5 minutes (Reddit API rate limiting at 60 req/min, plus LLM calls).

**Research:**
- How does Trigger.dev v4 handle long-running tasks? Is there a timeout? What are the limits on Cloud vs. self-hosted?
- Does v4 use checkpointing? If the task is interrupted, does it resume from a checkpoint or restart from scratch?
- Can a task report progress incrementally (e.g., "3/10 subreddits processed")? We need this for `get_run_status` to return meaningful progress.
- How do you structure a task that has distinct phases (fetch → triage → summarize → assemble → deliver)? Should these be separate steps within one task, separate tasks chained together, or something else?
- What's the retry model? If the LLM call fails on subreddit 7 of 10, can you retry just that part, or does the whole task restart?

### 5. Scheduled Tasks (Cron)

`digest.schedule` needs to fire on a configurable schedule (e.g., daily at 7am, or every 6 hours).

**Research:**
- How do you define a scheduled/recurring task in Trigger.dev v4?
- Can the schedule be changed at runtime (e.g., via MCP `update_config` tool), or is it baked into the task definition?
- What's the cron syntax or scheduling API?
- On Trigger.dev Cloud free tier, are there limits on scheduled tasks?
- When migrating to self-hosted, do scheduled tasks work the same way?

### 6. Event-Driven Task Triggering

Our CQRS architecture emits domain events. In the ideal flow, `DigestRequested` (a domain event) would trigger the `digest.generate` Trigger.dev task. Similarly, `DigestCompleted` would trigger `digest.deliver`.

**Research:**
- Does Trigger.dev v4 have a concept of event-driven triggers (not just manual triggers and cron)?
- Can you send custom events to Trigger.dev that trigger specific tasks?
- If yes, how does this work? Is it `client.sendEvent()` or a different API?
- If Trigger.dev doesn't have native event triggers, what's the recommended pattern? Options:
  - The command handler directly calls `tasks.trigger("digest.generate", payload)` instead of emitting an event
  - The in-process event bus has a handler that listens for `DigestRequested` and calls `tasks.trigger()`
  - Something else?
- What's the cleanest integration point between our event bus and Trigger.dev's task triggering?

### 7. Observability & Status Reporting

The MCP server's `get_run_status` and `list_runs` tools need to report job status, progress, and errors.

**Research:**
- Does Trigger.dev provide an API to query run status, duration, and output from external code?
- Can task metadata (our `jobId`, subreddit progress, error details) be attached to a run and queried later?
- Is there a webhook/callback when a run completes, fails, or changes status? Could this update our Postgres job record?
- What does the Trigger.dev dashboard show? Is it sufficient for debugging, or do we need to build our own observability?
- Can we write to our own Postgres job table from within the task (using the Prisma extension) to maintain our own status tracking parallel to Trigger.dev's?

### 8. Cloud → Self-Hosted Migration

We start with Trigger.dev Cloud in Phase 1 and migrate to self-hosted Docker in Phase 2.

**Research:**
- What exactly changes when migrating from Cloud to self-hosted v4? Config files, environment variables, SDK configuration?
- Is the SDK API identical between cloud and self-hosted, or are there differences?
- What does the self-hosted Docker Compose setup look like? What services are required (Postgres, Redis, object storage, webapp, supervisor, workers)?
- What are the resource requirements? CPU, RAM, disk for a single-user personal tool running a few tasks per day?
- Are there feature differences between Cloud and self-hosted? (The docs mention some features are Cloud-only.)
- Can you run the self-hosted Trigger.dev alongside the application's own Postgres, or does it need a separate Postgres instance?

### 9. Monorepo / Build / Deploy Considerations

**Research:**
- How does Trigger.dev v4 work in a TurboRepo monorepo? Any special configuration needed?
- What does the build and deploy process look like? `npx trigger.dev deploy`? Does it bundle the worker code?
- How does Trigger.dev handle dependencies from other monorepo packages (e.g., `@redgest/core`, `@redgest/db`)?
- Are there known issues with ESM, TypeScript path aliases, or monorepo workspace dependencies?
- What goes in `trigger.config.ts` for our setup?

## Deliverable

Produce a structured report with:

### A. Integration Architecture
A clear diagram (text-based is fine) showing how the MCP server, Trigger.dev (cloud/self-hosted), the worker, and Postgres interact. Show the flow for:
1. MCP `generate_digest` → Trigger.dev task execution → Postgres updates → MCP `get_run_status`
2. Scheduled `digest.schedule` → task execution → delivery

### B. Code Patterns
For each of these, provide working code (not pseudocode) based on the current Trigger.dev v4 SDK:
1. **`trigger.config.ts`** for our monorepo setup with Prisma v7
2. **A task definition** (`digest.generate`) that accepts typed parameters, has distinct steps/phases, reports progress, handles errors per-subreddit, and writes to Postgres via Prisma
3. **Triggering a task from external code** (what the MCP server would call)
4. **Querying run status from external code** (what `get_run_status` would use)
5. **A scheduled task definition** (`digest.schedule`)

### C. Integration Point Recommendation
Given our CQRS event bus architecture, recommend the cleanest pattern for connecting domain events to Trigger.dev task triggers. Evaluate:
- Direct SDK trigger calls from command handlers (bypassing the event bus for this specific case)
- Event bus listener that triggers tasks
- Trigger.dev's native event system (if it exists in v4)

Pick one and justify it.

### D. Migration Playbook
Step-by-step plan for Cloud → self-hosted migration. What changes, what stays the same, what to watch out for.

### E. Risk Register
What could go wrong? Specifically:
- Monorepo/ESM/Prisma v7 compatibility issues
- Long-running task reliability on Cloud free tier
- Self-hosted resource overhead for a personal tool
- Vendor lock-in risk (how hard is it to replace Trigger.dev with something else?)
- Any known v4 bugs or immature features

### F. Open Questions
Anything you couldn't resolve with available information. Flag clearly so we can investigate further.

## Important Notes

- **Trigger.dev v4 is a major architectural change from v3.** Do not rely on v3 documentation or patterns. v4 introduced Run Engine 2, warm starts, and a redesigned self-hosting model. Search specifically for v4 docs and examples.
- The Prisma extension was completely redesigned for v7 support. Search for the latest version and its three modes (legacy, engine-only, modern).
- **Do not rely on training data for Trigger.dev specifics.** The ecosystem has changed significantly through 2025. Search current documentation at trigger.dev/docs, the GitHub repo (triggerdotdev/trigger.dev), and recent blog posts.
- Our worker is in `apps/worker/` in a TurboRepo monorepo. Tasks import business logic from `packages/core/`. This is an unusual setup compared to typical Trigger.dev examples — pay attention to how the SDK handles cross-package imports and bundling.
- I care more about **getting this right** than getting a quick answer. If something is unclear or the docs are contradictory, say so rather than guessing.
