# Redgest Tech Debt Register

**Last Updated**: 2026-03-10
**Open**: 2 | **In Sprint**: 0 | **Resolved**: 4

---

## Open

- **TD-003**: globalThis as unknown as cast in db/client.ts — Prisma singleton pattern (low)
  Affected: @redgest/db | Pay by: —
  Discovered: 2026-03-09
  Resolution: Unavoidable with current Prisma singleton pattern. Monitor for alternatives in Prisma v7+ releases. Exempt from lint rules per CLAUDE.md TypeScript Standards.

- **TD-005**: Worker task files have no unit tests (medium)
  Affected: apps/worker | Pay by: WS8 extension or next sprint touching worker
  Discovered: 2026-03-10
  Resolution: Add Vitest tests for generate-digest, deliver-digest, and scheduled-digest tasks. Mock Prisma, pipeline deps, and Trigger.dev SDK. Verify payload handling, error paths, and idempotency key generation.

---

## In Sprint

(none)

---

## Resolved

- **TD-001**: insightNotes is z.array(z.string()) in Zod but String @db.Text in Prisma (high)
  Affected: @redgest/llm, @redgest/db | Resolved: 2026-03-09
  Resolution: Reconciled in Sprint 3. Changed Zod schema to match Prisma's String type. insightNotes stored as JSON-serialized string array in a single Text column.

- **TD-002**: Docker Compose Postgres mapped to port 5433 instead of 5432 (low)
  Affected: infra | Resolved: 2026-03-10
  Resolution: Documented port 5433 mapping in docker-compose.yml comments and README. Ref: 5bb77a0.

- **TD-006**: trigger.config.ts has hardcoded project ID (low)
  Affected: apps/worker | Resolved: 2026-03-10
  Resolution: Extracted to `TRIGGER_PROJECT_ID` env var with fallback. Ref: 5e69f5a.

- **TD-007**: sanitizeContent() missing JSDoc for security context (low)
  Affected: @redgest/reddit | Resolved: 2026-03-10
  Resolution: Added JSDoc explaining prompt injection defense purpose. Ref: 0cd7044.
