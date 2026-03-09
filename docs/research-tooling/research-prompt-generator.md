# Deep Research Prompt Generator

## What This Is

A reusable system for generating high-quality deep research prompts — the kind you hand to an AI agent with extended thinking to produce thorough, actionable technical research. This generator codifies patterns extracted from six successful spike prompts that consistently produced strong results across infrastructure, design, and implementation research.

## When to Use This

Use this when you need to research a technical topic that has:
- **Unknown unknowns** — you don't know what you don't know
- **Fast-moving technology** — training data may be stale
- **Integration complexity** — the topic touches multiple systems
- **Design decisions** — there are alternatives to evaluate
- **Implementation risk** — getting it wrong is expensive to fix

Do NOT use this for topics where you already know the answer and just need execution, or for well-documented patterns where reading the docs is faster than generating a prompt.

---

## The Generator

To produce a deep research prompt, fill in the sections below. Each section includes the structural pattern, guidance on calibrating depth, and examples drawn from real successful prompts.

### INPUT YOU PROVIDE

```
PROJECT_NAME:        [Name of the project]
PROJECT_DESCRIPTION: [1-2 sentence description]
SPIKE_TOPIC:         [What you're researching]
ARCHITECTURE_CONTEXT:[Relevant system architecture — ONLY the parts that touch this spike]
TECH_STACK:          [Key technologies with version numbers]
CONSTRAINTS:         [Hard requirements the research must respect]
CURRENT_DESIGN:      [What you've already decided/proposed — the starting point to validate]
RISK_CONCERNS:       [What you're worried about — the "why" behind this spike]
```

### OUTPUT STRUCTURE

Every generated prompt follows this skeleton. Sections scale up or down based on complexity, but the structure is invariant.

```markdown
# Research Task: {VERB} {TOPIC} for "{PROJECT_NAME}"

## Context                          ← What the researcher needs to know
## System Architecture              ← Where this spike fits in the system
## Current Design / Starting Point  ← What exists to validate or improve
## Research Questions               ← Numbered, specific, answerable
## Deliverables                     ← Lettered, concrete, actionable
## Important Notes                  ← Guardrails, warnings, calibration
```

---

## Section-by-Section Pattern Guide

### 1. CONTEXT

**Purpose:** Give the researcher enough understanding of the project to make informed decisions, but not so much that the context drowns the actual questions.

**Pattern:**
- Open with what the project IS in 2-3 sentences
- State what the spike topic IS and why it matters to the project
- State who/what consumes the output of this subsystem

**Calibration:**
- For infrastructure spikes (frameworks, ORMs, job systems): focus on deployment constraints, runtime environment, and what the technology must integrate with.
- For design spikes (API surfaces, data models): focus on the consumers — who calls this, what do they expect, what are the access patterns.
- For algorithm/logic spikes (LLM pipelines, business logic): focus on inputs, outputs, quality requirements, and failure modes.

**Anti-patterns:**
- Don't dump the entire project architecture. Only include what's relevant.
- Don't explain basics the researcher already knows (e.g., "MCP is a protocol created by Anthropic" is fine; explaining what a protocol is, is not).
- Don't include aspirational features that don't affect this spike.

**Example calibration (good):**
> The MCP server is a standalone Node.js process that exposes 12 tools for AI agents. It is NOT embedded in a web framework. It runs as its own Docker container.

**Example calibration (too much):**
> The MCP server is one of 8 packages in our TurboRepo monorepo alongside a Next.js config UI, a Trigger.dev worker, a Reddit API client, an LLM abstraction layer, a React Email package, a Slack webhook formatter, and shared configuration. The monorepo uses pnpm workspaces and... [200 words of irrelevant detail]

### 2. SYSTEM ARCHITECTURE

**Purpose:** Show where this spike fits in the larger system. The researcher needs to understand boundaries — what's upstream, what's downstream, what's adjacent.

**Pattern:**
- A directory tree of the monorepo/project (truncated to relevant parts)
- A data flow diagram (text-based) showing how data moves through the system, with the spike's subsystem highlighted
- A table of consumers/dependencies if multiple systems touch this subsystem
- Technology constraints stated as facts, not preferences

