# Tech Debt Tracking — Design

> **For Claude:** This is a design doc. Use `superpowers:writing-plans` to create the implementation plan.

**Goal:** Add tech debt capture, prioritization, and surfacing to the redgest-scrum-master skill as a first-class concern alongside feature work.

**Approach:** Separate `TECH_DEBT.md` register + three skill workflow modifications (new capture workflow, sprint budget, context-triggered warnings).

---

## New File: `docs/mgmt/pm/TECH_DEBT.md`

Register of tech debt items organized by status. Items flow: Open → In Sprint → Resolved.

### Format

```markdown
# Redgest Tech Debt Register

**Last Updated**: YYYY-MM-DD
**Open**: N | **In Sprint**: N | **Resolved**: N

## Open

- **TD-001**: Short description (severity)
  Affected: package or work stream | Pay by: phase/WS/sprint or —
  Discovered: YYYY-MM-DD
  Resolution: What "done" looks like

## In Sprint

- **TD-002**: Short description (severity)
  Affected: area | Sprint: N
  Discovered: YYYY-MM-DD
  Resolution: criteria

## Resolved

- **TD-003**: Short description (severity)
  Affected: area | Resolved: YYYY-MM-DD
  Resolution: What was done
```

### Metadata per item

| Field | Required | Description |
|-------|----------|-------------|
| ID | Yes | TD-NNN, sequential |
| Description | Yes | One-line summary of the problem |
| Severity | Yes | low / medium / high |
| Affected | Yes | Package names or work stream IDs |
| Pay by | No | Phase, sprint, or work stream trigger — "fix before this starts" |
| Discovered | Yes | Date found |
| Resolution | Yes | What "done" looks like |
| Status | Implicit | Determined by which section the item is in |

---

## Skill Changes

### New Workflow I: Log Tech Debt

**Triggers**: "tech debt", "log debt", "this is janky", "we should fix this later", "add tech debt"

1. Assign next sequential TD-NNN ID
2. Ask for (or infer from context): description, severity, affected area
3. Optionally set "pay by" trigger if the user mentions when it matters
4. Append to TECH_DEBT.md Open section
5. Update the summary counts in the header
6. Confirm: "Logged TD-NNN: description (severity). Affects: area."

### Modified Workflow C: Start a Sprint

After selecting feature tasks up to capacity:

1. Calculate debt budget: 20% of sprint capacity, rounded to nearest 0.5pt
2. Read TECH_DEBT.md for open items
3. Rank debt items by:
   - High severity + "pay by" matches sprint work streams → first
   - High severity without trigger → second
   - Medium + matching trigger → third
   - Medium without trigger → fourth
   - Low only if budget remains
4. Recommend debt items to fill the budget
5. Move selected items from Open → In Sprint section in TECH_DEBT.md
6. Add to SPRINTS.md committed items table with Type column: `feature` or `debt`
7. If no open debt exists, budget rolls into feature capacity

**SPRINTS.md table format change:**

```markdown
| Task | Stream | Points | Type | Status |
|------|--------|--------|------|--------|
| CQRS command bus | WS3 | 1.0 | feature | [ ] |
| TD-001: insightNotes mismatch | WS5/WS2 | 0.5 | debt | [ ] |
```

### Modified Workflow B: What Should I Work On Next

After ranking feature tasks (existing algorithm unchanged):

1. Read TECH_DEBT.md for open items
2. For each top-recommended feature task, check if any open debt item's "Affected" field overlaps with the task's work stream or package
3. If overlap found, append a "Heads up" note after the recommendation:
   ```
   ⚠ TD-001 (high): insightNotes Zod/Prisma mismatch affects this area — consider fixing first
   ```
4. This is informational only — does not change the task ranking or auto-pull debt items

### Workflow D: Mark Task Complete (minor addition)

When completing a task that is a debt item (TD-NNN):
1. Move from In Sprint → Resolved in TECH_DEBT.md
2. Set resolved date
3. Update summary counts

---

## Decision Framework Addition

**Debt budget rule:** 20% of sprint capacity reserved for tech debt, rounded to nearest 0.5pt. If no open debt items exist, budget rolls into feature capacity.

**Debt priority within budget:**
1. High severity + "pay by" trigger matches current sprint work streams
2. High severity without trigger
3. Medium + matching trigger
4. Medium without trigger
5. Low only if budget remains

**Context-trigger rule:** When a feature task touches an affected area of an open debt item, surface it as a warning. The developer decides whether to address it — not an automatic pull-in.

---

## Unchanged Workflows

- **A. Project Status** — No change (reads BACKLOG.md and SPRINTS.md as before)
- **E. Mark Task In Progress** — No change
- **F. Show Dependencies** — No change
- **G. Show Backlog** — No change (tech debt has its own file)
- **H. Sprint Review** — No change (already reads SPRINTS.md which will include debt items via Type column)

---

## Initial Tech Debt Items

Seed TECH_DEBT.md with known items from Sprint 2:

| ID | Description | Severity | Affected | Pay by |
|----|-------------|----------|----------|--------|
| TD-001 | insightNotes is z.array(z.string()) in Zod but String @db.Text in Prisma | high | @redgest/llm, @redgest/db | WS6 |
| TD-002 | Docker Compose Postgres mapped to port 5433 instead of 5432 | low | infra | — |
| TD-003 | globalThis as unknown as cast in db/client.ts (Prisma singleton pattern) | low | @redgest/db | — |
