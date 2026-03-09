# Research Revision Prompt Generator

## What This Is

A system for converting research evaluation feedback into targeted follow-up prompts. When a spike comes back graded "Accept with caveats" or "Revise," this tool generates a precise follow-up prompt that addresses exactly what was weak — without re-running the entire spike from scratch.

This is the repair loop in the pipeline:

```
Generate Prompt → Execute Spike → Evaluate Results → THIS TOOL → Re-execute (targeted) → Re-evaluate
                                       ↓
                                  Accept → Synthesis
```

## When to Use This

| Evaluation Grade | Action |
|-----------------|--------|
| **Accept** | Don't use this. Proceed to synthesis. |
| **Accept with caveats** | Use LIGHT mode. Produce a short follow-up targeting only the caveated areas. |
| **Revise** | Use STANDARD mode. Produce a focused follow-up covering all gaps and weak areas. |
| **Re-run** | Don't use this. Rewrite the original spike prompt using the Deep Research Prompt Generator. The original prompt was the problem, not just the output. |
| **F** | Don't use this. Discard and start over. |

## The Core Principle

**A revision prompt is NOT a re-run.** It's a surgical follow-up that:

1. **Preserves what worked.** Don't re-ask questions that were well-answered.
2. **Targets what failed.** Zero in on specific gaps, stale claims, and hand-waved areas.
3. **Provides the original output as context.** The revision agent should BUILD ON the original research, not redo it.
4. **Escalates specificity.** If the original answer was vague, the follow-up prompt should be more specific, not just repeat the same question louder.

---

## INPUT

```
ORIGINAL_PROMPT:     [The spike prompt you originally gave]
ORIGINAL_OUTPUT:     [The research report that came back]
EVALUATION:          [Your evaluation output — scores, gaps, follow-ups]
REVISION_MODE:       [LIGHT or STANDARD]
```

---

## Revision Prompt Structure

Every revision prompt follows this skeleton:

```markdown
# Follow-Up Research: [TOPIC] — Addressing [GAPS/CAVEATS]

## Context & Prior Research
[Brief framing + reference to original output]

## What Was Well-Covered (Do Not Re-Research)
[Explicit list of things to preserve]

## What Needs Work
[Categorized by failure type]

## Targeted Research Questions
[New, more specific questions]

## Targeted Deliverables
[Only the artifacts that were missing or weak]

## Important Notes
[Calibration + guardrails]
```

---

## Section-by-Section Guide

### 1. CONTEXT & PRIOR RESEARCH

**Purpose:** Give the revision agent the full picture without making it re-do everything.

**Pattern:**
```markdown
You previously conducted deep research on [TOPIC] for [PROJECT]. Your research
was [generally strong / partially useful / mixed]. This follow-up addresses
specific gaps identified during evaluation.

Your original research is provided below as [ORIGINAL_OUTPUT]. Treat it as
your starting foundation — build on it, don't replace it. The areas that need
work are explicitly listed in this prompt.
```

**Key decision: Do you include the full original output?**

- **LIGHT mode:** Include only the relevant sections — the parts that need revision plus the parts they depend on for context. Reduces token budget for the revision agent.
- **STANDARD mode:** Include the full original output. The revision agent needs the complete picture to avoid contradicting its own earlier findings.

If the original output is very long (15K+ tokens), include a summary of the well-covered sections and the full text only of the sections needing revision.

### 2. WHAT WAS WELL-COVERED

**Purpose:** Prevent the revision agent from re-doing work that was already good. This is the most important section — without it, revision prompts degenerate into re-runs.

**Pattern:**
```markdown
## What Was Well-Covered (Do Not Re-Research)

The following areas from your original research are solid and should be
preserved as-is. Reference them but do not re-investigate:

- ✅ [Question/topic 1] — Your analysis of X was thorough and well-sourced.
- ✅ [Question/topic 2] — The code examples for Y are correct and implementable.
- ✅ [Deliverable A] — The schema you provided is complete and validated.
```

**Be specific.** Don't just say "most of it was fine." List exactly what was good. This anchors the revision agent and protects your time investment in the original spike.

### 3. WHAT NEEDS WORK

**Purpose:** Categorize the problems by failure type. Different failure types require different revision strategies.

**Failure Type Taxonomy:**

#### Type 1: UNANSWERED — Question was skipped or superficially addressed

**Cause:** The agent ran out of attention, the question was buried late in the prompt, or it was hard and the agent avoided it.

**Revision strategy:** Re-ask the question with MORE specificity and context. If the original question had 4 sub-bullets, break it into 8 sub-bullets. Add "why this matters" framing.

**Template:**
```markdown
### Unanswered: [Original Question N]

Your original research [didn't address this / gave a one-paragraph response to
what needed deep analysis]. This question matters because [specific downstream
dependency].

[Re-state the question with additional specificity, context, and sub-questions]
```

