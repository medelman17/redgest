# Research Result Evaluator

## What This Is

A structured evaluation framework for grading deep research spike outputs before you act on them. It detects hand-waving, unsupported claims, training data reliance, missing coverage, and shallow analysis — the failure modes that turn research into expensive mistakes.

Use this after a research spike lands and before you feed its findings into synthesis, implementation, or decision-making.

## When to Use This

- A deep research spike has returned results
- You're about to make implementation decisions based on those results
- You're feeding multiple spike outputs into a synthesis prompt
- You need to decide whether to accept the research, request revisions, or re-run the spike

## The Evaluation Framework

### INPUT

```
SPIKE_PROMPT:     [The original prompt you gave the research agent]
SPIKE_OUTPUT:     [The research report that came back]
TECH_VERSIONS:    [Key technology versions the research should have checked]
KNOWN_CHANGES:    [Any recent changes you're aware of that the research should address]
```

### EVALUATION DIMENSIONS

The evaluator scores the research across seven dimensions, each on a 1-5 scale with specific criteria. Dimensions are weighted by impact — a high score on formatting doesn't compensate for a low score on accuracy.

---

## Dimension 1: Question Coverage (Weight: Critical)

**Does the research actually answer what was asked?**

For each research question in the original prompt, assess:

| Rating | Criteria |
|--------|----------|
| 5 | Question fully answered with specifics, code examples, and nuance. Sub-questions all addressed. |
| 4 | Question answered substantively. Minor sub-questions may be thin but nothing critical is missing. |
| 3 | Question addressed but at surface level. Key sub-questions skipped or given one-sentence treatment. |
| 2 | Question acknowledged but not meaningfully answered. Generic advice instead of specific research. |
| 1 | Question ignored or misunderstood. |

**Procedure:**
1. List every numbered research question from the original prompt.
2. For each, find where in the output it's addressed.
3. Score each question independently.
4. Flag any question scoring ≤2 — these are gaps that need re-research or manual investigation.

**Red flags:**
- A question is "answered" with a single paragraph when the prompt requested detailed analysis
- The answer restates the question as a recommendation without evidence
- Sub-questions are selectively addressed (easy ones answered, hard ones skipped)

---

## Dimension 2: Deliverable Completeness (Weight: Critical)

**Did the research produce the specific artifacts requested?**

For each lettered deliverable in the original prompt, assess:

| Rating | Criteria |
|--------|----------|
| 5 | Deliverable is complete, specific, and directly usable. Code compiles, schemas validate, configs are copy-pasteable. |
| 4 | Deliverable is substantially complete. Minor gaps but the artifact is usable with light editing. |
| 3 | Deliverable exists but is incomplete. Structural outline is there but key details are missing or placeholder. |
| 2 | Deliverable is a description OF the artifact rather than the artifact itself. ("You should create a config file that..." instead of the actual config file.) |
| 1 | Deliverable is missing entirely. |

**Procedure:**
1. List every lettered deliverable from the original prompt.
2. Locate each in the output.
3. Score each independently.
4. Specifically check: did the prompt ask for CODE and the output gave PROSE? This is the #1 deliverable failure mode.

**Red flags:**
- Pseudocode where working code was requested
- "You would do something like..." instead of the actual thing
- Deliverables that describe what they would contain instead of containing it
- Missing the "Open Questions" deliverable (suggests the agent hid uncertainty)

---

## Dimension 3: Source Currency (Weight: High)

**Did the research use current information, or rely on training data?**

| Rating | Criteria |
|--------|----------|
| 5 | Cites specific version numbers, links to current documentation, references recent (< 6 month) changelogs or blog posts. Findings reflect the actual current state of the technology. |
| 4 | Generally current. Version numbers present. Mostly accurate but may have one or two details from a prior version. |
| 3 | Mix of current and stale. Some findings are clearly from training data. Version numbers inconsistent or absent. |
| 2 | Primarily training-data-driven. Technologies described generically without version specificity. Key recent changes missed. |
| 1 | Demonstrably outdated. Describes APIs, patterns, or features that no longer exist or have fundamentally changed. |

**Procedure:**
1. Identify every technology-specific claim in the output.
2. Check: does it reference a specific version? A specific release date? A specific documentation URL?
3. Cross-reference key claims against your own knowledge of recent changes (use KNOWN_CHANGES input).
4. Look for the telltale signs of training data reliance:
   - Hedging language: "as of my last update," "this may have changed," "I believe"
   - Missing version numbers on rapidly-evolving tools
   - Describing a technology's architecture generically rather than its current implementation
   - Recommending patterns from the PREVIOUS major version

