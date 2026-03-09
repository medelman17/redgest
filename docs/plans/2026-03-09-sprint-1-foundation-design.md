# Sprint 1 Design: Foundation

**Date**: 2026-03-09
**Sprint Goal**: Stand up the monorepo so all downstream work streams can begin.
**Capacity**: 4.5pt

## Scope

| # | Task | Stream | Points | Deps | Unblocks |
|---|------|--------|--------|------|----------|
| 1 | TurboRepo + pnpm workspaces | WS1 | 0.5 | None | All |
| 2 | package.json for all 10 packages | WS1 | 0.5 | #1 | All |
| 3 | Shared tsconfig/eslint/prettier | WS1 | 0.5 | #1 | All |
| 4 | @redgest/config with Zod schema | WS1 | 1.0 | #1-3 | WS2, WS4, WS5 |
| 5 | .env.example | WS1 | 0.5 | #4 | Testing |
| 6 | Error code registry (@redgest/core) | WS3 | 0.5 | None | WS6, WS7 |
| 7 | Prompt templates (@redgest/llm) | WS5 | 1.0 | None | LLM generate fns |

## Execution Order

- **Sequential**: #1 -> #2 + #3 (parallel) -> #4 -> #5
- **Independent**: #6 and #7 can run in parallel with any other task

## Key Decisions

- **TurboRepo 2.x** with pnpm workspaces (per reconciled plan)
- **10 packages**: config, db, core, reddit, llm, mcp-server, email, slack + 2 apps (web, worker)
- **ESM-only**, TypeScript strict mode
- **Zod config schema** validates all env vars at startup, throws on missing required vars
- Prompt templates use XML structure for triage, markdown for summarization (per LLM pipeline spike)
- Error codes follow the registry defined in the reconciled plan

## Not In Scope

- Prisma schema / migrations (Sprint 2, WS2)
- Reddit API client (Sprint 2, WS4)
- CQRS buses (Sprint 2, WS3)
- Any application logic
