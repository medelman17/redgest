# Redgest MCP API design spike: targeted research revision

**The five research gaps each have clear, actionable answers.** `structuredContent` is technically supported by major clients but plagued by bugs and offers no LLM-facing benefit today — clients just `JSON.stringify()` it. Elicitation cannot be relied upon because Claude Desktop doesn't support it. Agents struggle with pagination unless explicitly guided. And the MCP security landscape is far broader than prompt injection alone, with **50+ documented vulnerabilities** including critical CVEs in Anthropic's own reference servers.

---

## 1. `structuredContent` is supported but broken in practice

The MCP spec (2025-06-18) added `outputSchema` and `structuredContent` to tool definitions and results. Servers declare an `outputSchema` (JSON Schema), then return a `structuredContent` JSON object conforming to that schema alongside the traditional `content` array. The spec recommends dual-return for backwards compatibility: servers SHOULD also include serialized JSON in a `TextContent` block.

**Client support status as of early 2026:**

- **Claude Desktop**: Supports the `2025-06-18` protocol negotiation and registers tools with `outputSchema`. However, **complex schemas using `$defs` and `$ref` fail** — Claude Desktop v1.0.1768 (Windows) throws 50+ schema compilation errors and tool calls time out. No official Anthropic documentation explains how `structuredContent` is handled differently from `content`.
- **Claude Code**: Added `structuredContent` support in **v2.0.21**. A bug (now closed) caused Claude Code to display only `structuredContent` and ignore `content` entirely when both were present — meaning the model saw only raw JSON pagination metadata instead of human-readable results.
- **claude.ai**: No documentation found confirming or denying `structuredContent` support. Likely shares Claude Desktop infrastructure, but unverifiable.
- **Cursor**: **Strictly enforces** the spec. When a tool declares `outputSchema` but does NOT return `structuredContent`, Cursor rejects the response with error `-32600`. This behavior was documented prominently during Xcode 26.3 MCP integration — Apple's `mcpbridge` RC 1 failed on Cursor but worked on Claude Code, forcing a community wrapper project (`XcodeMCPWrapper`) to copy `content` into `structuredContent`.
- **VS Code (Copilot)**: Has an **open bug** (microsoft/vscode#290063, filed Jan 24, 2026) — VS Code ignores `content[].text` when `structuredContent` is present, gating text content behind `if (!callResult.structuredContent)` in `mcpLanguageModelToolContribution.ts`.
- **Vercel AI SDK**: Issue **#11441** (opened Dec 26, 2025 by `mattrossman`) is **CLOSED/RESOLVED** via PR #11543. The SDK now supports reading `.structuredContent` with type information from `outputSchema`.

**The critical finding for Redgest**: There is **no practical LLM-facing benefit** to returning `structuredContent` over well-formatted JSON in a `content` text block today. All current client implementations simply `JSON.stringify()` the structured content and pass it as text to the model. The benefit exists only for **programmatic consumers** (non-LLM code needing typed, validated JSON). Meanwhile, dual-returning both fields triggers bugs in VS Code and previously in Claude Code where `content` gets silently dropped.

**Community adoption is nascent.** The MCP Python SDK (v1.12.3) still requires `content` even when only `structuredContent` is returned. The Go SDK (`mcp-go`) has issue #410 tracking implementation as high priority. Spring AI's `McpToolUtils.java` only converts POJOs to `TextContent` with no `structuredContent` support. A clarification proposal (SEP-1624, Oct 7, 2025) is still open, attempting to define when each field should be used. **Most community MCP servers still return JSON in text blocks.**

**Recommendation for Redgest**: Return JSON in `content` text blocks. Do not invest in `structuredContent` until client bugs are resolved and there is demonstrable LLM benefit. If you later add `outputSchema`, always dual-return to avoid Cursor's strict enforcement rejection and VS Code's content-dropping bug.

---

## 2. Claude prefers high-signal results in familiar formats

Anthropic's most authoritative guidance comes from "Writing Effective Tools for AI Agents" (published Sep 11, 2025). The key quote: **"There is no one-size-fits-all solution"** for tool response format — XML, JSON, and Markdown all impact evaluation performance differently because LLMs perform better with formats matching their training data.

Specific guidance from Anthropic documentation:

- **Return only high-signal information.** Include only fields Claude needs for its next reasoning step. Bloated responses waste context and make extraction harder.
- **Make verbosity configurable.** Anthropic recommends a `response_format` parameter with "concise" vs "detailed" modes — exactly the pattern Redgest should consider.
- **Use JSON for state data, text for narrative.** Anthropic's prompting best practices doc recommends structured formats (JSON) for state data needing programmatic reasoning, and unstructured text for progress notes and narrative context.
- **Token limits matter.** Claude Code restricts tool responses to **25,000 tokens** by default and warns at 10,000. Responses exceeding this are truncated.
- **Format familiarity matters.** Anthropic says to "keep the format close to what the model has seen naturally occurring in text on the internet." Cloudflare's "Code Mode" blog confirmed LLMs perform better with formats they've seen extensively in training data.

A GitHub discussion (modelcontextprotocol/modelcontextprotocol#1121, Jul 26, 2025) titled "Structured Output defeats the purpose of MCP" found that swapping structured output for plain text result strings produced a **notable performance improvement** on Gemma3-27B. An MCP collaborator (`olaservo`) confirmed that "structured content is optional, and text content is the default type of tool response." The official MCP quickstart weather server returns plain text strings like `"Current weather in New York:\nTemperature: 72°F"` — not JSON.

**Recommendation for Redgest**: Return concise JSON in text blocks for data Claude needs to reason over (digest entries, subreddit metadata). For digest summaries meant for user display, consider returning clean markdown. Anthropic's own guidance says to evaluate empirically — there's no universal winner.

---

## 3. Elicitation cannot be relied upon for destructive operations today

MCP elicitation (introduced 2025-06-18, URL mode added 2025-11-25) allows servers to send an `elicitation/create` request to clients, presenting a form or URL to collect user input. The user responds with accept (with data), decline, or cancel. It's exactly the right mechanism for confirming destructive operations.

**However, Claude Desktop does NOT support elicitation.** This is verified from multiple independent sources:

- Frontend Masters course (Brian Holt): "Claude Desktop supports resources, prompts and tools but it does not support discovery, sampling, roots or elicitation."
- Claude Code issue #2799 (opened Jul 1, 2025) requesting elicitation support remains **open**.
- Python SDK issue #1482 (Oct 14, 2025) confirms users get "Method not found" errors when using elicitation with Claude Code/Claude Desktop.
- Claude Desktop release notes at support.claude.com show **no mention** of elicitation in any release.

**Other client support is better but fragmented:**

- **VS Code (Copilot)**: Fully supports elicitation with native Command Palette-style UI. Microsoft published tutorials and the GitHub Blog published a full elicitation example (tic-tac-toe MCP server).
- **Vercel AI SDK v6**: Explicitly supports elicitation via `createMCPClient` with `{ elicitation: {} }` configuration.
- **Cursor**: Likely added support after Aug 2025. A Backstage issue (#31626) claims "it is already supported by Cursor and Copilot," but the exact version and date cannot be pinpointed.

**No major production MCP servers** (GitHub, Stripe, Sentry) currently use elicitation for destructive operation confirmation. Examples are limited to demos and tutorials (QuantGeekDev's demo server, restaurant booking examples, tic-tac-toe games). The PulseMCP newsletter noted: "Because Claude is the most popular MCP client, we expect it will be a while until the ecosystem starts to move forward."

**Recommendation for Redgest**: The original assessment of "Never" for elicitation was too strong — it's the right long-term mechanism. But it cannot be a **required** dependency today. The revised approach should be: document destructive operations clearly in tool descriptions, rely on client-side approval prompts (which Claude Desktop does support), and add optional elicitation support that gracefully degrades when unsupported. Check for the `elicitation` capability during initialization and use it when available.

---

## 4. Agents struggle with pagination — design tools to minimize it

The MCP spec's built-in cursor-based pagination (opaque `nextCursor` token) applies **only to list operations** (`resources/list`, `prompts/list`, `tools/list`, `resources/templates/list`). It does **not** cover `tools/call` results. A community proposal (modelcontextprotocol/modelcontextprotocol discussions #799) to extend pagination to tool responses remains unimplemented.

Production MCP servers implement their own tool-level pagination through input parameters:

- **GitHub MCP server**: Uses `page`/`perPage` for REST-backed tools, `after`/`endCursor` for GraphQL-backed tools. Has a known issue (#430, May 2025): "Often models seem to call paginated tools with the same arguments repeatedly."
- **Stripe MCP server**: Uses `starting_after`/`ending_before`/`limit` as tool input parameters (Stripe's native cursor scheme).
- **Blockscout MCP server**: Uses opaque Base64URL-encoded cursors with **explicit textual cues** ("⚠️ MORE DATA AVAILABLE: Use pagination.next_call to get the next page"). This dual-layer approach was developed because "in early versions, models often ignored pagination."
- **Axiom MCP server**: Skips pagination entirely — uses token-budget-aware truncation with intelligent field selection, returning CSV instead of JSON for **~29% token savings**.

**Agents reliably struggle with pagination.** This is documented across GitHub MCP server issues, Blockscout's empirical findings, Tinybird's analysis, and Anthropic's own guidance. Tinybird states: "Current MCP-driven agents struggle with pagination, bulk data pulls, and complex data transformations." Anthropic recommends "pagination, range selection, filtering, and/or truncation with sensible default parameter values" but does not claim agents handle pagination well automatically.

**Recommendation for Redgest**: The original limit-only approach is actually well-aligned with community best practices. For a Reddit digest server, results are bounded (subreddits, digest entries) and rarely exceed context limits. Use sensible defaults with `limit` parameters. For `get_digest` results that could grow large, implement **server-side truncation with guidance text** ("Showing 20 of 47 entries. Call with offset=20 to see more.") rather than expecting Claude to naturally paginate. This matches the Blockscout pattern proven to work with LLMs.

---

## 5. MCP security extends far beyond prompt injection

The MCP ecosystem faces a **severe and well-documented security landscape** as of early 2026. The vulnerability database at vulnerablemcp.info tracks **50 documented vulnerabilities** (13 critical) catalogued by 32 researchers. OWASP has published an MCP Top 10 (Beta phase) and two practical security guides. At least **8 academic papers** have been published on MCP security.

**Attack vectors directly relevant to Redgest:**

**Tool poisoning** is the most novel MCP-specific attack, first identified by Invariant Labs (April 2025). Malicious instructions hidden in tool descriptions or parameter schemas are invisible to users but processed by the LLM. CyberArk extended this with "Full-Schema Poisoning," showing that ALL schema fields — parameter names, types, nested descriptions — are injection surfaces. MintMCP reports **84.2% success rate** for tool poisoning when auto-approval is enabled. For Redgest, this means a co-connected malicious MCP server could manipulate how Claude uses Redgest's tools.

**Prompt injection via tool results** remains critical and is Redgest's primary vector. Reddit content (post titles, comments, subreddit descriptions) flows directly into tool results that Claude processes. The GitHub MCP data heist (May 2025, Invariant Labs) demonstrated a public GitHub issue using prompt injection to hijack an AI assistant into exfiltrating private repo data — essentially the same pattern where untrusted content in tool results manipulates the agent.

**Cross-server data exfiltration** is a demonstrated real-world attack. The WhatsApp MCP exfiltration (April 2025) showed a malicious MCP server could hijack data from a co-connected legitimate server. For Redgest: if a user has both Redgest and a malicious MCP server connected, the malicious server could attempt to exfiltrate digest data.

**Supply chain attacks on MCP registries** are documented. An analysis of 67,057 MCP servers across 6 registries found substantial numbers can be hijacked due to lack of vetted submission. The Smithery hosting breach (Oct 2025) leaked credentials controlling 3,000+ apps.

**SSRF through MCP**: CVE-2025-65513 (CVSS 9.3, Dec 2025) demonstrated private IP validation bypass in the Fetch MCP Server. If Redgest makes outbound HTTP requests to Reddit, SSRF mitigations are relevant.

**Notable CVEs in Anthropic's own servers**: Anthropic's reference `mcp-server-git` had 3 chained CVEs (CVE-2025-68145/68143/68144, disclosed Jan 20, 2026) enabling RCE through path validation bypass and argument injection. The Filesystem MCP Server had sandbox escape (CVE-2025-53109/53110, Aug 2025). This underscores that even well-known server implementations have critical security flaws.

**Recommended security mitigations for Redgest:**

- **Sanitize all Reddit content** before including in tool results. Strip or escape content that could contain prompt injection payloads (HTML tags, markdown that resembles instructions, `<IMPORTANT>` blocks).
- **Validate all tool inputs** against expected schemas. Treat all LLM-provided arguments as untrusted.
- **Implement least-privilege scope.** Redgest only needs read access to public Reddit data and write access to its own digest state. No filesystem, network, or system access beyond its API calls.
- **Pin tool descriptions.** Tool poisoning detection relies on stable, hashable descriptions. Don't dynamically generate tool descriptions from untrusted data.
- **Document destructive operations** with clear warnings in tool descriptions. Until elicitation is widely supported, rely on client-side approval prompts and explicit tool naming (e.g., `remove_subreddit` rather than `update_subreddits`).
- **Rate-limit tool calls** to prevent abuse if the server is exposed over HTTP.
- **Log all tool invocations** for audit purposes — the OWASP MCP Top 10 lists insufficient logging as MCP09.

---

## Conclusion

Three findings should directly change the Redgest API design. First, **skip `structuredContent`** — return JSON in `content` text blocks and avoid the client bug minefield entirely. The LLM sees identical text either way. Second, **plan for elicitation as optional enhancement**, not a dependency — add capability detection and graceful degradation, since Claude Desktop (the primary target) doesn't support it. Third, **expand security beyond prompt injection** to cover tool poisoning, cross-server exfiltration, and input validation, given the 50+ documented CVEs in the ecosystem.

Two findings validate the original design. Limit-only pagination is well-aligned with production practice — agents struggle with cursor-based pagination, and Anthropic's own guidance favors truncation with guidance text over expecting agents to paginate. Returning concise JSON in text blocks is the community norm and matches Anthropic's recommendation to keep formats close to what the model has seen in training data.