# Research Task: Design the Optimal Synthesis Prompt for Parallel Research Spike Reconciliation

## Context

I'm building a software product called **Redgest** — a personal Reddit digest engine. The system has been fully designed via a PRD, and I've just completed **six parallel deep research spikes**, each investigating a major subsystem in isolation. Each spike was executed by a separate Claude instance with extended thinking, producing a detailed research report.

**The six spikes are:**

1. **MCP Server Framework** — Evaluated Hono vs. MCP SDK native transport vs. Fastify for the standalone MCP protocol server. Produced a framework recommendation, architecture sketch, and risk assessment.

2. **Trigger.dev v4 Integration** — Researched how Trigger.dev v4 integrates with a non-framework Node.js service in a TurboRepo monorepo with CQRS, Prisma v7, and an in-process event bus. Produced integration architecture, code patterns, migration playbook (cloud → self-hosted), and risk register.

3. **Data Model & Prisma v7** — Designed the complete Postgres data model, Prisma v7 schema, CQRS event store, read model projections (Postgres views), repository pattern, and monorepo package structure for `@redgest/db`. Produced a production-ready schema, view SQL, repository interfaces, migration strategy.

4. **MCP API Design** — Designed the MCP tool surface with obsessive care. Tool names, agent-facing descriptions, parameter schemas, response envelopes, error taxonomy, content representation strategy, and compositional agent workflow patterns. Produced a complete tool catalog, error codes, and workflow diagrams.

5. **Next.js Config UI** — Researched the minimal Next.js 16 config panel architecture, data access patterns (how the web app talks to @redgest/core), ShadCN/ui in TurboRepo, component architecture for 4 screens, deployment without Vercel lock-in, and real-time job status polling.

6. **LLM Pipeline** — Designed the two-pass LLM architecture (triage + summarization), Vercel AI SDK provider abstraction, structured output contracts (Zod schemas), prompt engineering for both passes, multi-provider support, token management, error handling, and prompt injection mitigation.

## The Problem

These six spikes were executed **in isolation**. Each agent had the PRD context but no awareness of the other spikes' findings. This means:

- **There will be conflicts.** The API design spike may have proposed 13 tools while the PRD specified 12. The data model spike may have restructured tables that the API design spike assumes exist. The MCP framework spike chose Hono, but the API design spike may have made assumptions about a different framework.

- **There will be gaps.** Topics that fall between two spikes may not have been covered by either. The interface between `@redgest/llm` and `@redgest/core` was probably underspecified in both the LLM spike and the data model spike.

- **There will be redundancy.** Multiple spikes may have independently designed overlapping concerns (e.g., error handling patterns, Zod schema conventions, Prisma client instantiation).

- **There will be implicit assumptions** that need to be made explicit. One spike may assume the event bus works a certain way that another spike contradicts.

- **There will be decisions that need reconciliation.** When two spikes reach different conclusions about the same design point, someone needs to pick one and update the other.

**I need to synthesize all six spike outputs into a single, coherent implementation plan** — resolving conflicts, filling gaps, surfacing contradictions, and producing a document that an engineer could pick up and start building from.

## Your Task

**Design the optimal prompt for a synthesis agent.** This synthesis agent will be a fresh Claude instance with extended thinking. It will receive all six spike reports as input (likely as attached documents or inline text) along with the PRD, and it must produce a coherent reconciliation.

### What Makes Synthesis Hard

Research synthesis is a specific cognitive task that's different from original research. The challenges include:

1. **Cross-referencing at scale.** The six spike reports will total 50,000–100,000+ tokens of dense technical content. The agent needs to find the touch points — where one spike's output connects to another's input.

2. **Conflict detection.** Subtle contradictions are harder to spot than obvious ones. A response envelope shape of `{ ok, data, error }` in one spike vs. `{ success, result, errors }` in another is an obvious conflict. But a data model that stores `contentMarkdown` on the digest table while the API design spike assumes digest content is assembled on-the-fly from post summaries — that's a subtle architectural conflict.

3. **Abstraction level mismatches.** The API design spike operates at the interface level (tool schemas, response shapes). The data model spike operates at the persistence level (tables, columns, indexes). The LLM spike operates at the algorithm level (prompts, token budgets). These need to be reconciled vertically — a single user request flows through all three levels.

4. **Decision authority.** When spikes conflict, the synthesis agent needs a framework for which spike "wins." Generally: the PRD is the source of truth for requirements, the API design spike is the source of truth for the external interface, the data model spike is the source of truth for persistence, and the implementation spikes (MCP framework, Trigger.dev, Next.js) are the source of truth for their respective technology choices.

5. **Producing actionable output.** The synthesis isn't just a report — it needs to produce a document that directly enables implementation. Updated ADRs, a reconciled type system, a dependency graph, and a Phase 1 task breakdown.

### What I Need You to Research