#### Type 2: STALE — Answer relies on outdated information

**Cause:** The agent used training data instead of searching, or searched but found outdated sources.

**Revision strategy:** Make the search instruction more explicit. Name specific URLs, version numbers, and recent events the agent should verify against.

**Template:**
```markdown
### Stale: [Topic]

Your original research describes [TECHNOLOGY] as [WHAT THEY SAID], but this
appears to be based on [VERSION/DATE]. As of [CURRENT_DATE], [WHAT HAS CHANGED
or WHAT TO VERIFY].

Please search specifically for:
- [SPECIFIC_URL] for current documentation
- [PACKAGE_NAME]@latest on npm — check the current version number
- [GITHUB_REPO] releases page for changes since [DATE]

Update your findings on [specific claims to re-verify].
```

#### Type 3: HAND-WAVED — Answer is generic where specifics were needed

**Cause:** The agent didn't have (or didn't find) specific information and filled space with generic advice.

**Revision strategy:** Call out the specific vague claims and ask for concrete specifics. Provide examples of the level of detail you need.

**Template:**
```markdown
### Vague: [Topic]

Your original research said: "[QUOTE THE VAGUE CLAIM]"

This isn't specific enough to implement. I need:
- [SPECIFIC THING 1]: exact config value, not "configure appropriately"
- [SPECIFIC THING 2]: working code example, not "you would use the X API"
- [SPECIFIC THING 3]: actual tradeoff quantification, not "there are tradeoffs"

[If helpful, provide an example of the specificity level you need from a
different part of the research that WAS good]
```

#### Type 4: CONTRADICTORY — Answer conflicts with itself or with known facts

**Cause:** Long output with context drift, or the agent found conflicting sources and didn't reconcile them.

**Revision strategy:** Quote both sides of the contradiction and ask the agent to resolve it explicitly.

**Template:**
```markdown
### Contradiction: [Topic]

In your original research:
- In section [X], you stated: "[CLAIM A]"
- In section [Y], you stated: "[CLAIM B]"

These conflict. [Explain how they conflict]. Please:
1. Determine which is correct (search current sources if needed)
2. Update the incorrect section
3. Explain why the contradiction occurred (e.g., different versions, different contexts)
```

#### Type 5: MISSING DELIVERABLE — Requested artifact wasn't produced

**Cause:** Agent forgot, ran out of output space, or produced prose where code was requested.

**Revision strategy:** Re-request the specific deliverable with even more explicit format instructions.

**Template:**
```markdown
### Missing: Deliverable [LETTER] — [NAME]

The original prompt requested [SPECIFIC ARTIFACT]. Your research
[didn't include it / provided a description instead of the actual artifact].

Please produce the actual artifact:
- Format: [code / schema / config file / TypeScript interface / SQL]
- Must include: [specific elements]
- Level of detail: [production-ready / working example / validated pseudocode]

[If the agent provided prose, quote it and say:]
You wrote: "[THEIR PROSE DESCRIPTION]"
Convert this into the actual [code/schema/config]. Don't describe it — produce it.
```

#### Type 6: UNVERIFIED — Claims that might be right but aren't sourced

**Cause:** Agent stated something confidently but didn't cite where the information came from.

**Revision strategy:** Ask for explicit verification with sources.

**Template:**
```markdown
### Unverified: [Claim]

You stated: "[THE CLAIM]"

This is plausible but unsourced. Please:
1. Verify this against current documentation
2. Cite the specific source (URL, doc page, GitHub issue)
3. If you can't verify it, say so explicitly and flag it as an open question
```

### 4. TARGETED RESEARCH QUESTIONS

**Purpose:** New questions that emerged from the evaluation, or refined versions of original questions that weren't answered well.

**Key principle: ESCALATE SPECIFICITY.**

If the original question was:
> "How does Prisma v7 handle views?"

And the answer was hand-waved, the revision question should be:
> "Pull up the Prisma v7 documentation for views. Is the `views` preview feature GA in v7? Show me the exact `schema.prisma` syntax for defining a view model. Does `prisma db pull` introspect existing views? Can a view model have `@relation` fields to regular models? Show me a working example of querying a view through the Prisma client — the actual generated method name and return type."

The escalation pattern: **WHAT → HOW EXACTLY → SHOW ME THE CODE**

### 5. TARGETED DELIVERABLES

**Purpose:** Only request deliverables that were missing or weak. Don't re-request good ones.

**Pattern:**
```markdown
## Targeted Deliverables

### A. [REVISED: Deliverable X from original]
[What was wrong with the original + what the corrected version should include]

### B. [NEW: Deliverable that emerged from evaluation gaps]
[What's needed and why]

Note: Deliverables [C, D, F] from the original research are solid.
Do not reproduce them — they stand as-is.
```

