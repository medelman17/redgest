# Tech Debt Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add tech debt capture, prioritization, and surfacing to the redgest-scrum-master skill.

**Architecture:** New `TECH_DEBT.md` file for the register, modifications to 4 skill workflows (new I, modified B/C/D), and CLAUDE.md reference updates. No application code changes.

**Tech Stack:** Markdown files only — skill definition (.claude/skills/) and project management docs (docs/mgmt/pm/).

---

### Task 1: Create and seed TECH_DEBT.md

**Files:**
- Create: `docs/mgmt/pm/TECH_DEBT.md`

**Step 1: Create the file with 3 known debt items**

```markdown
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
```

**Step 2: Verify the file renders correctly**

Run: `cat docs/mgmt/pm/TECH_DEBT.md | head -5`
Expected: Header with "Open: 3 | In Sprint: 0 | Resolved: 0"

**Step 3: Commit**

```bash
git add docs/mgmt/pm/TECH_DEBT.md
git commit -m "docs: create tech debt register with 3 known items"
```

---

### Task 2: Update redgest-scrum-master skill

**Files:**
- Modify: `.claude/skills/redgest-scrum-master/skill.md`

This is the big task. Four changes to the skill file:

**Step 1: Add TECH_DEBT.md to Source-of-Truth Documents section**

After the existing bullet for `Sprints`, add:

```markdown
- **Tech Debt Register**: `docs/mgmt/pm/TECH_DEBT.md`
```

**Step 2: Modify Workflow B (What Should I Work On Next)**

After existing step 5 (ranking algorithm), before step 6 (return top 2-3 tasks), insert a new step:

```markdown
5b. **Tech debt context check**: Read `docs/mgmt/pm/TECH_DEBT.md`. For each top-ranked task, check if any open debt item's "Affected" field overlaps with the task's work stream or package. If overlap found, append a warning after the task recommendation:
   ```
   ⚠ TD-001 (high): insightNotes Zod/Prisma mismatch affects this area — consider fixing first
   ```
   This is informational only — does not change task ranking.
```

**Step 3: Modify Workflow C (Start a Sprint)**

After existing step 3 (select items up to capacity), insert new steps for debt budget:

```markdown
3b. **Calculate debt budget**: Reserve 20% of sprint capacity for tech debt, rounded to nearest 0.5pt. (e.g., 4.5pt capacity → 1pt debt budget, 8pt → 1.5pt).
3c. **Select debt items**: Read `docs/mgmt/pm/TECH_DEBT.md` for open items. Rank by:
   1. High severity + "pay by" matches sprint work streams
   2. High severity without trigger
   3. Medium + matching trigger
   4. Medium without trigger
   5. Low only if budget remains
   Recommend debt items to fill the budget. If no open debt exists, budget rolls into feature capacity.
3d. **Update TECH_DEBT.md**: Move selected debt items from Open → In Sprint section.
```

Also update step 4 to note the new Type column:

```markdown
4. Create/update the sprint entry in `docs/mgmt/pm/SPRINTS.md`:
   - Sprint number, dates, goal, capacity
   - Committed items table with points, **Type (feature/debt)**, and status
```

**Step 4: Modify Workflow D (Mark Task Complete)**

Add a step after existing step 2:

```markdown
2b. **If the task is a debt item (TD-NNN)**: Move it from In Sprint → Resolved in `docs/mgmt/pm/TECH_DEBT.md`. Set the resolved date. Update summary counts in the header.
```

**Step 5: Add new Workflow I (Log Tech Debt)**

Add after Workflow H (Sprint Review / Retro), before the File Format Specifications section:

```markdown
### I. Log Tech Debt

**Triggers**: "tech debt", "log debt", "this is janky", "we should fix this later", "add tech debt"

1. Read `docs/mgmt/pm/TECH_DEBT.md` to find the next sequential TD-NNN ID
2. Ask for (or infer from context):
   - Description: one-line summary of the problem
   - Severity: low / medium / high
   - Affected: which packages or work streams
   - Pay by: optional phase/sprint/work-stream trigger
   - Resolution: what "done" looks like
3. Append to TECH_DEBT.md Open section
4. Update summary counts in the header
5. Confirm: "Logged TD-NNN: description (severity). Affects: area."
```

