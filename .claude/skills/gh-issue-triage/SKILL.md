---
name: gh-issue-triage
description: >
  Triage GitHub issues, pick the highest-impact one, systematically debug it, scan adjacent code
  for related problems, and surface new issues. Use PROACTIVELY when the user asks about GitHub
  issues, wants to work on bugs, says "triage issues", "check GH issues", "what's open",
  "work on an issue", "fix a bug", or anything involving reviewing and resolving open issues.
  Also use when the user finishes a task and asks "what's next" if there are known open issues.
---

# GitHub Issue Triage & Resolution

A structured workflow for triaging open GitHub issues, resolving the highest-impact one, and
discovering new issues through adjacent code review. The goal is to leave the codebase better
than you found it — every investigation should surface insights, not just close tickets.

## Workflow

### Phase 1: Gather Context

Before looking at issues, build context from prior work and project state.

1. **Check episodic memory** — Search for past debugging sessions, prior issue resolutions,
   and patterns already identified. Use `episodic-memory:search-conversations` if available.

2. **Read project management state** — Check backlog, tech debt register, and sprint status
   if the project uses them. For Redgest, invoke `/redgest-scrum-master` for current status.

3. **List open issues** — Run `gh issue list --state open` and `gh issue view <N>` for each.
   Capture: title, labels, age, description, related issues/PRs.

### Phase 2: Triage

Classify every open issue before picking one. This prevents tunnel vision and surfaces patterns.

1. **Check for already-resolved issues** — Cross-reference with recent commits (`git log`).
   If an issue was fixed but not closed, close it with a comment pointing to the commit.

2. **Group by root cause** — Multiple issues may share an underlying cause. Flag these clusters —
   fixing the root cause resolves them all. This is the highest-leverage work.

3. **Classify remaining issues:**

   | Priority | Criteria |
   |----------|----------|
   | P0 | Data loss, security, broken core functionality |
   | P1 | User-facing bugs that degrade experience |
   | P2 | Internal code quality, DRY violations, tech debt |
   | P3 | Nice-to-haves, cosmetic, future improvements |

4. **Present a summary table** to the user:
   ```
   | # | Title | Priority | Type | Quick win? | Recommendation |
   ```
   Recommend which issue to tackle and explain why (unblocks others, shared root cause,
   quick win, etc.). **Wait for user confirmation before proceeding.**

### Phase 3: Prepare for Investigation

After the user picks an issue, prepare before writing any code.

1. **Load relevant skills** — Based on the issue's domain, search for and invoke applicable skills:
   - Bug in React/Next.js UI? → `react-dev`, `next-best-practices`, `vercel-react-best-practices`
   - API or backend issue? → `architecture-patterns`, `api-scaffolding:backend-architect`
   - Database issue? → `database-design:postgresql`
   - Performance issue? → `application-performance:performance-optimization`
   - Security concern? → `comprehensive-review:security-auditor`
   - General code quality? → `engineering-mode`

   Load 1-2 skills maximum — enough to inform the approach, not so many they conflict.
   The skill gives you domain expertise; systematic-debugging gives you the process.

2. **Invoke `superpowers:systematic-debugging`** — This is non-negotiable. Follow its four
   phases rigorously: root cause investigation, pattern analysis, hypothesis testing,
   implementation. No fixes without understanding the cause first.

### Phase 4: Adjacent Area Scan

After identifying the root cause (but before or after fixing), scan for the same pattern elsewhere.
This is where most of the value comes from — one bug often reveals a category of bugs.

1. **Search for the pattern** — Use `Grep` to find all instances of the problematic pattern
   across the codebase. For example, if the bug was a misuse of `revalidatePath`, search for
   all `revalidatePath` calls and audit each one.

2. **Check related components** — If the bug was in one page/component, check sibling
   pages/components that were likely written the same way.

3. **Assess each finding:**
   - Is it the same bug? → Fix it in the same commit or a follow-up.
   - Is it a latent risk? → Note it for issue creation.
   - Is it fine in context? → Move on.

4. **Document findings** — Keep a running list of everything discovered. You'll present this
   to the user in Phase 6.

### Phase 5: Fix, Verify, Commit

1. **Fix the root cause** — Not the symptom. One focused change.

2. **Invoke `superpowers:verification-before-completion`** — Run tests, typecheck, lint.
   For UI bugs, also verify visually if possible (describe what the user should check).

3. **Commit with issue reference** — Use `Closes #N` in the commit message body.
   Follow the project's commit message conventions.

4. **Close the issue** — With a comment explaining the root cause, the fix, and the commit ref.

### Phase 6: Surface Discoveries

Present all adjacent findings to the user. For each finding:

- What the concern is (one sentence)
- Where in the code it lives (file:line)
- Severity: bug, latent risk, code quality, or improvement opportunity
- Suggested fix (brief)

**Ask the user** which findings should become:
- **GitHub issues** — For bugs and risks that need tracking
- **Tech debt entries** — For code quality concerns (if project uses a debt register)
- **Immediate fixes** — For trivial fixes that can be committed now
- **Ignored** — For acceptable tradeoffs

Create issues/debt entries only after user approval. Use a consistent issue template:

```markdown
## Description
[One paragraph explaining the problem]

## Steps to Reproduce (for bugs)
[Numbered steps]

## Impact
[Who/what is affected and how]

## Likely Fix
[Brief technical approach]

## Found During
[Which issue investigation surfaced this — cross-reference]
```

### Phase 7: Update Project State

If the project tracks work formally:

1. **Update backlog** — Mark resolved items done, add new items for created issues.
2. **Update tech debt register** — Add new entries, resolve fixed ones.
3. **Update memory** — Save patterns discovered for future sessions.

## When to Stop

One issue per invocation is the default. After closing one issue and surfacing findings,
summarize what was done and ask if the user wants to continue with another issue or stop.

## Triage-Only Mode

If the user just wants a status report ("show me the issues", "what's open"), run only
Phases 1-2. Present the summary table and stop. Don't pick an issue or start debugging
unless asked.
