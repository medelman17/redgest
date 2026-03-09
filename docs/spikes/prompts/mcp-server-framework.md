# Research Task: MCP Server Framework Evaluation for "Redgest"

## Context

I'm building **Redgest**, a personal Reddit digest engine. The system's primary interface is an **MCP (Model Context Protocol) server** — a standalone Node.js/Bun service that exposes 12 tools for AI agents (primarily Claude) to interact with. The MCP server is NOT embedded in a web framework like Next.js. It runs as its own process, deployed as a Docker container.

The MCP server needs to:

1. **Serve as an MCP-compliant tool server** using the Model Context Protocol (created by Anthropic). Agents connect to it and invoke tools via structured JSON-RPC over a transport layer.
2. **Support two transport modes:**
   - **SSE (Server-Sent Events) over HTTP** — for remote/production use. Claude Desktop, claude.ai, and other MCP clients connect over the network.
   - **stdio** — for local development. Claude Desktop can connect directly to a local process via stdin/stdout.
3. **Handle HTTP middleware concerns:** API key authentication (bearer token), request logging, error handling, CORS.
4. **Be lightweight and fast to start.** This is a personal tool, not an enterprise platform.
5. **Run on any infrastructure** — VPS, AWS/GCP/DO instances, Fly.io, Railway, bare metal. No platform-specific dependencies.
6. **Use ESM throughout.** TypeScript strict mode. The project is a TurboRepo monorepo — the MCP server is one package (`@redgest/mcp-server`) that imports business logic from a separate `@redgest/core` package.

## The Three Candidates

### Option A: MCP TypeScript SDK Native Transport

The official `@modelcontextprotocol/sdk` package (npm) includes built-in transport implementations for both stdio and SSE. You define tools using the SDK's `Server` class and its `.tool()` / `.resource()` registration methods, then attach a transport.

**Evaluate:** How mature is the SDK's built-in HTTP/SSE transport as of early 2026? Can you layer middleware (auth, logging) on top of it, or does it assume it owns the HTTP stack? What does the tool registration DX look like? How well does it handle errors? What are the limitations?

### Option B: Hono

Hono is a lightweight (~14kb) web framework built on Web Standards APIs (Request/Response). Runs on Node.js, Bun, Deno, Cloudflare Workers, etc. If using Hono, the MCP protocol handling (JSON-RPC parsing, tool dispatch, SSE streaming) would either be implemented manually on top of Hono's HTTP primitives, or via an adapter/middleware that bridges the MCP SDK's `Server` class to Hono's request handling.

**Evaluate:** Is there an existing Hono + MCP integration or middleware? If not, what does it look like to bridge the MCP SDK server with Hono's HTTP layer? Does Hono's SSE support work well for long-lived MCP connections? How does Hono handle middleware composition for auth, logging, error handling? What's the stdio story — would you run a separate entry point for stdio mode?

### Option C: Fastify

Fastify is a mature, high-performance Node.js web framework with a rich plugin ecosystem (auth, CORS, rate limiting, logging via Pino). It's heavier than Hono but battle-tested in production.

**Evaluate:** Same questions as Hono — is there an existing Fastify + MCP integration? What does bridging look like? Fastify's plugin system is powerful but opinionated — does it compose well with the MCP SDK? Bundle size and startup time compared to Hono? Does it work with Bun?

## Evaluation Criteria

Score each option against these criteria (1-5 scale, with justification):

### 1. MCP Protocol Compliance & Reliability
- Full compliance with the MCP specification (current as of early 2026, including the November 2025 spec updates — streamable HTTP transport, tasks/async, etc.)
- SSE connection stability for long-lived agent sessions
- Proper JSON-RPC handling (batching, error codes, notifications)
- Support for the latest MCP features (resources, prompts, tools, sampling, elicitation, tasks)

### 2. Transport Flexibility
- SSE/HTTP for remote production use
- stdio for local Claude Desktop integration
- How cleanly can both transports share the same tool definitions without duplication?
- Does the November 2025 MCP spec's "streamable HTTP" transport change the calculus? (This replaced the older SSE-only transport in the spec.)

### 3. Middleware & HTTP Concerns
- API key authentication (bearer token validation)
- Request/response logging
- Error handling (structured error responses)
- CORS configuration
- How naturally do these layer onto each option?

### 4. Developer Experience
- Tool registration API — how do you define a tool with its name, description, parameter schema (JSON Schema / Zod), and handler?
- TypeScript type safety — are tool inputs/outputs typed?
- How much boilerplate to get a working server with one tool?
- Hot reload / dev server experience

### 5. Production Readiness
- Stability, maturity, maintenance cadence of the framework/SDK
- Community size, ecosystem, documentation quality
- Known issues or gotchas in production
- Bundle size and cold start time (matters for containerized deployment)

### 6. Ecosystem Fit
- Works with ESM + TypeScript strict mode
- Works in a TurboRepo monorepo as an importable package
- Compatible with Node.js AND Bun (Bun compat is nice-to-have, not hard requirement)
- Doesn't fight with other choices in the stack (Prisma v7, Vercel AI SDK, Trigger.dev)

## Research Approach

For each option:

1. **Find and read the current source code and documentation.** Don't rely on training data — search for the latest versions, changelogs, and GitHub issues.
2. **Look for real-world examples** of MCP servers built with each approach. How are production MCP servers being built in early 2026? What's the community converging on?
3. **Check the MCP SDK's current transport architecture.** The spec has evolved significantly — the November 2025 spec introduced "streamable HTTP" as a replacement for the older SSE transport. How does this affect each option?
4. **Look for integration libraries or middleware** that bridge the MCP SDK with Hono or Fastify. These may have emerged since the MCP ecosystem matured in 2025.
5. **Check GitHub issues and discussions** for each option related to SSE reliability, connection handling, and known production issues.

## Deliverable

Produce a structured recommendation with:

1. **Scorecard** — each option scored 1-5 on each criterion, with brief justification per cell.
2. **Architecture sketch** — for each option, show the minimal code structure for: (a) registering one tool, (b) setting up auth middleware, (c) starting the server in both SSE and stdio modes. Pseudocode or real code, whichever is more informative.
3. **Risk assessment** — what could go wrong with each option? What are you locked into?
4. **Recommendation** — pick one and justify it. If the answer is "it depends," specify what it depends on and give a conditional recommendation.
5. **Migration cost** — if the initial choice turns out wrong, how hard is it to switch to one of the other options?

## Important Notes

- The MCP spec and ecosystem have evolved rapidly through 2025. **Do not rely on pre-2025 information.** Search for the latest state of the SDK, spec, and community practices.
- Pay special attention to the **November 2025 MCP spec release** which introduced streamable HTTP transport, tasks (async operations), and other changes. These directly affect the transport layer decision.
- The MCP TypeScript SDK is at `@modelcontextprotocol/sdk` on npm. Check the latest version and its transport implementations.
- I care more about **getting this right** than getting a quick answer. Take time to research thoroughly. If information is ambiguous or conflicting, say so.
