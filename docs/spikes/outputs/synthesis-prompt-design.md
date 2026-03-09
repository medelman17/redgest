# Designing the optimal prompt for reconciling parallel research spikes

**A multi-pass synthesis prompt built on extract → cross-reference → resolve → produce → verify phases, structured with hierarchical document presentation and explicit conflict taxonomies, dramatically outperforms monolithic "summarize these documents" approaches.** The research evidence is unambiguous: prompt chaining consistently beats single-shot synthesis for complex multi-document reconciliation (ACL 2024), guided conflict detection significantly outperforms blind detection (Google Research 2025), and placing documents before instructions yields **~30% better performance** in Claude's long-context comprehension (Anthropic 2023). What follows is a complete, research-backed prompt engineering system for reconciling six parallel technical research spikes into a single actionable implementation plan.

---

## The science behind why monolithic synthesis fails

Three independent lines of research converge on the same conclusion: asking an LLM to "read these six documents and synthesize them" is fundamentally the wrong approach.

**The "lost in the middle" phenomenon** (Liu et al., TACL 2024) established that LLM performance follows a **U-shaped curve** — comprehension is highest for information at the beginning and end of the context, with significant degradation for content in the middle. This persists even in explicitly long-context models and even when prompts state that documents are randomly ordered. The cause lies in rotary positional embedding decay properties and Softmax attention allocation patterns. For six research spike documents totaling 80–120K tokens, this means the middle two or three documents receive measurably less attention unless the prompt actively counteracts this.

**Document ordering sensitivity** compounds the problem. Research published in *Transactions of the ACL* (DeYoung et al., 2024) found that even the best multi-document summarization models are "**over-sensitive to changes in input ordering and under-sensitive to changes in input compositions**" — meaning they may produce different syntheses depending on which document appears first, while potentially failing to register when the mix of inputs changes. This directly threatens the integrity of any technical reconciliation.

**Cognitive overload in single-pass analysis** mirrors human limitations. The CoThinker framework (2025) applied Cognitive Load Theory to LLMs and found that excessive in-context information creates a "redundancy effect" where self-reflection quality degrades because initial analysis consumed most available processing capacity. Apple's "Illusion of Thinking" study confirmed that reasoning models hit performance collapse points at medium-high complexity. A monolithic synthesis prompt for six dense technical documents is precisely the kind of task that triggers this collapse.

The solution, supported by controlled experiments on text summarization (ACL 2024 Findings), is **prompt chaining**: breaking the synthesis into discrete passes with structured intermediate artifacts. This works through three mechanisms — cognitive focus (each subtask isolates a single objective), iterative refinement (sequential drafts mirror proven human workflows), and structured handoffs (explicit output schemas minimize context bleed).

---

## Five-pass synthesis architecture with evidence-based design rationale

The optimal prompt follows an **Extract → Cross-Reference → Resolve → Produce → Verify** pipeline. Each pass produces an intermediate artifact that serves as "working memory" for subsequent passes. This architecture is drawn from the intersection of intelligence analysis methodology (Analysis of Competing Hypotheses), systematic literature review automation (otto-SR achieving 93.1% extraction accuracy), and prompt chaining best practices.

**Pass 1 — Extract.** For each spike document independently, extract key decisions, technology choices, interface contracts, data structures, assumptions, and open questions into a structured format. Anthropic's own research demonstrates that instructing Claude to "extract direct quotes before synthesizing" is their **#1 proven technique** for reducing hallucination and improving long-context recall. This pass prevents premature blending of information across spikes.

**Pass 2 — Cross-Reference.** Build a comparison matrix mapping each technical dimension (API contracts, data models, error handling, configuration, deployment) across all six spikes. Explicitly identify consensus, partial agreement, conflicts, gaps, and complementary information. This pass creates the central analytical artifact that makes conflicts visible and tractable.

**Pass 3 — Resolve.** Apply an explicit conflict resolution framework to each identified conflict. Research from Google's "(D)RAGged Into a Conflict" (2025) found that **explicitly informing LLMs about potential conflict categories significantly improves response quality**. The resolution framework should classify conflicts by type (interface mismatch, technology contradiction, assumption conflict, scope overlap, gap) and apply type-appropriate resolution strategies rather than one-size-fits-all logic.

**Pass 4 — Produce.** Using the resolved comparison matrix, generate the unified implementation document. This pass synthesizes rather than re-reads — it works from the intermediate artifacts, not the raw source documents, reducing cognitive load and maintaining consistency.