**Key principle: Show the SEAMS.** The most important information is where this subsystem connects to other subsystems. These connection points are where integration risks hide.

**Example (effective):**
```
@redgest/reddit (fetch candidates)
    ↓ typed RedditPost[] with metadata
@redgest/llm Pass 1: triage(candidates, insightPrompts) → TriagedPost[]  ← THIS SPIKE
    ↓ selected post IDs + rationale
@redgest/reddit (fetch full content + comments for selected posts)
    ↓ typed RedditPost[] with body + Comment[]
@redgest/llm Pass 2: summarize(posts, insightPrompts) → PostSummary[]    ← THIS SPIKE
    ↓ structured summaries
@redgest/core (assemble digest, persist, deliver)
```

### 3. CURRENT DESIGN / STARTING POINT

**Purpose:** Give the researcher something to react to rather than starting from a blank page. This dramatically improves output quality — the researcher can validate, critique, and improve a proposal much more effectively than inventing one from scratch.

**Pattern:**
- Present what you've already decided (from a PRD, prior conversation, etc.)
- Mark it explicitly as "proposed — needs validation"
- Include enough detail to be critiqueable: types, schemas, tables, API shapes
- Note any areas where you're uncertain or where alternatives exist

**Key principle: OPINIONATED STARTING POINTS produce better research than open-ended questions.** "Is this the right schema?" produces better output than "Design a schema." The researcher can say "yes, but change X" or "no, here's why" — both are more useful than an unconstrained design.

**Anti-pattern:**
- Don't present the starting point as final. The researcher should feel empowered to restructure, not just tweak.
- Don't present a starting point you're not willing to change. If it's a hard requirement, put it in Constraints.

### 4. RESEARCH QUESTIONS

**Purpose:** Direct the researcher's attention to the specific unknowns that matter. These are the questions that, if answered well, resolve the spike.

**The Art of Good Research Questions:**

**Specificity over breadth.** Bad: "Research how Prisma works." Good: "How does Prisma v7's view support work? Is it GA or preview? Can views have relations to other models? How do you query a view?"

**Layer the questions from foundational to advanced:**
1. Start with **"current state"** questions — what does the technology actually look like right now? (This combats stale training data.)
2. Move to **"integration"** questions — how does it work in OUR specific setup?
3. Then **"design"** questions — given the constraints, what's the best approach?
4. End with **"risk/operations"** questions — what can go wrong? How to test? How to migrate?

**Include the "why" in the question.** Instead of "Should we use streaming?", ask "Should the pipeline use `generateObject()` (blocking) or `streamObject()` (streaming)? For triage, blocking is probably fine — the result is small. For summarization, streaming could enable progressive updates. But we're running in a background worker, not a UI. Is streaming useful in this context?"

The "why" gives the researcher your reasoning to validate or challenge.

**Quantity:** 8-12 questions is the sweet spot. Fewer than 6 means the spike is too narrow for deep research (just read the docs). More than 15 means the spike should be split into two.

**Embed sub-questions as bullets.** Each top-level question should have 3-6 specific sub-questions that break it down into answerable units.

**Name the alternatives.** When there are known options, list them. "Option A: X. Option B: Y. Option C: Z. Evaluate each." This prevents the researcher from fixating on one approach.

**Include at least one "what could go wrong" question.** Every spike should have a risk/failure-mode question. "What happens when structured output fails?" "What if the API is deprecated?" "What are the known issues in production?"

### 5. DELIVERABLES

**Purpose:** Tell the researcher what artifact to produce. This is the most important section for output quality — vague deliverables produce vague output.

**Pattern:**
- Letter each deliverable (A, B, C, ...)
- 6-8 deliverables per spike
- Each deliverable is a specific artifact type: code, schema, diagram, recommendation, checklist, playbook

**The Deliverable Hierarchy (from most to least actionable):**