### 6. IMPORTANT NOTES

**Pattern:**
```markdown
## Important Notes

- **Build on your original research.** Don't start from scratch. Your findings
  on [GOOD AREAS] are solid. This follow-up is surgical, not a redo.
- **[SPECIFIC CURRENCY WARNING if applicable]**
- **If you still can't answer [HARD QUESTION] after searching, say so
  explicitly.** An honest "I can't determine this from available documentation"
  is more useful than a confident guess.
- **Focus your effort on [TOP 2-3 PRIORITIES].** These are the gaps that block
  implementation.
```

---

## Mode Templates

### LIGHT Mode (Accept with Caveats)

For 1-3 targeted fixes. Usually 500-1500 words of follow-up prompt.

```markdown
# Follow-Up: [TOPIC] — [1-2 WORD ISSUE SUMMARY]

Your research on [TOPIC] was strong overall. [1 sentence on what was good].
[1 sentence on what needs fixing].

Your original research is below for reference. Do not re-do the parts that
are solid — only address the specific items listed here.

## Fix Needed

### 1. [ISSUE]
[Description using the failure type template above]

### 2. [ISSUE] (if applicable)
[Description]

## Updated Deliverable Needed

[Only if a deliverable needs revision]

## Notes
- This is a targeted fix, not a re-run. Keep it focused.
- [Any specific search/verification instructions]

---

## Original Research (Reference)

[PASTE ORIGINAL OUTPUT — or relevant sections only]
```

### STANDARD Mode (Revise)

For 3-6+ issues across multiple failure types. Usually 1500-4000 words of follow-up prompt.

```markdown
# Follow-Up Research: [TOPIC] — Revision

## Context

You conducted deep research on [TOPIC] for [PROJECT]. The research was
evaluated and found to be [SUMMARY: e.g., "strong on architecture but weak on
implementation specifics, with some stale information about X"].

This follow-up targets [N] specific areas that need improvement before the
research can be used for implementation. Your original output is included
below — build on it, don't replace it.

## What Was Well-Covered (Preserve As-Is)

- ✅ [Good area 1]
- ✅ [Good area 2]
- ✅ [Good area 3]

## What Needs Work

### [FAILURE TYPE]: [Issue 1]
[Using the appropriate failure type template]

### [FAILURE TYPE]: [Issue 2]
[Using the appropriate failure type template]

### [FAILURE TYPE]: [Issue 3]
[Using the appropriate failure type template]

[Continue for all issues]

## Targeted Research Questions

[Only NEW or REFINED questions — not repeats of well-answered originals]

### 1. [Refined/new question]
[With escalated specificity]

## Targeted Deliverables

### [LETTER]. [Revised or new deliverable]
[Specific artifact request]

Deliverables [LIST] from the original are solid — do not reproduce.

## Important Notes

- Build on your original research, don't restart.
- Priority issues (focus here first): [TOP 2-3]
- [Technology-specific search instructions]
- If you still can't resolve [HARD_THING], flag it as an open question.

---

## Original Research (Reference)

[PASTE FULL ORIGINAL OUTPUT]
```

---

## Iteration Limits

**Maximum revision cycles: 2.**

If a spike still isn't usable after two revision rounds:
- The original prompt was poorly scoped → rewrite it using the Deep Research Prompt Generator
- The topic genuinely can't be researched by an LLM (needs hands-on experimentation) → convert to an implementation spike instead
- The technology's documentation is too poor → accept the uncertainty and flag it as a project risk

**Track the revision chain:**
```
Spike v1 → Eval: Revise (3 gaps) → Revision v1 → Eval: Accept with caveats (1 gap) → Light fix → Accept
```

This gives you a clear history of what was hard to research and why — useful for calibrating future spike prompts.

---

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|-------------|-------------|-----|
| Re-pasting the entire original prompt as the revision | Agent re-does everything, ignoring what was good | Explicitly list what to preserve and what to fix |
| "Try harder on question 5" | No additional specificity, gets the same result | Escalate specificity: break into sub-questions, provide examples of desired detail level |
| Revision prompt is longer than the original | You're writing a new spike, not revising | If > 50% needs re-doing, rewrite the original prompt instead |
| Not including the original output | Revision agent starts from scratch, may contradict good findings | Always include original output (full or relevant sections) |
| Revising things that were actually fine | Wastes the agent's attention budget on non-issues | Be explicit about what to preserve |
| "Fix all the issues" without categorization | Agent doesn't know which issues are critical vs. minor | Categorize by failure type, state priority order |
| Three+ revision cycles | Diminishing returns, compounding confusion | Cap at 2 revisions, then rewrite or accept risk |