**Pass 5 — Verify.** Apply structured verification against the synthesis. Research on self-correction is nuanced: generic "check your work" instructions consistently *decrease* accuracy (Huang et al., 2023). But Chain of Verification (CoVe) — where the model generates specific verification questions, answers them independently, and revises accordingly — measurably reduces hallucinations. The key is providing a **specific verification rubric**, not a vague instruction to self-improve.

**Why single-prompt with extended thinking, not multi-API-call chain?** Given that Claude Opus 4.6 has extended thinking capacity up to 128K tokens, the five passes can be executed within a single prompt by instructing the model to produce intermediate artifacts in its thinking block. This avoids the latency and error propagation of multi-call orchestration while preserving the cognitive benefits of staged analysis. Anthropic's engineering team found that pairing structured thinking with optimized prompting yielded a **54% relative improvement** on complex domain tasks compared to either approach alone.

---

## Deliverable A: the complete synthesis prompt

```xml
<system>
You are a principal systems architect performing a technical reconciliation. Six parallel 
research spikes were conducted for the Redgest product (a personal Reddit digest engine) 
by separate Claude instances with no cross-awareness. Your task is to reconcile them into 
a single coherent implementation plan that an engineer can build from immediately.

You will work through five explicit analytical passes. Complete each pass fully before 
proceeding to the next. Use your extended thinking to work through each pass, building 
intermediate artifacts that inform later analysis.

CRITICAL PRINCIPLES:
1. Never silently merge conflicting information. Every conflict must be surfaced explicitly.
2. Maintain source attribution throughout — every claim traces to a spike document.
3. When spikes agree, state this as consensus with confidence.
4. When spikes conflict, classify the conflict and apply the resolution framework below.
5. When only one spike addresses a topic, note this as single-source (lower confidence).
6. Actively look for GAPS — things no spike addressed but the system needs.
7. Weight all six documents equally regardless of their position in the input.
</system>

<conflict_taxonomy>
When you encounter a conflict between spike documents, classify it as one of:

INTERFACE_MISMATCH: Two spikes define incompatible contracts for the same boundary 
  (e.g., MCP API spike expects a response shape that the Trigger.dev spike doesn't produce).
  → Resolution: Design the contract that satisfies both consumers. Document the reconciled 
    interface. If irreconcilable, flag for human decision with both options and tradeoffs.

TECHNOLOGY_CONTRADICTION: Two spikes recommend different technologies or versions for the 
  same concern (e.g., different ORMs, different queue mechanisms).
  → Resolution: Evaluate against the PRD's stated priorities (simplicity, maintainability, 
    solo-developer ergonomics). Choose the option with stronger justification. Document 
    what the rejected option offered that must be preserved through other means.

ASSUMPTION_CONFLICT: Two spikes make incompatible assumptions about how the system works 
  (e.g., one assumes synchronous processing, another assumes async).
  → Resolution: Identify which assumption better serves the overall architecture. Trace 
    the impact of each assumption through dependent components. Choose and document.

SCOPE_OVERLAP: Two spikes claim ownership of the same responsibility 
  (e.g., both claim to handle error formatting).
  → Resolution: Assign clear ownership based on separation of concerns. Define the 
    boundary precisely.

NAMING_INCONSISTENCY: Same concept, different names across spikes.
  → Resolution: Choose the most descriptive name. Create a terminology glossary.

GAP: A necessary capability that no spike addresses.
  → Resolution: Design the missing piece, noting it as a gap-fill with lower confidence.
</conflict_taxonomy>

<analysis_passes>

PASS 1 — EXTRACTION (per-document)
For each of the six spike documents, extract into a structured format:
- KEY DECISIONS: Technology choices, architectural patterns, design decisions made
- INTERFACE CONTRACTS: APIs, data shapes, function signatures, event formats defined
- DATA STRUCTURES: Models, schemas, types, enums defined
- ASSUMPTIONS: Stated or implied assumptions about other system components
- DEPENDENCIES: What this spike expects from other spikes' domains
- OPEN QUESTIONS: Unresolved issues flagged by the spike author
- CONFIGURATION: Settings, environment variables, feature flags defined

PASS 2 — CROSS-REFERENCE MATRIX
Build a comparison matrix with dimensions as rows and spike documents as columns.
Dimensions to cross-reference:
- Shared data models (do all spikes agree on entity shapes?)
- API boundaries between components (do producer and consumer agree on contracts?)
- Error handling strategy (consistent taxonomy? propagation patterns?)
- Authentication/authorization model (consistent across all entry points?)
- Configuration management (consistent approach to settings/env vars?)
- Job/task orchestration (who triggers what, in what order, with what data?)
- Logging/observability strategy (consistent patterns?)
- Deployment and runtime assumptions (same platform? same runtime? same infra?)

For each cell, mark: ✅ CONSISTENT | ⚠️ PARTIAL | ❌ CONFLICT | ➖ NOT ADDRESSED

PASS 3 — CONFLICT RESOLUTION
For each ❌ CONFLICT and ⚠️ PARTIAL cell in the matrix:
1. State the conflict precisely with quotes from each spike
2. Classify using the conflict taxonomy above
3. Apply the specified resolution strategy
4. Document: chosen resolution, reasoning, what was sacrificed, confidence level (HIGH/MEDIUM/LOW)
5. If you cannot resolve with confidence, mark as NEEDS_HUMAN_DECISION with both options

For each ➖ NOT ADDRESSED gap:
1. Identify what's missing and why it matters
2. Propose a solution consistent with the established patterns from other spikes
3. Mark confidence as LOW and flag for review

PASS 4 — UNIFIED IMPLEMENTATION DOCUMENT
Produce the reconciled implementation plan using the output template specified below.
Reference your Pass 2 matrix and Pass 3 resolutions — do not re-derive from source documents.

PASS 5 — VERIFICATION
Perform these specific verification checks:
1. TRACE-THROUGH: Pick the core user flow (Reddit data fetch → triage → summarize → 
   deliver via MCP) and trace it through every layer, verifying that interfaces connect.
2. DATA FLOW CHECK: Trace a single data entity (e.g., a SubredditPost) from ingestion 
   through processing to delivery. Verify schema consistency at every boundary.
3. ERROR PROPAGATION CHECK: Trace an error scenario (e.g., Reddit API rate limit) through 
   all layers. Verify the error handling chain is complete and consistent.
4. CONFIGURATION COMPLETENESS: List every configuration value referenced across all 
   components. Verify none are orphaned or undefined.
5. DEPENDENCY CYCLE CHECK: Verify no circular dependencies exist between components.
6. GAP SCAN: Re-read each spike's assumptions and dependencies. Verify each is satisfied 
   by another spike's outputs or flagged as a gap.

Report verification results honestly. If a check reveals an inconsistency, add it to the 
Conflicts section with your recommended resolution.
</analysis_passes>

<output_template>
Structure your final output (Pass 4) as follows:

# Redgest: Reconciled Implementation Plan

## Executive Summary
[2-3 paragraphs: what this document is, key architectural decisions, major conflicts 
resolved, remaining open questions, implementation readiness assessment]

## Terminology Glossary
[Reconciled names for all cross-cutting concepts, with mapping from each spike's terminology]

## Architecture Overview
[Reconciled system architecture: components, boundaries, data flow, deployment topology]
[Include a text-based architecture diagram showing component relationships]

## Reconciled Decisions
[For each major architectural decision, use this format:]

### Decision: [Title]
- **Status**: Resolved | Needs Human Decision
- **Spikes Involved**: [which spikes this touches]
- **Options Considered**: [from the spikes]
- **Chosen Approach**: [the reconciled decision]
- **Rationale**: [why this option, referencing spike evidence]
- **Tradeoffs Accepted**: [what was sacrificed]
- **Confidence**: HIGH | MEDIUM | LOW
- **Impact on Other Components**: [ripple effects]

## Interface Contracts
[Every boundary between components, with reconciled API shapes, data formats, error types]

### [Component A] ↔ [Component B]
- Direction: [who calls whom]
- Contract: [request/response shapes]
- Error handling: [error types and propagation]
- Source spikes: [attribution]

## Unified Data Model
[Reconciled Prisma schema or equivalent, with annotations showing where spikes diverged 
and how conflicts were resolved]

## Implementation Sequence
[Phased build order based on dependency analysis]

### Phase 1: [Foundation] — [T-shirt size]
- Components: [list]
- Dependencies: [none / external only]
- Deliverable: [what's testable at this phase]
- Estimated complexity: S | M | L | XL

### Phase 2: [Core Pipeline] — [T-shirt size]
[etc.]

## Conflict Register
[Complete log of every conflict detected and how it was resolved]

| # | Conflict | Type | Spikes | Resolution | Confidence | Human Review? |
|---|----------|------|--------|------------|------------|---------------|

## Gap Register
[Everything the spikes didn't address but the system needs]

| # | Gap | Why It Matters | Proposed Solution | Confidence |
|---|-----|----------------|-------------------|------------|

## Risk Register
[Technical risks identified through reconciliation]

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|

## Open Questions for Human Decision
[Issues that could not be resolved autonomously, with options and tradeoffs for each]

## Verification Results
[Output of Pass 5 trace-through checks]

## Appendix: Source Spike Summaries
[Brief summary of each spike's key findings for reference]
</output_template>

<documents>
[THE SIX SPIKE DOCUMENTS AND PRD GO HERE — see Input Preparation Guide]
</documents>

Now begin with Pass 1. Work through all five passes systematically. Take your time 
in extended thinking to build thorough intermediate artifacts before producing the 
final document.
```