1. **Working code** — "Provide the complete `trigger.config.ts` for our monorepo setup" > "Describe how to configure Trigger.dev"
2. **Schemas/types** — "Provide the Zod schema for TriageResult" > "Describe the output format"
3. **Architecture with code** — "Show the data flow with code examples for key integration points"
4. **Recommendation with justification** — "Pick one and justify it. Include migration cost if wrong."
5. **Risk register** — "What could go wrong? For each risk: likelihood, impact, mitigation."
6. **Open questions** — "Anything you couldn't resolve. Flag clearly." (ALWAYS include this.)

**Key principle: Every spike must request OPEN QUESTIONS as a deliverable.** This is the escape valve. It tells the researcher they don't need to pretend they know everything — and the open questions are often the most valuable output, because they identify risks you didn't know existed.

**Anti-pattern:**
- Don't ask for "a summary" or "an overview." Ask for specific artifacts.
- Don't ask for more than 10 deliverables. If you need more, the spike is too broad.

### 6. IMPORTANT NOTES (Guardrails)

**Purpose:** Calibrate the researcher's behavior. Prevent the most common failure modes of LLM-driven research.

**Standard guardrails (include in every prompt):**

```markdown
- I care more about **getting this right** than getting a quick answer.
  [REASON: Prevents the agent from rushing to a conclusion]

- If something is unclear or the docs are contradictory, say so rather than guessing.
  [REASON: Prevents hallucinated confidence]

- [TECHNOLOGY] has evolved significantly through [YEAR].
  Do not rely on training data — search for current documentation.
  [REASON: Forces web search for fast-moving tech]
```

**Technology-specific guardrails (include when relevant):**

```markdown
- Do NOT use [OLD_VERSION] patterns. [NEW_VERSION] changed [WHAT].
  [REASON: Prevents stale patterns from training data]

- Search [SPECIFIC_URL] for current documentation.
  [REASON: Points to canonical sources]

- The [FRAMEWORK/LIBRARY] is at [PACKAGE_NAME] on npm/PyPI.
  Check the latest version.
  [REASON: Prevents confusion with similarly named packages]
```

**Project-specific guardrails (include when the spike has known pitfalls):**

```markdown
- The MCP server is NOT a Next.js app. Do not assume a web framework.
  [REASON: Prevents framework-centric assumptions]

- This is a personal tool, not an enterprise platform. Don't over-engineer.
  [REASON: Calibrates solution complexity]

- We use ESM throughout. TypeScript strict mode.
  [REASON: Prevents CJS patterns that break the build]
```

**The closing guardrail (always last):**

```markdown
- I care more about **getting this right** than getting a quick answer.
  [TOPIC-SPECIFIC REASON: e.g., "The LLM pipeline is where the product's
  value lives. If structured output is unreliable, the whole product fails.
  Be thorough and honest about limitations."]
```

This closing line is the most important guardrail. It gives the researcher permission to be slow, thorough, and honest. Without it, agents optimize for speed and confidence — exactly the wrong tradeoff for research.

---

## Calibration Guide

### How to Size a Spike

| Signal | Spike Size | Research Questions | Deliverables |
|--------|-----------|-------------------|-------------|
| One technology, well-documented, narrow question | Small (skip deep research — just read the docs) | 3-5 | 2-3 |
| One technology, poorly-documented or fast-moving | Medium | 6-8 | 4-6 |
| Integration between 2-3 technologies | Medium-Large | 8-10 | 5-7 |
| Design decision with multiple alternatives and downstream impact | Large | 10-12 | 6-8 |
| System-wide concern touching many subsystems | Too big — split it | N/A | N/A |

### When to Split a Spike

Split when:
- Research questions span more than 2 abstraction levels (e.g., "design the API AND implement the database AND choose the framework")
- Deliverables include both "choose a technology" and "design the detailed architecture using that technology"
- The spike topic has a natural dependency: decision A must be made before research question B is answerable

### Spike Dependency Patterns

```
Independent spikes (parallelize):
  [MCP Framework] ──┐
  [Data Model]    ──┼── [Synthesis]
  [LLM Pipeline]  ──┘

Sequential spikes (serialize):
  [Choose ORM] → [Design Schema] → [Implement Repository]

Fan-out spikes (one decision enables many):
  [Choose Framework] → [API Design]
                     → [Auth Pattern]
                     → [Deployment Config]
```

