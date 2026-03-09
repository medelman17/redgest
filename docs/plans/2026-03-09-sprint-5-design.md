# Sprint 5 Design: Pipeline Orchestration

**Sprint Goal:** Build the complete digest pipeline (WS6) to unblock WS7 (MCP Server)

**Scope:** 4 WS6 tasks (5pt) + 1 WS4 task (0.5pt) = 5.5pt

---

## Architecture Decision Records

### ADR-009: Decomposed Step Functions

The pipeline is four composable step functions, each independently callable:

```
fetchStep(jobId, subreddit, source) → FetchStepResult
triageStep(jobId, posts, insightPrompts, targetCount) → TriageStepResult
summarizeStep(jobId, post, comments, insightPrompts) → SummarizeStepResult
assembleStep(jobId, subredditResults) → AssembleStepResult
```

An orchestrator function `runDigestPipeline()` composes them. It lives in `packages/core/src/pipeline/`. Each step is a pure function that takes explicit dependencies — no global state. This maps cleanly to Trigger.dev tasks in Phase 2.

**Rationale:** Trigger.dev v4 wants granular tasks. Decomposed steps give natural retry boundaries — a failed summarization doesn't re-fetch from Reddit. The orchestrator is just the composition of steps.

### ADR-010: Character-Based Token Budgeting

Token estimation uses `Math.ceil(text.length / 3.5)` — conservative heuristic with ~12% safety margin over the typical 4:1 character-to-token ratio. Two budgets:

- **Triage:** ~8K tokens total for all candidates
- **Summarization:** ~9.7K tokens per post (body + comments)

A `TokenBudget` utility handles allocation and truncation decisions. No tokenizer library dependency needed.

### ADR-011: Comments-First Truncation

When content exceeds the token budget:

1. Title/metadata always preserved (negligible size)
2. Remove lowest-score comments first until under budget
3. If still over, truncate post body from the end
4. Append `[truncated]` marker to any truncated field so the LLM knows content was cut

**Rationale:** The post body is what the LLM is summarizing, so preserving it is higher priority. Low-score comments add the least signal.

### ADR-012: Digest-Based Deduplication

Query `digest_posts` joined with `posts` for the last N digests (default N=3). Match on `redditId`. Posts that were fetched but not selected by triage are NOT excluded — they get another chance (scores change, new comments appear).

### ADR-013: Two-Level Error Recovery

- **Per-subreddit:** Failed fetch or triage skips the subreddit, continues with others
- **Per-post:** Failed summarization skips that post, continues with remaining posts in the subreddit
- Job status: `COMPLETED` (all succeeded), `PARTIAL` (some skipped), `FAILED` (zero content produced)
- No internal retries in step functions — LLM functions and Reddit client already retry internally

### ADR-014: Markdown-Only Assembly

Generate `contentMarkdown` only. Store `null` for `contentHtml` and `contentSlackBlocks`. HTML and Slack rendering are Phase 2 delivery concerns in `@redgest/email` and `@redgest/slack`.

### ADR-015: ContentSource Interface

```typescript
interface ContentSource {
  fetchContent(subreddit: string, options: FetchOptions): Promise<FetchedContent>;
}
```

`RedditContentSource` wraps `RedditClient` + `TokenBucket` + `fetchSubredditContent()`. Pipeline depends on the interface, not concrete Reddit types. Clean seam for testing (mock the interface, not Reddit).

---

## Data Flow

```
runDigestPipeline(jobId, subredditIds, deps)
  │
  ├─ Update job status → RUNNING
  ├─ Load subreddits from DB (get insightPrompts, maxPosts)
  ├─ Load config (globalInsightPrompt, defaultLookback)
  ├─ Load previous digest post IDs for dedup (last 3 digests)
  │
  ├─ For each subreddit (with per-sub error recovery):
  │   ├─ fetchStep() → FetchedContent
  │   │   └─ Upsert posts + comments to DB
  │   ├─ Filter out deduplicated posts
  │   ├─ triageStep() → selected post indices + rationales
  │   │   └─ Token budget applied to candidates before calling LLM
  │   └─ For each selected post (with per-post error recovery):
  │       └─ summarizeStep() → PostSummary
  │           └─ Token budget applied (comments-first truncation)
  │           └─ Save PostSummary to DB
  │
  ├─ assembleStep() → contentMarkdown
  │   └─ Create Digest + DigestPost records
  │
  ├─ Update job status → COMPLETED | PARTIAL | FAILED
  └─ Emit DigestCompleted or DigestFailed event
```