**Design rationale for prompt structure:** Documents are placed before the final instruction ("Now begin with Pass 1") following Anthropic's evidence that this ordering improves recall by ~30%. The conflict taxonomy appears early in the prompt (privileged position in the U-shaped attention curve). The output template appears near the end (also privileged). The system prompt establishes analytical disposition before any content arrives.

---

## Deliverable B: how to prepare the six spike documents for input

The input preparation process is as critical as the prompt itself. Research on hierarchical document presentation shows it produces **more coherent summaries** than flat document presentation (BOOOOKSCORE study, OpenReview 2024), while Anthropic's context engineering framework emphasizes finding the "smallest possible set of high-signal tokens."

**Step 1 — Pre-process each spike document.** Remove boilerplate, table of contents, and redundant preamble. Retain all technical content, decisions, code examples, and rationale. Each document should be stripped to its analytical core. If any spike exceeds 20K tokens, summarize peripheral sections while preserving all decisions, interfaces, and code verbatim.

**Step 2 — Create structured metadata headers.** Prepend each document with a standardized XML header:

```xml
<document id="spike-1" title="MCP Server Framework" 
  domain="server infrastructure" 
  key_decisions="3" 
  interfaces_defined="Hono routes, middleware chain"
  dependencies_on="spike-3 (data model), spike-4 (MCP API design)">
```