When spikes are independent, run them in parallel and synthesize after. When sequential, the earlier spike's output becomes the "Current Design" section of the later spike.

---

## Quality Signals

### Signs of a Good Spike Prompt
- A researcher with zero project context can understand what to do after reading only the prompt
- Every research question has a clear "done" state — you'd know a good answer from a bad one
- The deliverables are concrete enough to review ("is this schema correct?") not vague ("is this overview helpful?")
- The guardrails address the specific risks of THIS topic, not generic research risks
- The current design / starting point gives the researcher something to push against

### Signs of a Bad Spike Prompt
- The researcher would need to ask clarifying questions before starting
- Research questions are so broad they could fill a textbook ("how does Postgres work?")
- Deliverables are descriptions rather than artifacts ("describe the architecture" vs. "provide the `schema.prisma` file")
- No guardrails against stale training data for fast-moving technologies
- No starting point — the researcher is inventing from scratch in every dimension

---

## Quick-Start Template

Copy and fill in:

```markdown
# Research Task: [VERB] [TOPIC] for "[PROJECT]"

## Context

I'm building **[PROJECT]** — [1-2 sentence description]. [The system's architecture
in one sentence]. [Where this spike topic fits and why it matters].

[Any critical constraints: deployment target, language, framework, scale]

This spike is about **[what specifically you're researching]** — everything in
the `[package/module]` [package/layer/component].

## System Architecture ([What the topic] Sits Inside)

### [Relevant Structure]

[Directory tree, data flow diagram, or component diagram — ONLY relevant parts]

### [Key Boundaries]

[Table or prose showing what's upstream, downstream, and adjacent to this spike]

### Technology Constraints

[Bullet list of hard requirements]

## [Current Design / Starting Point / The N Candidates]

[What you've already proposed or decided — marked as "needs validation"]
[OR: The alternatives being evaluated, with enough detail to compare]

## Research Questions

### 1. [Foundational: Current State of Technology]
[Sub-questions as bullets]

### 2. [Integration: How It Works in Our Setup]
[Sub-questions as bullets]

### 3-N. [Design, Implementation, Risk questions]
[Sub-questions as bullets]

### N+1. [Testing / Operations / Migration]
[Sub-questions as bullets]

## Deliverables

### A. [Primary Artifact]
[Specific description of what to produce]

### B-G. [Additional Artifacts]
[Each lettered, each specific]

### H. Open Questions
Anything you couldn't resolve. Flag clearly.

## Important Notes

- **[TECHNOLOGY] has [changed significantly / been released recently].**
  Do not rely on [pre-YEAR] information. Search for current [docs/releases/examples].
- **[PROJECT-SPECIFIC WARNING].** [Why this matters for the spike.]
- **Search [SPECIFIC_URL]** for current documentation.
- I care more about **getting this right** than getting a quick answer.
  [TOPIC-SPECIFIC REASON].
```

---

## Anti-Pattern Reference

| Anti-Pattern | Why It Fails | Fix |
|-------------|-------------|-----|
| "Research everything about X" | No focus, produces surface-level survey | Scope to specific questions with sub-bullets |
| No starting point | Researcher invents from scratch, result may not fit your system | Provide a proposed design to validate/improve |
| No version numbers | Researcher uses outdated patterns | Pin versions, warn about recent changes |
| "Give me a summary" deliverable | Produces fluffy overview, not actionable artifacts | Request specific artifacts: code, schemas, types, configs |
| No "open questions" deliverable | Researcher hides uncertainty, presents guesses as facts | Always request open questions as an explicit deliverable |
| Too many questions (15+) | Researcher rushes later questions, quality degrades | Split into two spikes or prioritize ruthlessly |
| No guardrails | Researcher relies on training data, hallucinates confidence | Add technology-specific "search current docs" instructions |
| Architecture dump (entire system) | Drowns the signal in noise | Only include architecture that touches the spike topic |
| Asking for "best practices" generically | Gets generic advice, not project-specific recommendations | Frame as "given OUR constraints [X, Y, Z], what's the best approach?" |
| No "why should I care" context | Researcher doesn't understand stakes, treats everything as equal priority | State what depends on this decision and what breaks if it's wrong |
