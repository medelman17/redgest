# Research Task: MCP API Design for "Redgest"

## Context

I'm building **Redgest**, a personal Reddit digest engine. It monitors subreddits, uses LLMs to select and summarize interesting posts based on user-defined interest prompts, and delivers digests via MCP (Model Context Protocol), email, and Slack.

**The MCP server is the primary interface.** It exposes a set of tools that AI agents (primarily Claude) use to trigger digest generation, query content, manage configuration, and interact with historical data. The MCP server is a standalone Node.js service — not embedded in a web framework — that translates tool calls into either CQRS commands (writes) or view queries (reads) against a Postgres database.

This spike is about **designing the MCP API surface with obsessive care.** The tool definitions — names, descriptions, parameter schemas, response shapes, error contracts, and compositional patterns — are the product's UX. Agents are the primary users. Their experience matters as much as a human developer's experience with a well-designed REST API.

## Design Philosophy: Agents as Developers

We're taking what I'll call the "Jared Palmer" approach to MCP API design. The core idea:

**Treat agents as developers interacting with your system. Design the API surface with the same rigor you'd apply to a public developer-facing API.** Specifically:

1. **Tool names are verbs** that read naturally in an agent's planning chain. The agent should be able to "think": *"The user wants a fresh digest → I should call `generate_digest` → then poll `get_run_status` → then fetch with `get_digest`."* The names should make the workflow self-evident.

2. **Tool descriptions are documentation.** They tell the agent *when* to use the tool, not just what it does. A good description includes: what the tool does, when to use it, what to do with the result, and how it relates to other tools. Descriptions are part of the API contract — they directly influence agent behavior.

3. **Response envelopes are consistent.** Every tool returns the same top-level shape. The agent never has to guess how to parse a response. No per-tool response parsing logic.

4. **Error shapes are machine-readable.** Agents need to branch on error types, not parse error messages. Errors have codes, messages, and optional details.

5. **Tools are composable primitives.** No god-endpoints. `generate_digest` doesn't return content — it returns a job reference. `get_digest` fetches content. `get_post` drills into a single post. The agent composes these into workflows. Each tool does one thing.

6. **Parameters have sensible defaults.** An agent should be able to call most tools with minimal parameters and get useful results. Required parameters are truly required; everything else has a default.

7. **The tool set is discoverable.** An agent seeing the tool list for the first time should understand the system's capabilities within seconds. Tool names and descriptions form a self-documenting API.

## System Architecture (What the API Sits On Top Of)

### CQRS Pattern

The system uses Command Query Responsibility Segregation:

- **Commands** (write path): `GenerateDigest`, `AddSubreddit`, `RemoveSubreddit`, `UpdateSubreddit`, `UpdateConfig`. These mutate state and emit domain events. Commands are processed by handlers that validate, persist, emit events, and return a result.
- **Queries** (read path): Read from Postgres views (`digest_view`, `post_view`, `run_view`, `subreddit_view`). These are denormalized, pre-joined views optimized for specific access patterns. Queries never mutate state.

**MCP tools map cleanly to this split:** configuration and pipeline tools dispatch commands; content access tools execute queries.

### Job-Based Pipeline

Digest generation is async and job-based:
1. `generate_digest` creates a job (status: `queued`) and returns `{ jobId }` immediately.
2. A background worker (Trigger.dev) executes the pipeline: Reddit fetch → LLM triage → LLM summarization → digest assembly → delivery.
3. The job progresses through statuses: `queued` → `running` → `completed` | `failed` | `partial`.
4. The agent polls `get_run_status` to check progress, then calls `get_digest` to fetch the result.

### Data Model (Simplified)

- **`subreddits`** — Monitored subs with per-sub insight prompts, max posts, NSFW flag.
- **`config`** — Singleton global settings (insight prompt, lookback, delivery defaults, LLM provider/model, schedule).
- **`jobs`** — Immutable pipeline run records (status, timing, progress, error).
- **`posts`** — Reddit posts with raw content and metadata. Independent of digests.
- **`post_comments`** — Top comments per post.
- **`post_summaries`** — LLM-generated summaries linked to both a post and a job.
- **`digests`** — Assembled digest content (markdown, HTML, Slack blocks) per job.
- **`digest_posts`** — Join table: which posts in which digest, with rank/ordering.
- **`events`** — Append-only domain event log.

### What Agents Do With Redgest

Typical agent workflows:

1. **"What's new on Reddit?"** → `generate_digest` → poll `get_run_status` → `get_digest` → present to user → user asks about a specific post → `get_post`
2. **"What did r/LocalLLaMA say about quantization last week?"** → `search_posts` with query + subreddit + time range → present results → optionally `get_post` for details
3. **"Add r/machinelearning, focus on RL papers"** → `add_subreddit` → confirm
4. **"Show me last Tuesday's digest"** → `list_runs` with date filter → `get_digest` with jobId
5. **"What have my digests covered about MCP over the past month?"** → `search_digests` → synthesize answer
6. **"Change my global prompt to focus on developer tools"** → `update_config`
7. **"What subreddits am I monitoring?"** → `list_subreddits`

## Current Tool Set (From PRD — Needs Refinement)

The PRD defines 12 tools across three categories. **This is the starting point, not the final answer.** Your job is to validate, refine, and fully specify each tool.

### Pipeline Operations
| Tool | Description | Parameters | Returns |
|------|-------------|-----------|---------|
| `generate_digest` | Trigger a new digest run | `subreddits?`, `lookback?`, `delivery?` | `{ jobId, status }` |
| `get_run_status` | Poll job progress | `jobId` | `{ jobId, status, progress, timing, error? }` |
| `list_runs` | History of past runs | `status?`, `since?`, `limit?` | `{ runs: RunSummary[] }` |

### Content Access
| Tool | Description | Parameters | Returns |
|------|-------------|-----------|---------|
| `get_digest` | Fetch digest content | `jobId?`, `subreddit?` | `{ digest }` |
| `get_post` | Single post deep-dive | `postId` or `redditUrl` | `{ post }` |
| `search_posts` | Search stored posts | `query`, `subreddit?`, `since?` | `{ posts[] }` |
| `search_digests` | Search past digests | `query`, `since?` | `{ digests[] }` |

### Configuration
| Tool | Description | Parameters | Returns |
|------|-------------|-----------|---------|
| `list_subreddits` | Show monitored subs | none | `{ subreddits[] }` |
| `add_subreddit` | Add a sub | `name`, `insightPrompt?`, `maxPosts?`, `includeNsfw?` | `{ subreddit }` |
| `remove_subreddit` | Remove a sub | `name` | `{ removed: true }` |
| `update_subreddit` | Update sub settings | `name`, fields | `{ subreddit }` |
| `get_config` | Show global settings | none | `{ config }` |
| `update_config` | Change global settings | fields | `{ config }` |

## Research Questions

### 1. Tool Naming & Organization

**Is 12 tools the right number?** Research MCP API design best practices (as of early 2026) and evaluate:

- Are there tools that should be split? (e.g., should `search_posts` and `search_digests` be one `search` tool with a `scope` parameter?)
- Are there tools that should be merged? (e.g., is `get_config` / `update_config` better as a single `config` tool with optional update fields?)
- Are there missing tools? Consider: canceling a running job, re-running a specific digest, getting system health/status, exporting data, purging history.
- What's the cognitive load on an agent seeing 12 tools? Is that too many? Research suggests there's a sweet spot for MCP tool count — what is it?
- Naming conventions: `get_X` vs `fetch_X` vs `read_X`; `add_X` vs `create_X`; `update_X` vs `set_X` vs `configure_X`. What's the convention emerging in the MCP ecosystem? What feels most natural for agent planning?

### 2. Tool Descriptions as Agent Documentation

**Write production-quality descriptions for every tool.**

Each description should:
- Open with what the tool does in one sentence
- State when to use it (trigger conditions)
- Mention what to do with the result (next steps)
- Note relationships to other tools (workflow context)
- Include example user phrases that should trigger this tool
- Be concise — agents have limited context for tool descriptions

Research: What makes a great MCP tool description? Are there guidelines from Anthropic or the MCP community? How long should descriptions be before they hurt rather than help? Is there a difference between what works for Claude vs. other agents?

### 3. Parameter Schema Design

**Define the complete JSON Schema (or Zod schema) for every tool's parameters.**

For each parameter:
- Type (string, number, boolean, array, enum, object)
- Required vs. optional
- Default value (if optional)
- Description (agent-facing — what is this parameter and when should I provide it?)
- Constraints (min/max, pattern, enum values)
- Examples

Specific design questions:
- **Lookback period:** String format? `"24h"`, `"7d"`, `"2w"`? Or structured `{ value: 7, unit: "days" }`? Or ISO 8601 duration `"P7D"`? What's most natural for an agent to generate from user language like "last week"?
- **Subreddit names:** With or without `r/` prefix? Should the API normalize this (accept both `"LocalLLaMA"` and `"r/LocalLLaMA"`)?
- **Delivery channels:** Enum of `"none" | "email" | "slack" | "all"`, or an array like `["email", "slack"]`? Array is more flexible for future channels.
- **Search queries:** Plain text string, or structured query with operators? For a personal tool, plain text is probably right, but research what agents produce naturally.
- **Date ranges:** `since` as ISO 8601 datetime? As a duration string? As a natural language relative like `"last week"`? What can agents reliably produce?
- **Pagination:** Do `list_runs`, `search_posts`, `search_digests` need cursor-based pagination? Offset pagination? Or just a `limit` parameter with sensible defaults? Consider: agents don't paginate naturally. What happens if there are 200 results?