**Step 3 — Generate per-spike executive summaries.** Before including full documents, create a `<document_summaries>` section with 100–150 word summaries of each spike. This hierarchical presentation gives the model an advance map of the terrain before diving into details — the CoTHSSum framework (2025) showed this approach consistently outperforms flat presentation across ROUGE, BLEU, and factual consistency metrics.

**Step 4 — Order documents strategically.** Place documents in this order to exploit the U-shaped attention curve:

- **Position 1** (highest attention): The spike with the most cross-cutting interfaces (likely Spike 3: Data Model & Prisma, since every other component depends on it)
- **Position 2**: The spike with the most external dependencies (likely Spike 6: LLM Pipeline, as the core value proposition)
- **Positions 3–4** (middle, lowest attention): The most self-contained spikes (likely Spike 5: Next.js Config UI and Spike 1: MCP Server Framework)
- **Position 5**: Spike 2: Trigger.dev (orchestration touches everything)
- **Position 6** (high attention, just before instructions): Spike 4: MCP API Design (defines the primary user-facing contract)

**Step 5 — Include the PRD.** Place the Product Requirements Document as a `<prd>` section *before* the spike documents but *after* the prompt instructions. The PRD serves as the authoritative source for resolving conflicts — when spikes disagree, the PRD's stated priorities should break ties.

**Step 6 — Budget your context.** Target **≤75% of available context** for input documents. Anthropic's context engineering research found that protecting the remaining 25% for reasoning preserves output quality. For a 200K context window, this means ~150K tokens for input. For a 1M beta context, the constraint is more relaxed but the 75% principle still applies. If your six spikes plus PRD exceed the budget, use the hierarchical approach: full text for the three most cross-cutting spikes, detailed summaries for the others.

**Final input structure:**

```xml
<system>[System prompt with principles, conflict taxonomy, analysis passes]</system>

<prd>[Product Requirements Document]</prd>

<document_summaries>
  <summary id="spike-1">[100-150 word summary]</summary>
  <summary id="spike-2">[100-150 word summary]</summary>
  ... [all six]
</document_summaries>

<documents>
  <document id="spike-3" title="Data Model & Prisma v7">[full text]</document>
  <document id="spike-6" title="LLM Pipeline">[full text]</document>
  <document id="spike-5" title="Next.js Config UI">[full text]</document>
  <document id="spike-1" title="MCP Server Framework">[full text]</document>
  <document id="spike-2" title="Trigger.dev v4 Integration">[full text]</document>
  <document id="spike-4" title="MCP API Design">[full text]</document>
</documents>

<output_template>[Output template specification]</output_template>

Now begin with Pass 1. Work through all five passes systematically.
```

