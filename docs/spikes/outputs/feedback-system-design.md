# Feedback System Design — Brainstorm

> **Status:** Brainstorm / Design Exploration
> **Date:** 2026-03-14
> **Context:** Multi-tenant support (users + orgs) is imminent. This explores how users can provide feedback on digests and how the LLM pipeline can learn from that feedback.

---

## 1. The Problem

Redgest generates digests through a two-pass LLM pipeline (triage → summarize), guided by insight prompts at three levels (global, profile, subreddit). Today, if a digest isn't useful, the only recourse is manually editing insight prompts — a blunt instrument that requires the user to understand prompt engineering.

We want users to express preferences naturally ("this summary was too long," "I don't care about meme posts," "more of this kind of analysis") and have the system adapt over time.

---

## 2. What Can Users Give Feedback On?

Feedback targets exist at multiple granularities, each influencing different pipeline stages:

### 2.1 Digest-Level (affects triage + assembly)
- **Overall quality:** Was this digest useful today? (thumbs up/down + optional text)
- **Length/density:** Too many posts? Too few? Right amount?
- **Coverage:** Missing a subreddit or topic I care about?

### 2.2 Post Selection (affects triage)
- **Relevance:** "This post shouldn't have been included" / "This was exactly what I wanted"
- **Missing posts:** "I saw [post X] on Reddit and expected it in my digest" (hard to capture but very valuable)
- **Ranking:** "This should have been higher/lower"

### 2.3 Summary Quality (affects summarization)
- **Accuracy:** "This summary missed the main point"
- **Length:** "Too verbose" / "Too terse — I wanted more detail"
- **Key takeaways:** "These takeaways were/weren't useful"
- **Insight notes:** "The connection to my interests was spot-on" / "This connection was a stretch"
- **Sentiment:** "Wrong sentiment classification"

### 2.4 Comment Highlights (affects summarization)
- **Selection:** "These weren't the most insightful comments"
- **Missing voices:** "The contrarian view was more interesting than what was highlighted"

### 2.5 Meta-Level (affects insight prompts)
- **Interest drift:** "I'm no longer interested in X" / "I've become interested in Y"
- **Style preferences:** "I prefer bullet points over paragraphs" / "Include more technical depth"

---

## 3. How the LLM Can "Learn"

We're not fine-tuning models. "Learning" means adapting the context and instructions the LLM receives. There are several mechanisms, from simple to sophisticated:

### 3.1 Feedback-Augmented Prompts (Simplest, Highest Impact)

**Mechanism:** Inject aggregated feedback into the system prompt for triage and summarization.

```
<user_preferences learned_from="feedback">
- User consistently rates technical deep-dives as highly relevant (12 thumbs up)
- User has flagged meme/humor posts as irrelevant 4 times
- User prefers shorter summaries (3 "too verbose" signals)
- User values contrarian comment highlights over consensus views
</user_preferences>
```

**How it works:**
1. Periodically (or per-digest) synthesize recent feedback into a structured preference summary
2. An LLM call distills raw feedback into actionable preference statements
3. These statements are injected into triage/summarize system prompts alongside insight prompts
4. Stale preferences decay over time (feedback has a half-life)

**Pros:** Simple, no schema changes to pipeline logic, leverages LLM's instruction-following.
**Cons:** Prompt bloat, preferences may conflict, hard to guarantee behavior change.

### 3.2 Insight Prompt Auto-Refinement (Medium Complexity)

**Mechanism:** Use feedback patterns to suggest or auto-apply refinements to insight prompts.

**Flow:**
1. Accumulate feedback signals (e.g., 5 "irrelevant" flags on crypto posts)
2. Periodically run a "reflection" LLM call:
   - Input: current insight prompts + recent feedback + example posts that got positive/negative signals
   - Output: suggested refined insight prompts
3. Present suggestions to user (MCP tool: `get_prompt_suggestions`) or auto-apply with confirmation

**Example:**
```
Current prompt: "I'm interested in distributed systems and cloud architecture"
Feedback pattern: 3x thumbs down on Kubernetes operator posts, 5x thumbs up on database internals
Suggested refinement: "I'm interested in distributed systems and cloud architecture,
  especially database internals and consensus protocols. Less interested in
  Kubernetes operator patterns."
```

**Pros:** Directly improves the primary relevance signal, user-visible and auditable.
**Cons:** Risk of drift, needs guard rails, user must review.

### 3.3 Few-Shot Exemplars (Medium Complexity)

**Mechanism:** Use highly-rated summaries as examples in the summarization prompt.