**Red flags:**
- The prompt explicitly said "search for current docs" and the output shows no evidence of searching
- Version numbers that don't match the latest release
- Code examples using deprecated APIs
- Recommending a preview/experimental feature as if it's GA (or vice versa)

---

## Dimension 4: Specificity vs. Hand-Waving (Weight: High)

**Does the research give specific, actionable answers or generic advice?**

| Rating | Criteria |
|--------|----------|
| 5 | Concrete specifics throughout. Exact config values, specific function names, real code paths, precise tradeoff quantification. |
| 4 | Mostly specific. Occasional generic statements but they're clearly labeled as areas of uncertainty. |
| 3 | Mix of specific and generic. Key decisions are backed by specifics but supporting details are vague. |
| 2 | Primarily generic. "Best practices" and "it depends" without specifics. Recommendations without evidence. |
| 1 | Entirely generic. Could have been written without any research. Restates common knowledge. |

**Detection patterns for hand-waving:**
- "It's recommended to..." — by whom? Based on what?
- "This is a common pattern..." — show me the pattern, don't tell me it's common
- "You should consider..." — I asked you to consider it and tell me the answer
- "This depends on your specific needs..." — I told you my specific needs in the prompt
- "There are several approaches..." followed by a list with no recommendation
- "In general..." — I didn't ask about the general case

**The specificity test:** For each major recommendation, ask: "Could I implement this TODAY based solely on what's written here?" If the answer is "I'd need to go research more," the recommendation isn't specific enough.

---

## Dimension 5: Intellectual Honesty (Weight: High)

**Does the research acknowledge uncertainty, limitations, and tradeoffs?**

| Rating | Criteria |
|--------|----------|
| 5 | Clear distinction between "I verified this" and "I believe this." Tradeoffs explicitly stated for every recommendation. Open questions deliverable is substantive and non-trivial. |
| 4 | Generally honest. Most recommendations include tradeoffs. Some areas of uncertainty acknowledged. |
| 3 | Selective honesty. Easy tradeoffs acknowledged, hard ones glossed over. Open questions exist but are surface-level. |
| 2 | Overconfident. Recommendations presented without tradeoffs. Uncertainty hidden. Open questions are trivial or absent. |
| 1 | Demonstrably misleading. Claims presented as facts that are actually opinions or guesses. |

**What good intellectual honesty looks like:**
- "The SDK documentation says X, but I found GitHub issues reporting Y in practice."
- "This approach has three tradeoffs: [specific tradeoffs]. Given your constraints, I recommend it anyway because [reason]."
- "I couldn't verify whether this feature is GA in v7. The docs are ambiguous. Test this before committing."
- Open questions that are genuinely hard, not just "you might want to think about performance."

**Red flags:**
- Every recommendation is presented as obviously correct with no alternatives
- "This is the best approach" without acknowledging what it costs
- No open questions in a complex research domain
- Certainty about topics the prompt explicitly flagged as uncertain or fast-moving

---

## Dimension 6: Internal Consistency (Weight: Medium)

**Does the research contradict itself?**

| Rating | Criteria |
|--------|----------|
| 5 | Fully consistent. Recommendations in different sections align. Code examples match architectural descriptions. Types in one deliverable match types in another. |
| 4 | Mostly consistent. Minor discrepancies that don't affect decisions. |
| 3 | Some inconsistencies. A recommendation in one section is undermined by findings in another, but they're resolvable. |
| 2 | Significant inconsistencies. Contradictory recommendations without acknowledgment. Code doesn't match described architecture. |
| 1 | Fundamentally contradictory. The output argues against itself. |

**Common inconsistency patterns:**
- Architecture section describes approach A, code examples implement approach B
- Recommendation says "use X" but risk section says "X has critical issue Y" without resolving the tension
- Type definitions in the schema deliverable don't match types in the code deliverable
- Early sections assume one thing, later sections assume another (context drift in long outputs)

---

## Dimension 7: Actionability (Weight: Medium)

**Could an engineer start implementing based on this research?**

| Rating | Criteria |
|--------|----------|
| 5 | Yes. Clear decisions made, code is implementable, architecture is specific enough to build from, edge cases are addressed. |
| 4 | Mostly. 1-2 areas need clarification but the overall direction is clear and implementable. |
| 3 | Partially. The research is informative but significant design work remains before implementation can start. |
| 2 | Not really. The research describes the landscape but doesn't make decisions. An architect still needs to design the solution. |
| 1 | No. This is a literature review, not a design document. |