---

## Deliverable C: the output template with rationale

The output template (embedded in the prompt above) is a **hybrid of Architecture Decision Records (MADR 4.0) and Amazon-style technical design documents**, selected because research shows that combining structured sections for decisions with narrative for reasoning is more effective than either alone.

Key format decisions and their evidence base:

**ADR-style decision records** for each reconciled decision follow the MADR 4.0 format — the most widely adopted structured ADR template, backed by a peer-reviewed publication (ZEUS 2018) and maintained by the ADR GitHub organization. Each decision captures status, options considered, chosen approach, rationale, tradeoffs, and confidence. The confidence field is critical: CISC research (ACL Findings 2025) demonstrated that LLMs can "effectively judge the correctness of their own outputs" when given structured self-assessment frameworks.

**The Conflict Register** is a format innovation specific to reconciliation tasks. No published template addresses this directly — this appears to be a genuine gap in existing practitioner literature. The register provides a complete audit trail of every conflict detected, its classification, and resolution, enabling human reviewers to quickly identify decisions they may want to override.

**The Implementation Sequence** uses Amazon's t-shirt sizing convention (S/M/L/XL) rather than hour estimates, following AWS Prescriptive Guidance's recommendation that coarse estimates reduce false precision while maintaining planning utility. Phased delivery with explicit dependency mapping ensures the build order respects the reconciled architecture.

**Trace-through verification results** appear as a first-class output section rather than being hidden in the model's reasoning. This makes the verification auditable and builds justified trust in the synthesis.

---

## Deliverable D: post-synthesis validation checklist

This checklist is designed for human review of the synthesis output. It draws on Chain of Verification (CoVe) principles, trace-through patterns from systems architecture, and adversarial self-checking research.

**Structural completeness checks:**

1. Every spike document is referenced in at least three decisions — if a spike is barely mentioned, it may have been "lost in the middle"
2. The Conflict Register contains at least N entries (where N should be estimated based on the number of interface boundaries — six spikes with ~15 pairwise boundaries should produce at least 5–10 conflicts)
3. The Gap Register is non-empty — zero gaps likely indicates insufficient analysis, not perfection
4. Every interface contract in the Interface Contracts section has both a producer and consumer identified
5. The Implementation Sequence covers all components from all six spikes
6. The Terminology Glossary maps at least one name conflict (different spikes almost certainly use different names for the same concept)

**Semantic consistency checks:**

7. Pick any interface contract and verify that the data shapes match on both sides by cross-referencing with the relevant spike documents
8. Pick any entity from the Unified Data Model and trace it through the Implementation Sequence — does it appear in the right phase?
9. Read every "NEEDS_HUMAN_DECISION" item — does the synthesis provide enough context (both options with tradeoffs) for you to decide?
10. Check that confidence levels are calibrated — a synthesis where everything is "HIGH confidence" is likely overconfident (research shows LLMs tend toward overconfidence in verbalized confidence assessments)

**Architectural integrity checks:**

11. Trace the primary data flow (Reddit fetch → triage → summarize → deliver) through the reconciled architecture — does every handoff have a defined interface?
12. Verify the error handling chain: introduce a hypothetical failure at each component boundary and check that the Conflict Register or Interface Contracts specify what happens
13. Check for circular dependencies in the Implementation Sequence
14. Verify that the reconciled data model supports all queries implied by the MCP API design and the Config UI

**Adversarial checks:**

15. Identify the three decisions with the lowest confidence ratings and evaluate whether the reasoning is sound or whether the model defaulted to one spike arbitrarily
16. Search for "orphaned" concepts — technical elements mentioned in one spike that don't appear in the reconciled output
17. Ask a fresh Claude instance: "Given this implementation plan, what are the three most likely points of failure during implementation?" and compare against the Risk Register

---

## Deliverable E: rationale for every major design choice