### 4. Response Envelope Design

**Design the standard response envelope and the specific response shapes for every tool.**

The PRD specifies `{ ok: boolean, data: T, error?: { code: string, message: string, details?: any } }`. Validate and refine this:

- Is `{ ok, data, error }` the right envelope? Or should we use MCP's native content/isError patterns?
- How does the MCP spec expect tool results to be returned? (The MCP spec defines tool results as `content` arrays with text/image/embedded-resource types.) Should we return structured JSON inside a text content block, or use the spec's structured content features?
- What does Claude actually parse best? If the response is a text content block containing JSON, vs. a structured object — which leads to better agent behavior?
- Research: How are production MCP servers returning structured data in early 2026? Is there a consensus pattern?

For each tool, define:
- The full response type (TypeScript interface)
- An example success response (realistic data)
- An example error response
- What data should be included vs. omitted? (e.g., should `get_digest` return full markdown content inline, or truncate with a "call get_post for details" pattern?)

### 5. Error Taxonomy

**Design the complete error code taxonomy.**

Every error the system can produce should have a machine-readable code. These codes are the branch points for agent decision-making.

Proposed categories:
- **Validation errors:** `INVALID_PARAMETER`, `MISSING_REQUIRED_PARAMETER`, `INVALID_LOOKBACK_FORMAT`, etc.
- **Not found errors:** `JOB_NOT_FOUND`, `POST_NOT_FOUND`, `SUBREDDIT_NOT_FOUND`, `DIGEST_NOT_FOUND`
- **Conflict errors:** `SUBREDDIT_ALREADY_EXISTS`, `JOB_ALREADY_RUNNING`
- **Pipeline errors:** `REDDIT_API_ERROR`, `LLM_API_ERROR`, `RATE_LIMIT_EXCEEDED`, `PIPELINE_TIMEOUT`
- **System errors:** `INTERNAL_ERROR`, `DATABASE_ERROR`, `UNAUTHORIZED`

Questions:
- Is this the right granularity? Too fine-grained and agents can't meaningfully branch. Too coarse and they can't recover.
- Should error codes be hierarchical (e.g., `PIPELINE.REDDIT_API_ERROR`) or flat?
- What should the agent DO when it gets each error? The error code should imply an action: retry, tell the user, try different parameters, etc. Can we encode this in the error shape?
- Should there be a `retryable: boolean` field on errors?
- Research: How do well-designed MCP servers handle errors? Is there an emerging pattern?

### 6. Compositional Patterns & Agent Workflows

**Design the tool composition patterns that agents will use.**

For each workflow in the "What Agents Do With Redgest" section above, trace the exact sequence of tool calls, including:
- What triggers each call
- What data flows from one call to the next (parameter threading)
- How errors at each step should be handled
- Where the agent should present intermediate results to the user

Then evaluate:
- Are there workflows that require too many round-trips? (Agent patience and context window are finite.)
- Are there workflows where the agent has to "guess" what to do next? (Tool descriptions should eliminate guessing.)
- Are there common patterns that could be simplified with a "convenience" tool? (e.g., a `quick_digest` that blocks and returns content directly — bypassing the job pattern — for small runs)
- Should any tool return "hints" about what to call next? (e.g., `generate_digest` response includes `"next": "Poll get_run_status with this jobId"`)

### 7. Content Representation

**How should digest content and post content be represented in MCP responses?**

This is a critical UX question. When Claude gets the response from `get_digest`, it needs to present it to the user. The format of the content directly affects presentation quality.

Options:
- **Structured JSON:** `{ subreddits: [{ name, posts: [{ title, summary, takeaways, insightNotes, url }] }] }` — Agent can format for the user however it wants. Most flexible.
- **Pre-rendered Markdown:** A markdown string with headers, bullets, links. Agent can present it directly or re-format.
- **Both:** Structured data for programmatic access + a pre-rendered markdown summary.
- **Hybrid:** Structured data with individual fields already formatted (e.g., `summary` is prose, `keyTakeaways` is a markdown list).