---

## Pipeline Dependencies (injected)

```typescript
interface PipelineDeps {
  db: PrismaClient;
  eventBus: DomainEventBus;
  contentSource: ContentSource;
  config: RedgestConfig;
  model?: ModelConfig;
}
```

---

## Step Function Contracts

### fetchStep

```typescript
async function fetchStep(
  subreddit: { name: string; maxPosts: number; includeNsfw: boolean },
  source: ContentSource,
  db: PrismaClient,
): Promise<FetchStepResult>

interface FetchStepResult {
  subreddit: string;
  posts: Array<{ postId: string; redditId: string; post: RedditPostData; comments: RedditCommentData[] }>;
  fetchedAt: Date;
}
```

- Calls `source.fetchContent()` with subreddit-specific options
- Upserts posts and comments to DB (idempotent on `redditId`)
- Returns post IDs for downstream steps

### triageStep

```typescript
async function triageStep(
  candidates: TriagePostCandidate[],
  insightPrompts: string[],
  targetCount: number,
  model?: LanguageModel,
): Promise<TriageStepResult>

interface TriageStepResult {
  selected: Array<{ index: number; relevanceScore: number; rationale: string }>;
}
```

- Applies token budget to candidate list before calling LLM
- Calls `generateTriageResult()` with budget-constrained candidates
- Returns selected indices with scores and rationales

### summarizeStep

```typescript
async function summarizeStep(
  post: SummarizationPost,
  comments: SummarizationComment[],
  insightPrompts: string[],
  jobId: string,
  postId: string,
  db: PrismaClient,
  model?: LanguageModel,
): Promise<SummarizeStepResult>

interface SummarizeStepResult {
  postSummaryId: string;
  summary: PostSummary;
}
```

- Applies token budget with comments-first truncation
- Calls `generatePostSummary()` with budget-constrained content
- Saves `PostSummary` to DB linked to post and job
- Returns the saved summary ID

### assembleStep

```typescript
async function assembleStep(
  jobId: string,
  subredditResults: SubredditPipelineResult[],
  db: PrismaClient,
): Promise<AssembleStepResult>

interface AssembleStepResult {
  digestId: string;
  contentMarkdown: string;
  postCount: number;
}
```

- Renders all summaries into a structured markdown document
- Creates `Digest` record with `contentMarkdown` (null for HTML and Slack)
- Creates `DigestPost` records linking posts to the digest with rank ordering

---

## File Structure

```
packages/core/src/pipeline/
  ├── types.ts          # PipelineDeps, step result types, ContentSource interface
  ├── orchestrator.ts   # runDigestPipeline()
  ├── fetch-step.ts     # fetchStep()
  ├── triage-step.ts    # triageStep()
  ├── summarize-step.ts # summarizeStep()
  ├── assemble-step.ts  # assembleStep()
  ├── token-budget.ts   # estimateTokens(), truncateToFit()
  ├── dedup.ts          # findPreviousPostIds()
  └── index.ts          # barrel exports

packages/reddit/src/
  └── content-source.ts # RedditContentSource implements ContentSource
```

---

## Markdown Digest Format

```markdown
# Reddit Digest — {date}

## r/{subreddit}

### {post title}
**Score:** {score} | **Comments:** {count} | **Sentiment:** {sentiment}

{summary}

**Key Takeaways:**
- {takeaway 1}
- {takeaway 2}
- {takeaway 3}

**Interest Notes:** {insightNotes}

**Community Highlights:**
> {comment highlight 1} — u/{author} ({score})
> {comment highlight 2} — u/{author} ({score})

---

{repeat for each post}

## r/{next subreddit}
...
```

---

## Integration with Existing CQRS

The pipeline does NOT go through the command bus. The command bus creates the Job (`GenerateDigest` → `QUEUED`). The pipeline is triggered by the `DigestRequested` event and operates directly on the database. It emits progress events (`PostsFetched`, `PostsTriaged`, `PostsSummarized`) and terminal events (`DigestCompleted` / `DigestFailed`) through the event bus.

This is intentional — the pipeline is async background work, not a synchronous command. In Phase 2, Trigger.dev replaces the in-process event handler but calls the same step functions.