**Flow:**
1. Track which summaries get positive feedback
2. Select top-rated summaries as few-shot examples
3. Include 1-2 exemplars in the summarize system prompt: "Here's an example of a summary this user rated highly: ..."

**Pros:** Teaches style and depth preferences by example, very effective for tone/format.
**Cons:** Token budget pressure (exemplars are expensive), may overfit to specific topics.

### 3.4 Exclusion/Inclusion Rules (Simple, Deterministic)

**Mechanism:** Hard rules derived from strong negative/positive feedback.

**Examples:**
- "Never include posts with flair 'Meme'" (after 3+ irrelevant flags on meme posts)
- "Always include posts mentioning 'Rust'" (after consistent positive signals)
- "Exclude author u/spambot123" (after explicit user request)

**Implementation:** Stored as structured filters on the profile or user level, applied pre-triage (before LLM call), reducing noise and cost.

**Pros:** Deterministic, no LLM cost, immediately effective.
**Cons:** Rigid, can over-filter, needs careful UX to manage rules.

### 3.5 Preference-Weighted Triage Scoring (Advanced)

**Mechanism:** Modify triage scoring weights based on feedback patterns.

Currently: RELEVANCE (40%), INFORMATION DENSITY (20%), NOVELTY (20%), DISCUSSION QUALITY (20%)

If a user consistently upvotes posts with high comment counts and downvotes link-only posts:
- Adjust to: RELEVANCE (35%), INFORMATION DENSITY (15%), NOVELTY (15%), DISCUSSION QUALITY (35%)

**Implementation:** Per-user weight overrides stored alongside preferences, injected into triage prompt.

**Pros:** Fine-grained control, adapts scoring to user behavior.
**Cons:** Hard to communicate to user, may cause unexpected shifts, complex to debug.

### 3.6 RAG Over Feedback History (Advanced)

**Mechanism:** Store feedback with embeddings, retrieve relevant past feedback when generating new digests.

**Flow:**
1. When triaging posts about "React Server Components," retrieve past feedback on similar topics
2. If user previously flagged React posts as irrelevant unless they involve performance, inject that context
3. Semantic similarity between incoming post content and past feedback enables topic-specific preferences

**Pros:** Handles nuanced, topic-specific preferences without bloating the system prompt.
**Cons:** Adds latency, embedding cost, retrieval complexity. Risk of surfacing stale/contradictory feedback.

---

## 4. Proposed Data Model

### 4.1 Core Feedback Tables

```
feedback
  id              UUID v7 (PK)
  userId          UUID v7 (FK → users)       -- multi-tenant
  targetType      ENUM: DIGEST | POST_SELECTION | SUMMARY | COMMENT_HIGHLIGHT | META
  targetId        UUID v7                     -- polymorphic: digestId, digestPostId, postSummaryId
  jobId           UUID v7 (FK → jobs)         -- which digest run this feedback is about
  signal          ENUM: THUMBS_UP | THUMBS_DOWN | RATING
  rating          INT (1-5, nullable)         -- for RATING signal type
  category        TEXT (nullable)             -- structured: "too_verbose", "irrelevant", "missing_context", etc.
  comment         TEXT (nullable)             -- free-text explanation
  metadata        JSONB (default {})          -- extensible: { suggestedRank, expectedPostRedditId, etc. }
  createdAt       TIMESTAMP
```

```
feedback_preferences                          -- synthesized from feedback
  id              UUID v7 (PK)
  userId          UUID v7 (FK → users)
  profileId       UUID v7 (FK → digest_profiles, nullable)  -- profile-scoped or global
  preferenceType  ENUM: STYLE | RELEVANCE | EXCLUSION | WEIGHT | INSTRUCTION
  key             TEXT                        -- e.g., "summary_length", "exclude_flair", "triage_weight_relevance"
  value           JSONB                       -- type-dependent value
  confidence      FLOAT (0-1)                -- derived from signal count + recency
  signalCount     INT                         -- how many feedback items contributed
  lastUpdatedAt   TIMESTAMP
  expiresAt       TIMESTAMP (nullable)        -- preference decay
  createdAt       TIMESTAMP
```

```
feedback_synthesis_runs                       -- audit trail for preference derivation
  id              UUID v7 (PK)
  userId          UUID v7 (FK → users)
  feedbackCount   INT                         -- inputs processed
  preferencesUpdated INT                      -- preferences created/modified
  llmCallId       UUID v7 (FK → llm_calls, nullable)  -- if LLM used for synthesis
  createdAt       TIMESTAMP
```

### 4.2 View