**Why a single long prompt with extended thinking rather than multi-call orchestration?** The five-pass architecture could be implemented as five separate API calls, passing intermediate artifacts between them. However, single-prompt execution with extended thinking has three advantages: (1) Anthropic's "think" tool research showed **54% relative improvement** when structured thinking is combined with optimized prompting in a single call, outperforming either approach alone; (2) a single call eliminates information loss at handoff boundaries between API calls; (3) extended thinking in Claude Opus 4.6 provides up to 128K tokens of dedicated reasoning space, which is sufficient for all intermediate artifacts. The tradeoff is debuggability — multi-call chains are easier to inspect mid-process. If the synthesis quality is insufficient on first attempt, falling back to multi-call orchestration with human review between passes is a sound escalation strategy.

**Why a conflict taxonomy rather than generic "find contradictions"?** Google Research (2025) demonstrated that explicitly informing LLMs about conflict categories "significantly improves the quality and appropriateness of responses." Separately, contradiction detection research (arXiv, April 2025) found that "guided segmentation" — telling the model what type of conflict to look for — significantly outperforms "blind segmentation." The six-type taxonomy in the prompt (interface mismatch, technology contradiction, assumption conflict, scope overlap, naming inconsistency, gap) is tailored to the specific failure modes of parallel technical research spikes.

**Why hierarchical document presentation (summaries before full text)?** The CoTHSSum framework (Springer 2025) demonstrated that integrating hierarchical input segmentation with chain-of-thought prompting consistently outperformed flat presentation baselines across ROUGE, BLEU, BERTScore, and factual consistency. The BOOOOKSCORE study similarly found hierarchical merging produces more coherent summaries than incremental processing. Providing 100–150 word summaries before full documents gives the model a cognitive map that improves its ability to cross-reference during deep analysis.

**Why XML tags for document boundaries?** Anthropic's official prompting best practices explicitly recommend XML tags (`<documents>`, `<document index="n">`) for multi-document inputs. Claude was trained on structured prompts and parses XML tags natively. This is not a matter of prompt engineering preference — it's a platform-specific capability that measurably improves document boundary recognition.

**Why role-based prompting ("principal systems architect") despite mixed evidence?** Role-based prompting research shows it does not reliably improve factual accuracy on benchmarks. However, for complex analytical tasks, it effectively anchors domain-specific vocabulary, reasoning patterns, and output style. The role here doesn't aim to make Claude "smarter" — it aims to activate the architectural reasoning frame (separation of concerns, interface design, dependency analysis) that produces the most useful synthesis. Anthropic's Claude 4.x documentation confirms that "even a single sentence [setting a role] makes a difference."

**Why the five specific verification checks in Pass 5?** Generic self-correction ("review and improve your work") consistently decreases accuracy (Huang et al., 2023). But structured verification with specific criteria works when it provides a "distinct lens" for evaluation. The five checks (trace-through, data flow, error propagation, configuration completeness, dependency cycles) are each designed to catch a specific class of synthesis failure: missed interface mismatches, schema inconsistencies, incomplete error chains, orphaned configuration values, and circular dependencies respectively. Each check is specific enough to serve as what the research calls a "verification classifier."

**Why include confidence levels per decision?** CISC research (ACL Findings 2025) demonstrated that LLMs can effectively judge correctness when given structured self-assessment frameworks, and that confidence-weighted approaches reduce required reasoning paths by over 40%. Calibrated confidence levels serve a dual purpose: they guide human reviewers to focus attention on low-confidence decisions, and they prevent the common failure mode where synthesis outputs present speculative gap-fills with the same authority as well-supported consensus decisions.

---

## What this approach cannot do

The research reveals important limitations worth acknowledging. LLMs exhibit a persistent **bias toward evidence that appears first** in the context (EMNLP 2024), and while strategic document ordering mitigates this, it cannot eliminate it entirely. Self-verification without external feedback has fundamental ceiling effects — the model cannot reliably catch errors in its own reasoning when the error stems from a flawed understanding of the source material. The "75% context utilization" principle means that if your six spikes genuinely require 150K+ tokens of input, quality may degrade even with a 200K context window. Finally, no amount of prompt engineering can compensate for fundamental gaps in the source spikes themselves — if critical cross-cutting concerns (authentication, deployment, monitoring) were not investigated by any spike, the synthesis can identify these gaps but cannot reliably fill them.

The strongest mitigation for all these limitations is the same: **human review of the Conflict Register, Gap Register, and low-confidence decisions**, using the validation checklist as a systematic guide. The prompt is designed to make this review efficient by surfacing exactly where human judgment is needed rather than asking the reviewer to re-read everything.