Questions:
- What works best for Claude when presenting to users? Does Claude prefer structured data it can reformat, or pre-rendered content it can pass through?
- How much content should `get_digest` return? The full digest with all posts, or a summary with "call `get_post` for more on any of these"?
- For `search_posts`, how much of each post should be in the search results? Title + snippet + relevance score? Full summary?
- Should responses include Reddit URLs so the user can click through to the original?
- Token budget: a digest for 10 subs × 5 posts = 50 post summaries. How many tokens is that? Could it blow the agent's context window? Should we paginate or truncate by default?

### 8. MCP Spec Alignment

**Ensure the API design aligns with the current MCP specification (November 2025 spec and later).**

- The MCP spec defines tool results as arrays of content blocks (`TextContent`, `ImageContent`, `EmbeddedResource`). How should our structured JSON responses fit into this?
- The November 2025 spec introduced **Tasks** — async operations with progress reporting. Our `generate_digest` → `get_run_status` polling pattern is exactly what Tasks are designed for. Should we use MCP Tasks instead of our custom polling? What's the adoption status?
- The spec includes **Resources** (URI-addressed data) and **Prompts** (reusable prompt templates). Should any of our data be exposed as MCP Resources (e.g., `redgest://digest/latest`, `redgest://post/{id}`)? Should we offer MCP Prompts (e.g., a "digest summary" prompt template)?
- **Sampling** and **Elicitation** — are there features of the MCP spec that could enhance our API beyond basic tool calls?
- Research: What MCP features beyond tools are production MCP servers actually using in early 2026?

### 9. Versioning & Evolution

- How should the API handle backward-incompatible changes? Version in tool names (`generate_digest_v2`)? In a metadata field?
- If we add new tools in Phase 4 (search), do existing agents automatically discover them?
- Should tool descriptions include a version or "last updated" note?
- Research: How do MCP servers handle API evolution? Is there a convention?

### 10. Security & Input Validation

- Beyond API key auth, what input validation should each tool perform?
- Can an agent inject malicious content through subreddit names, insight prompts, or search queries? (Insight prompts are passed to the LLM — is there a prompt injection risk?)
- Should there be rate limiting on the MCP tools themselves (separate from Reddit API rate limiting)?
- Maximum lengths for string parameters?
- Research: MCP security best practices as of early 2026. What are the known attack vectors for MCP servers?

## Deliverables

### A. Tool Catalog
The final tool set with full specifications for each tool:
- Name
- Category (pipeline / content / config)
- Agent-facing description (production quality)
- Parameter schema (JSON Schema or Zod, with types, defaults, descriptions, constraints)
- Response type (TypeScript interface)
- Example success response (realistic data)
- Example error response
- CQRS mapping (which command or query does this tool dispatch?)
- Workflow context (what tools typically come before/after this one?)

### B. Response Envelope Specification
The standard response format with TypeScript types, MCP content block mapping, and rationale.

### C. Error Code Taxonomy
Complete error code table with: code, HTTP-analogous status, description, agent-recommended action, retryable flag.

### D. Agent Workflow Diagrams
For the 7 workflows listed in the context section, show the complete tool call sequence with parameter threading, error handling, and user-facing output points.

### E. Content Representation Strategy
Recommendation on structured vs. markdown vs. hybrid, with rationale and examples. Include token budget estimates for common response sizes.

### F. MCP Spec Feature Recommendations
Which MCP features beyond tools (Resources, Prompts, Tasks, Sampling) should Redgest adopt, and which should it skip? Justify each.

### G. Open Questions
Anything unresolved. Flag clearly.

## Important Notes

- **The MCP specification has evolved significantly.** The November 2025 spec release introduced streamable HTTP transport, Tasks (async operations), and other features. Search for the latest spec and SDK documentation. Do not rely on pre-2025 MCP information.
- **Claude is the primary agent consumer.** While the API should be agent-agnostic, optimize for Claude's strengths: structured reasoning, tool composition, presenting formatted content to users. If there are Claude-specific behaviors around tool descriptions, response parsing, or content formatting, note them.
- **This is a personal tool, not a platform.** Don't over-engineer for multi-agent scenarios, complex auth flows, or enterprise scale. But DO design the API as if it matters — because agent DX directly affects the quality of every interaction.
- **Search for production MCP server examples.** How are real MCP servers (GitHub MCP server, Slack MCP server, database MCP servers, etc.) designing their tool surfaces in early 2026? What patterns are emerging? What mistakes are people making?
- **Tool descriptions are the most important deliverable.** They are the documentation that agents read at runtime. Every word matters. Spend disproportionate time on these.
- I care more about **getting this right** than getting a quick answer. This API surface is the product's face — it's what I'll interact with every day through Claude. If you find tension between different design goals (consistency vs. convenience, simplicity vs. completeness), call it out and present both options.