```sql
CREATE VIEW feedback_view AS
SELECT
  f.id AS "feedbackId",
  f."userId",
  f."targetType",
  f."targetId",
  f."jobId",
  f.signal,
  f.rating,
  f.category,
  f.comment,
  f."createdAt",
  -- join context
  j.status AS "jobStatus",
  CASE f."targetType"
    WHEN 'DIGEST' THEN d."contentMarkdown"
    WHEN 'SUMMARY' THEN ps.summary
    ELSE NULL
  END AS "targetContent",
  CASE f."targetType"
    WHEN 'POST_SELECTION' THEN p.title
    WHEN 'SUMMARY' THEN p.title
    ELSE NULL
  END AS "postTitle"
FROM feedback f
JOIN jobs j ON j.id = f."jobId"
LEFT JOIN digests d ON f."targetType" = 'DIGEST' AND d.id = f."targetId"
LEFT JOIN post_summaries ps ON f."targetType" = 'SUMMARY' AND ps.id = f."targetId"
LEFT JOIN digest_posts dp ON f."targetType" = 'POST_SELECTION' AND dp."digestId" = f."targetId"
LEFT JOIN posts p ON p.id = COALESCE(ps."postId", dp."postId");
```

### 4.3 Relationship to Existing Model

```
User (new)
  └─ feedback[]
  └─ feedback_preferences[]

DigestProfile
  └─ feedback_preferences[] (profile-scoped preferences)

Job
  └─ feedback[] (feedback about this run)

Digest
  └─ feedback[] (where targetType = DIGEST)

PostSummary
  └─ feedback[] (where targetType = SUMMARY)

DigestPost
  └─ feedback[] (where targetType = POST_SELECTION)
```

---

## 5. Feedback → Pipeline Integration Points

### 5.1 Triage System Prompt Injection

```typescript
// In triageStep(), before calling LLM:
const preferences = await loadUserPreferences(userId, profileId);
const feedbackContext = renderPreferencesForTriage(preferences);

// Injected into system prompt:
// <user_preferences>
//   - Prefers technical deep-dives over news announcements
//   - Exclude posts with flair: "Meme", "Shitpost"
//   - Increase weight on discussion quality (user engages with high-comment posts)
// </user_preferences>
```

### 5.2 Summarization Style Injection

```typescript
// In summarizeStep(), before calling LLM:
const stylePrefs = await loadStylePreferences(userId);
const exemplar = await loadBestRatedSummary(userId, post.subreddit);

// Injected into system prompt:
// <style_preferences>
//   - Keep summaries under 3 sentences (user flagged verbose 4x)
//   - Emphasize practical takeaways over theoretical discussion
//   - Include code snippets when present in original post
// </style_preferences>
//
// <exemplar_summary rating="5/5">
//   [Previously highly-rated summary for reference]
// </exemplar_summary>
```

### 5.3 Pre-Triage Filtering

```typescript
// Before triageStep(), apply hard exclusion rules:
const exclusions = await loadExclusionRules(userId, profileId);
const filteredCandidates = candidates.filter(post => {
  if (exclusions.flairs.includes(post.flair)) return false;
  if (exclusions.authors.includes(post.author)) return false;
  if (exclusions.keywords.some(kw => post.title.includes(kw))) return false;
  return true;
});
```

### 5.4 Post-Digest Preference Synthesis (Background Job)

```typescript
// Triggered periodically or after N feedback items:
async function synthesizePreferences(userId: string) {
  const recentFeedback = await loadRecentFeedback(userId, { since: "30d" });
  const currentPreferences = await loadUserPreferences(userId);

  // LLM-assisted synthesis
  const { data: newPreferences } = await generateText({
    system: `Analyze user feedback on digest content and derive preferences.
             Current preferences: ${JSON.stringify(currentPreferences)}
             Produce updated preference statements.`,
    prompt: formatFeedbackForSynthesis(recentFeedback),
    output: Output.object({ schema: PreferenceSchema }),
  });

  await upsertPreferences(userId, newPreferences);
}
```

---

## 6. MCP Tools

### 6.1 Feedback Capture

```typescript
submit_feedback(args: {
  targetType: "digest" | "post_selection" | "summary" | "comment_highlight" | "meta";
  targetId: string;         // ID of the target entity
  signal: "thumbs_up" | "thumbs_down" | "rating";
  rating?: number;          // 1-5, required if signal = "rating"
  category?: string;        // "too_verbose" | "irrelevant" | "missing_context" | "wrong_sentiment" | ...
  comment?: string;         // free-text
}) → { feedbackId: string }
```

### 6.2 Feedback Review

```typescript
get_feedback(args: {
  digestId?: string;        // feedback for a specific digest
  limit?: number;
  since?: string;           // duration string
}) → FeedbackView[]

get_preferences(args: {
  profileId?: string;       // profile-scoped or global
}) → FeedbackPreference[]
```