**Step 6: Add TECH_DEBT.md format to File Format Specifications section**

After the SPRINTS.md format block, add:

````markdown
### TECH_DEBT.md

Location: `docs/mgmt/pm/TECH_DEBT.md`

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

**Severity levels:**
- `high` — Blocks or degrades correctness; fix before affected area is extended
- `medium` — Code smell or inconsistency; fix when working in the area
- `low` — Cosmetic or unavoidable; fix opportunistically or accept
````

**Step 7: Add debt budget rule to Decision Framework section**

After the existing "When deciding whether to defer or pull into sprint" block, add:

```markdown
**Tech debt budget:**
- Reserve 20% of sprint capacity for tech debt (rounded to nearest 0.5pt)
- If no open debt items exist, budget rolls into feature capacity
- Debt priority within budget:
  1. High severity + "pay by" trigger matches current sprint work streams
  2. High severity without trigger
  3. Medium + matching trigger
  4. Medium without trigger
  5. Low only if budget remains
- **Context-trigger rule**: When a feature task touches an affected area of an open debt item, surface it as a warning — not an automatic pull-in
```

**Step 8: Update the skill description frontmatter**

Update the `description` field to include tech debt triggers:

```yaml
description: "Manage the Redgest project backlog, sprint planning, and task prioritization. Use when the user asks: what should I work on next, show the backlog, start a sprint, mark a task as done, what's remaining, project status, show dependencies, next unblocked task, phase progress, sprint velocity, or anything related to Redgest project management and tasking. Also trigger on 'scrum', 'standup', 'backlog grooming', 'sprint review', 'retro', 'tech debt', 'log debt', or 'this is janky'."
```

**Step 9: Verify skill file is valid**

Run: `head -3 .claude/skills/redgest-scrum-master/skill.md`
Expected: YAML frontmatter with updated description including "tech debt"

Run: `grep -c "Workflow" .claude/skills/redgest-scrum-master/skill.md`
Expected: Should show count including new Workflow I references

**Step 10: Commit**

```bash
git add .claude/skills/redgest-scrum-master/skill.md
git commit -m "feat(skill): add tech debt tracking to scrum master — capture, budget, and context warnings"
```

---

### Task 3: Update CLAUDE.md references

**Files:**
- Modify: `CLAUDE.md:166-173` (Project Management section)

**Step 1: Update the Project Management section**

Change:

```markdown
Use the `/redgest-scrum-master` skill for backlog management, sprint planning, and task prioritization. Invoke it when asking "what should I work on next," checking project status, starting/reviewing sprints, marking tasks done, or viewing dependencies. It manages two files:

- `docs/mgmt/pm/BACKLOG.md` — Task backlog with status, effort, dependencies, and acceptance criteria
- `docs/mgmt/pm/SPRINTS.md` — Sprint commitments and velocity tracking

If these files don't exist yet, the skill will bootstrap them from the implementation plan.
```

To:

```markdown
Use the `/redgest-scrum-master` skill for backlog management, sprint planning, task prioritization, and tech debt tracking. Invoke it when asking "what should I work on next," checking project status, starting/reviewing sprints, marking tasks done, viewing dependencies, or logging tech debt. It manages three files:

- `docs/mgmt/pm/BACKLOG.md` — Task backlog with status, effort, dependencies, and acceptance criteria
- `docs/mgmt/pm/SPRINTS.md` — Sprint commitments and velocity tracking
- `docs/mgmt/pm/TECH_DEBT.md` — Tech debt register with severity, affected areas, and resolution criteria

If these files don't exist yet, the skill will bootstrap them from the implementation plan.
```

**Step 2: Verify**

Run: `grep "TECH_DEBT" CLAUDE.md`
Expected: One match in the Project Management section

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add TECH_DEBT.md reference to CLAUDE.md project management section"
```