**The implementation test:** Imagine handing this output to a senior engineer who knows the tech stack but not the project. Could they start building within an hour? If not, what's missing?

---

## Evaluation Output Format

```markdown
# Spike Evaluation: [SPIKE TOPIC]

## Overall Grade: [A/B/C/D/F]
[1-2 sentence summary: is this spike output trustworthy and actionable?]

## Dimension Scores

| Dimension | Score (1-5) | Weight | Notes |
|-----------|-------------|--------|-------|
| Question Coverage | X | Critical | [key gaps] |
| Deliverable Completeness | X | Critical | [missing/weak deliverables] |
| Source Currency | X | High | [stale areas] |
| Specificity | X | High | [hand-waving areas] |
| Intellectual Honesty | X | High | [confidence concerns] |
| Internal Consistency | X | Medium | [contradictions] |
| Actionability | X | Medium | [implementation gaps] |

## Question-by-Question Coverage

| # | Question | Score | Notes |
|---|----------|-------|-------|
| 1 | [question summary] | X/5 | [what's covered, what's missing] |
| 2 | ... | | |

## Deliverable-by-Deliverable Assessment

| ID | Deliverable | Score | Notes |
|----|------------|-------|-------|
| A | [deliverable name] | X/5 | [what's there, what's missing] |
| B | ... | | |

## Critical Findings

### Things to Trust
[Specific findings that are well-researched, well-sourced, and actionable]

### Things to Verify
[Findings that seem right but weren't adequately sourced or are in fast-moving areas]

### Things to Reject
[Findings that are demonstrably wrong, outdated, or internally contradictory]

### Missing Coverage
[Questions or areas the research should have covered but didn't]

## Recommendation

[ ] **Accept** — Research is solid. Proceed to implementation/synthesis.
[ ] **Accept with caveats** — Research is usable but [specific areas] need manual verification.
[ ] **Revise** — Request targeted follow-up on [specific questions/deliverables].
[ ] **Re-run** — Research is too shallow/stale/inaccurate. Rewrite prompt and re-execute.

## Follow-Up Needed
[Specific questions or tasks needed to fill gaps, listed in priority order]
```

---

## Grading Scale

| Grade | Score Range | Meaning |
|-------|-----------|---------|
| **A** | All critical dimensions ≥4, no dimension ≤2 | Trustworthy and actionable. Proceed. |
| **B** | Critical dimensions ≥3, at most one dimension ≤2 | Usable with targeted verification. |
| **C** | One critical dimension ≤2, OR multiple high dimensions ≤2 | Significant gaps. Revise before acting. |
| **D** | Multiple critical dimensions ≤2 | Unreliable. Re-run with improved prompt. |
| **F** | Any critical dimension = 1 | Actively misleading. Discard and restart. |

---

## Speed Evaluation Mode

When evaluating multiple spikes quickly (e.g., 6 spikes before synthesis), use this abbreviated checklist:

```markdown
## Quick Eval: [SPIKE TOPIC]

### Coverage: [✓ Complete / ⚠ Gaps / ✗ Missing]
Missing: [list uncovered questions by number]

### Currency: [✓ Current / ⚠ Mixed / ✗ Stale]  
Stale areas: [list]

### Specificity: [✓ Concrete / ⚠ Some hand-waving / ✗ Generic]
Vague areas: [list]

### Honesty: [✓ Honest / ⚠ Overconfident / ✗ Misleading]
Concerns: [list]

### Verdict: [Accept / Accept+Verify / Revise / Re-run]
Follow-up: [priority items]
```

This gets you a quality gate in 5 minutes per spike instead of 30.

---

## Using This With the Synthesis Prompt

When feeding spike outputs into a synthesis prompt:

1. Evaluate each spike using at minimum the Speed Evaluation Mode
2. Annotate each spike output with its grade and any caveats before feeding to synthesis
3. For spikes graded "Accept with caveats," include the caveats as instructions to the synthesis agent: "The Trigger.dev spike's claim about X was not adequately sourced. Verify or flag."
4. For spikes graded "Revise," either re-run the spike or note the gaps explicitly so the synthesis agent doesn't build on unreliable foundations
5. Never feed a "Re-run" or "F" grade spike into synthesis. Garbage in, garbage out.