### 6.3 Preference Management

```typescript
get_prompt_suggestions(args: {
  profileId?: string;
}) → {
  currentPrompt: string;
  suggestedPrompt: string;
  reasoning: string;
  feedbackSummary: string;
}

apply_prompt_suggestion(args: {
  profileId?: string;       // which profile to update
  suggestion: string;       // the suggested prompt text
}) → { updated: boolean }

reset_preferences(args: {
  profileId?: string;
  preferenceType?: string;  // reset specific type or all
}) → { cleared: number }
```

### 6.4 Feedback Analytics

```typescript
get_feedback_summary(args: {
  since?: string;           // "7d", "30d"
  profileId?: string;
}) → {
  totalFeedback: number;
  positiveRate: number;
  topCategories: Array<{ category: string; count: number }>;
  preferencesDerived: number;
  recentTrends: string;     // LLM-generated natural language summary
}
```

---

## 7. UX Touchpoints

### 7.1 In-Digest Feedback (Email/Slack)

**Email:** Each post section includes thumbs up/down links (mailto: or API callback URL). Bottom of digest has overall quality rating.

**Slack:** Each post block has reaction-based feedback (thumbs up/down emoji reactions). Bot watches for reactions and records feedback.

**MCP (Claude):** After presenting a digest, Claude can ask "Any feedback on this digest?" and use `submit_feedback` based on natural language response.

### 7.2 Web UI Feedback

**Digest view page:**
- Overall digest rating (star rating or thumbs)
- Per-post thumbs up/down + "Why?" dropdown (too verbose, irrelevant, etc.)
- "Missing something?" prompt to flag expected-but-absent posts
- Per-summary expand/collapse with inline feedback buttons

**Preferences dashboard:**
- View derived preferences with confidence scores
- Toggle preferences on/off
- See which feedback items contributed to each preference
- "Suggest prompt improvements" button → shows diff of current vs suggested insight prompt

### 7.3 Conversational Feedback (MCP-First)

The most natural feedback channel for an MCP-first product:

```
User: "That last digest was great but the summary for the Rust post was way too long"
Claude: → submit_feedback(targetType: "summary", targetId: "<rust-post-summary-id>",
          signal: "thumbs_down", category: "too_verbose",
          comment: "User said summary was 'way too long'")
       → submit_feedback(targetType: "digest", targetId: "<digest-id>",
          signal: "thumbs_up", comment: "User said digest was 'great' overall")

User: "Stop including cryptocurrency posts, I don't care about them anymore"
Claude: → submit_feedback(targetType: "meta", targetId: "<profile-id>",
          signal: "thumbs_down", category: "irrelevant",
          comment: "User wants to exclude cryptocurrency content",
          metadata: { action: "exclude", topic: "cryptocurrency" })
```

---

## 8. Feedback Lifecycle

```
                    ┌──────────────────────────────────────────┐
                    │              FEEDBACK LOOP               │
                    │                                          │
  ┌─────────┐      │  ┌──────────┐    ┌──────────────────┐    │   ┌─────────────┐
  │  Digest  │──────┼─▶│ Capture  │───▶│    Accumulate     │───┼──▶│  Synthesize  │
  │ Delivery │      │  │ feedback │    │  in feedback tbl  │   │   │ preferences  │
  └─────────┘      │  └──────────┘    └──────────────────┘    │   └──────┬──────┘
       ▲           │                                          │          │
       │           │                                          │          ▼
       │           │  ┌──────────────────────────────────┐    │   ┌─────────────┐
       │           │  │        Next Digest Run            │    │   │   Inject     │
       └───────────┼──│  triage + summarize with prefs    │◀──┼───│  into LLM    │
                   │  └──────────────────────────────────┘    │   │   prompts    │
                   │                                          │   └─────────────┘
                   └──────────────────────────────────────────┘
```

**Timing:**
- **Capture:** Immediately on user action (click, message, reaction)
- **Accumulate:** Raw feedback stored, no processing
- **Synthesize:** Triggered after N new feedback items (e.g., 5) or on schedule (e.g., weekly). Can also be triggered manually via MCP tool.
- **Inject:** On next digest run, load current preferences and inject into prompts

---

## 9. Multi-Tenant Considerations

### 9.1 Feedback Scoping

```
Organization
  └─ User
       └─ Feedback (personal)
       └─ Preferences (personal)
  └─ Shared Profiles
       └─ Aggregated Preferences (org-wide, from all users' feedback)
```

