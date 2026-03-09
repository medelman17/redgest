# Redgest Sprints

## Active Sprint: Sprint 4

**Duration**: 2026-03-09 — 2026-03-16
**Capacity**: 6pt
**Sprint Goal**: Implement command/query handlers and LLM generate functions to fully unblock WS6 (Pipeline)

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Command handlers — GenerateDigest, AddSubreddit, RemoveSubreddit, UpdateSubreddit, UpdateConfig | WS3 | 1.5 | feature | [x] |
| Query handlers — GetDigest, GetPost, GetRunStatus, ListDigests, ListRuns, ListSubreddits, GetConfig, SearchPosts, SearchDigests | WS3 | 1.0 | feature | [x] |
| Provider abstraction — Anthropic + OpenAI registry | WS5 | 0.5 | feature | [x] |
| generateTriageResult() with Output.object() | WS5 | 1.0 | feature | [x] |
| generatePostSummary() with Output.object() | WS5 | 0.5 | feature | [x] |
| Content fetcher — hot/top/rising + comments | WS4 | 1.0 | feature | [x] |

**Committed**: 5.5pt | **Completed**: 5.5pt | **Velocity**: 100%

---

## Previous Sprints

### Sprint 3 (Complete)

**Duration**: 2026-03-09 — 2026-03-16
**Capacity**: 6pt
**Sprint Goal**: Build CQRS infrastructure to unblock the critical path (WS3 → WS6 → WS7 → WS8)

| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| Domain model classes — Command, Query, Event | WS3 | 1.0 | feature | [x] |
| Command bus implementation | WS3 | 1.0 | feature | [x] |
| Query bus implementation | WS3 | 1.0 | feature | [x] |
| Event bus — in-process EventEmitter | WS3 | 1.0 | feature | [x] |
| Token bucket rate limiter — 60 req/min | WS4 | 0.5 | feature | [x] |
| TD-001: insightNotes Zod/Prisma mismatch | WS5/WS2 | 0.5 | debt | [x] |

**Committed**: 5pt | **Completed**: 5pt | **Velocity**: 100%

---

### Sprint 2 (Complete)

**Duration**: 2026-03-09 — 2026-03-16
**Capacity**: 4.5pt
**Sprint Goal**: Stand up the database layer and unblock parallel work on Reddit integration and LLM structured output

| Task | Stream | Points | Status |
|------|--------|--------|--------|
| Create Prisma v7 schema — 8 tables | WS2 | 2.0 | [x] |
| Write prisma.config.ts | WS2 | 0.5 | [x] |
| Reddit API client — script-type auth | WS4 | 1.0 | [x] |
| Zod schemas — ValidatedTriageResult, ValidatedPostSummary | WS5 | 1.0 | [x] |

**Committed**: 4.5pt | **Completed**: 4.5pt | **Velocity**: 100%

---

### Sprint 1 (Complete)

**Duration**: 2026-03-09 — 2026-03-09
**Capacity**: 4.5pt
**Sprint Goal**: Stand up the monorepo so all downstream work streams can begin

| Task | Stream | Points | Status |
|------|--------|--------|--------|
| TurboRepo + pnpm workspaces | WS1 | 0.5 | [x] |
| package.json for all 10 packages | WS1 | 0.5 | [x] |
| Shared tsconfig/eslint/prettier | WS1 | 0.5 | [x] |
| @redgest/config with Zod schema | WS1 | 1.0 | [x] |
| .env.example | WS1 | 0.5 | [x] |
| Error code registry | WS3 | 0.5 | [x] |
| Prompt templates | WS5 | 1.0 | [x] |

**Committed**: 4.5pt | **Completed**: 4.5pt | **Velocity**: 100%

---

### Sprint 0: Planning & Architecture (Complete)

**Duration**: 2026-03-01 — 2026-03-09
**Goal**: Research, spike reconciliation, project setup

**Delivered**:
- 6 parallel research spikes completed
- Reconciled implementation plan (1515 lines, zero conflicts)
- Data model, LLM pipeline, MCP API, UI architecture designed
- Backlog initialized from reconciled plan
- Project management skill created