1. **Prompt engineering for synthesis/reconciliation tasks.** What makes a good synthesis prompt? How do you instruct an LLM to cross-reference multiple long documents, detect conflicts, and produce reconciled output? Are there established patterns (e.g., from literature review synthesis, legal document reconciliation, or multi-source intelligence analysis)?

2. **Handling large input contexts.** Six spike reports + PRD could exceed 100K tokens. How should the prompt structure the input for maximum comprehension? Should documents be presented in a specific order? Should they be pre-processed (e.g., extract key decisions into a summary table before the full documents)?

3. **Conflict resolution frameworks.** How to instruct the agent to handle contradictions? Should it flag them for human decision, apply a priority hierarchy, or attempt autonomous resolution with justification?

4. **Output format for implementation readiness.** What should the synthesis document look like? A diff against the PRD? A new standalone document? A set of specific artifacts (updated type definitions, reconciled schemas, task breakdown)?

5. **Cognitive load management.** With 100K+ tokens of input, the agent will struggle to maintain attention across the full context. How to structure the prompt to mitigate this? Section-by-section analysis with running state? Explicit cross-reference instructions? Multiple passes?

6. **Meta-prompting patterns.** Research any existing work on "synthesis prompts" — prompts specifically designed for reconciling multiple research outputs. This is adjacent to: multi-document summarization, systematic literature reviews, architectural decision reconciliation, and merge conflict resolution.

## Deliverables

### A. The Synthesis Prompt

A complete, ready-to-use prompt that I can give to a fresh Claude instance along with the six spike reports and the PRD. The prompt should:

1. **Set the role and task clearly.** The agent is a technical architect synthesizing parallel research streams into an implementation plan.

2. **Define the input structure.** How the six reports and PRD should be presented (order, labeling, any pre-processing).

3. **Provide a conflict resolution framework.** Priority hierarchy, decision criteria, and what to do when conflicts can't be auto-resolved.

4. **Specify a systematic analysis approach.** Not "read everything and summarize" — a structured method for cross-referencing. For example:
   - Pass 1: Extract key decisions from each spike into a normalized table
   - Pass 2: Cross-reference decisions across spikes, flagging conflicts and gaps
   - Pass 3: Resolve conflicts using the priority hierarchy
   - Pass 4: Produce the reconciled implementation plan

5. **Define the output format.** What sections the synthesis document should contain, what level of detail, and what artifacts should be produced.

6. **Include quality checks.** Instructions for the agent to verify its own work — e.g., "trace a single user request (generate a digest) through every layer and verify there are no type mismatches, missing fields, or broken assumptions."

### B. Input Preparation Guide

Instructions for ME on how to prepare the spike outputs before feeding them to the synthesis agent. Should I:
- Include full reports or extract key sections?
- Add any annotations or labels?
- Create a summary table of decisions per spike?
- Present them in a specific order?
- Include the PRD inline or as a separate reference?

### C. Output Template

A template or outline for what the synthesis document should contain. Sections, expected content per section, and level of detail. This becomes the "shape" that the synthesis prompt instructs the agent to fill.

### D. Validation Checklist

A checklist I can use AFTER the synthesis to verify completeness. Something like:
- [ ] Every MCP tool has a corresponding data model entity
- [ ] Every CQRS command has a handler, and every handler has a Prisma operation
- [ ] The response envelope is consistent across API design and implementation
- [ ] Token budgets in the LLM spike are compatible with the data model's content storage
- [ ] The Trigger.dev task definitions align with the CQRS event flow
- [ ] The Next.js data access pattern is compatible with the Prisma monorepo setup
- ...etc.

### E. Rationale

For each major design choice in the synthesis prompt, explain WHY. What alternative approaches did you consider for the synthesis task, and why did you reject them? This helps me iterate on the prompt if the first synthesis run isn't good enough.

## Important Notes

- **This is a meta-task.** You're not synthesizing the spikes — you're designing the prompt that will synthesize them. You don't have access to the spike outputs. You DO have the full context of what each spike was asked to produce (described above).
- **The synthesis agent will have Claude Opus 4.6 with extended thinking.** It can handle long contexts and complex reasoning, but it benefits from structured analysis approaches over "read everything and figure it out."
- **The spike outputs are dense technical documents**, not casual summaries. Each is likely 5,000–15,000 words of specific technical recommendations, code examples, and architectural decisions.
- **The PRD is the source of truth for requirements** but may be outdated on specific technical decisions where a spike produced better information. The synthesis should update the PRD, not be constrained by it.
- **The end goal is Phase 1 implementation.** The synthesis should produce something an engineer can start building from on day one — not another planning document that needs further refinement.
- **Search for research on multi-document synthesis, reconciliation prompting, and structured analysis frameworks for LLMs.** This is a relatively novel use of LLMs — synthesizing multiple LLM research outputs into a coherent plan. Any existing work on this would be valuable.
- I care more about **getting the synthesis prompt right** than getting it fast. A bad synthesis that papers over conflicts will cost more time than it saves. The prompt should be designed to surface problems, not hide them.