- **Personal feedback** affects only that user's digests
- **Shared profile feedback** is aggregated — if 3/5 users flag crypto as irrelevant, the shared profile learns this
- **Org-level insight prompts** can be refined from collective feedback (with admin approval)

### 9.2 Conflict Resolution

When multiple users in an org give conflicting feedback on a shared profile:
- **Majority rules** for strong signals (3+ users agree)
- **Personal override** — user-level preferences override org-level for their own digests
- **Admin arbitration** — flag conflicts for admin review
- **Preference splitting** — suggest creating separate profiles when preferences diverge significantly

### 9.3 Privacy

- Users can see only their own raw feedback
- Org admins can see aggregated trends but not individual comments
- Preference synthesis uses anonymized signals
- Feedback on shared profiles shows aggregate counts, not individual attributions

---

## 10. Preference Decay & Freshness

Feedback has a half-life. Interests change. The system should:

1. **Time-weight feedback** — Recent feedback counts more than old feedback
2. **Confidence decay** — Preferences lose confidence over time if not reinforced
3. **Staleness detection** — If a preference hasn't been reinforced in 60 days, mark it as stale and reduce its injection weight
4. **Active confirmation** — Periodically ask "Are you still interested in X?" for low-confidence preferences
5. **Seasonal awareness** — Some interests are cyclical (e.g., tax season, conference season)

**Decay formula:**
```
effective_confidence = base_confidence * exp(-λ * days_since_last_signal)
```
Where λ is tunable (default: preferences halve in ~45 days without reinforcement).

---

## 11. Recommended Phased Approach

### Phase A: Foundation (Build First)
- `feedback` table + CQRS commands/queries
- `submit_feedback` and `get_feedback` MCP tools
- Conversational feedback capture (Claude interprets natural language → structured feedback)
- Simple thumbs up/down on digests and post selections

### Phase B: Prompt Injection (Highest ROI)
- `feedback_preferences` table + synthesis pipeline
- Inject aggregated preferences into triage/summarize system prompts
- `get_preferences` MCP tool
- Basic exclusion rules (flair, author, keyword filters)

### Phase C: Prompt Refinement
- `get_prompt_suggestions` tool — LLM analyzes feedback and suggests insight prompt changes
- `apply_prompt_suggestion` tool
- Few-shot exemplar selection from highly-rated summaries
- Preference decay and staleness management

### Phase D: Rich Feedback Channels
- Email feedback links (callback URLs)
- Slack reaction tracking
- Web UI feedback components
- Feedback analytics dashboard

### Phase E: Multi-Tenant Aggregation
- Org-level preference aggregation
- Conflict detection and resolution
- Privacy controls
- Shared vs personal preference scoping

---

## 12. Open Questions

1. **Feedback granularity vs. friction:** Thumbs up/down is low-friction but low-signal. Star ratings are higher-signal but higher-friction. What's the right default?

2. **Automatic vs. confirmed preference updates:** Should preferences auto-update from feedback, or should the user confirm changes? Auto-update is seamless but risks drift; confirmation is safer but adds friction.

3. **How many few-shot exemplars?** Each exemplar costs ~500-1000 tokens. With the current summarization budget (~27.5K tokens/sub), we could afford 1-2 per call. Is that enough to be useful?

4. **Feedback on missing posts:** How does a user flag "I expected to see post X but it wasn't in my digest"? This requires knowing what the user saw on Reddit — hard to capture. Possible approaches: show triage rejects in a "see more" section, or let the user paste a Reddit URL.

5. **Cold start:** New users have no feedback history. Should we bootstrap from org-level preferences? From the insight prompt content? From a brief onboarding quiz?

6. **Feedback attribution for shared digests:** When multiple users receive the same digest (shared profile), whose feedback wins? Per-user delivery with personal overlays, or majority-rules on the shared profile?

7. **Synthesis frequency:** Run synthesis after every N feedback items? On a schedule? On-demand? Balance between freshness and LLM cost.

8. **Guardrails on auto-refined prompts:** How do we prevent feedback-driven prompt drift from making insight prompts incoherent? Max edit distance per synthesis? Human-in-the-loop always?

---

## 13. Key Insight: The Feedback Flywheel

The most powerful aspect of this system is the **feedback flywheel**:

```
Better digests → More engagement → More feedback → Better preferences → Better digests
```

The system gets more valuable over time as it learns each user's preferences. This is a strong retention mechanism and a key differentiator from static RSS readers or generic AI summaries.

The critical design choice is **where in the loop to close it fastest.** Prompt injection (Phase B) gives the quickest feedback-to-improvement cycle. Prompt refinement (Phase C) gives the most durable improvements. Both should be pursued, with prompt injection first for quick wins.
