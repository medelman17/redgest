# Redgest Tech Debt Register

**Last Updated**: 2026-03-09
**Open**: 3 | **In Sprint**: 0 | **Resolved**: 0

---

## Open

- **TD-001**: insightNotes is z.array(z.string()) in Zod but String @db.Text in Prisma (high)
  Affected: @redgest/llm, @redgest/db | Pay by: WS6
  Discovered: 2026-03-09
  Resolution: Reconcile types — either change Prisma schema to Json[] or change Zod to single string. Must be consistent before summarization pipeline stores results.

- **TD-002**: Docker Compose Postgres mapped to port 5433 instead of 5432 (low)
  Affected: infra | Pay by: —
  Discovered: 2026-03-09
  Resolution: Document the port override in .env.example and docker-compose.yml comments. Or detect available port. Low priority — only affects local dev.

- **TD-003**: globalThis as unknown as cast in db/client.ts — Prisma singleton pattern (low)
  Affected: @redgest/db | Pay by: —
  Discovered: 2026-03-09
  Resolution: Unavoidable with current Prisma singleton pattern. Monitor for alternatives in Prisma v7+ releases. Exempt from lint rules per CLAUDE.md TypeScript Standards.

---

## In Sprint

(none)

---

## Resolved

(none)
