---
id: wave-1-mcp-bridge-feasibility
wave: 1
title: Prove out the MCP-stdio-to-AgentTool bridge against pi
---

# Wave 1 — MCP-stdio-to-AgentTool bridge feasibility

## Goal

Determine whether a Studio-owned shim that spawns DLA's stdio MCP server, queries its `ListTools`, and wraps each remote tool as a pi `AgentTool` is mechanically sound against the pi runtime — and what the gotchas are (lifecycle, abort propagation, output-shape adaptation, startup latency, missing/partial tools, error semantics).

This is the leading candidate per the prior-research planner (see `prior-art/rsm-3139-plan.md`'s "Ambiguities" section). The job here is to validate or kill it concretely, not to ratify the planner's intuition.

## Questions

1. **Client-side MCP API.** `@modelcontextprotocol/sdk` is already in Studio's deps (used by `apps/cli/ai/mcp-server.ts` to *expose* a server). Confirm the package also ships a client with `StdioClientTransport` + the `ListTools`/`CallTool` flows. Document the concrete client API (constructor, `connect`, `request` / `callTool` helpers, types, error semantics) at the installed version.
2. **Tool wrapping shape.** Each remote MCP tool returns `{name, description, inputSchema (JSON Schema)}`. pi's `AgentTool` wants `{name, description, label, parameters (TSchema from typebox), execute, prepareArguments?, executionMode?}`. What's the smallest correct shim? Specifically:
   - Can a remote JSON Schema be cast as a typebox TSchema for `parameters`, or does pi do anything with `parameters` (e.g. validate, statically introspect) that would break? Inspect how `parameters` flows through the agent loop — is it forwarded to the LLM as-is, or validated?
   - What's `prepareArguments` for, and do we need it for remote tools (since the schema isn't typebox-native)?
   - Tool result shape: pi expects `{content: (TextContent | ImageContent)[], details, terminate?}`; MCP returns `{content: ContentBlock[], isError?, structuredContent?}`. What are the divergences and how do we adapt them — and what happens to `structuredContent` (which DLA uses for inspect/diagnose output)?
3. **Lifecycle.** Where does the DLA child process live? Per-session (spawn on `runStudioAgentTurn`, kill on dispose), per-CLI-process (singleton, refcount), or lazily-on-first-call? What does `session.dispose()` need to tear down? What if `ListTools` fails or hangs — does the agent session fail to start, or does it start without DLA tools and surface a warning?
4. **Startup latency.** DLA's MCP server boots via `npx tsx src/mcp-server.ts`. The original report measured ~few-second cold start. Re-confirm against current DLA HEAD and against Studio's CLI startup budget. Is `npx tsx` acceptable in production, or do we want a built JS entry point (`npm run build` on DLA, then `node dist/mcp-server.js`)?
5. **Abort propagation.** pi tools take an `AbortSignal`. MCP's `callTool` accepts a `signal` or a `progressToken` for cancellation. What's the right plumbing — `signal.addEventListener('abort', () => client.cancelToolCall(...))`, or simpler? What does DLA's MCP server do on cancel today (does it actually cancel work, or just orphan the result)?
6. **Permission gating.** Without `beforeToolCall` at the public-API level (confirm via Brief 1), how does Studio enforce per-tool permission buckets from `prior-art/rsm-3139-spec.md`? Options to evaluate:
   - Gate inside the wrapper's `execute` (check a policy table; throw to deny → pi treats as error).
   - Wrap each tool with a Studio-owned `ask-user-question` round-trip before the real `execute`.
   - Punt to a wrapper-skill that instructs the model what to ask before what.
   Pick the cleanest and explain.
7. **Where does the bridge live in `apps/cli/`?** Sketch the file layout: a new module like `apps/cli/ai/dla/` containing `bridge.ts` (MCP client), `agent-tool-adapter.ts` (JSON Schema → AgentTool shim), `policy.ts` (permission buckets), `index.ts` (entrypoint returning `AgentTool[]` for the runtime to splice into `buildAgentTools`). Confirm this is the minimal seam.
8. **Slash-command + wrapper-skill integration.** `/migrate` should not just dump a generic prompt; it should load a wrapper skill (RSM-3139's `migrate-site.md`, reusable as-is) that orchestrates DLA's tools in the right order. Confirm the pattern: register `migrate` in `AI_SKILL_COMMANDS`, drop the skill at `apps/cli/ai/skills/migrate-site/SKILL.md`, and the existing Skill tool + `buildSkillInvocationPrompt` does the rest. Identify any gaps.
9. **`canUseTool` replacement.** RSM-1639 leaned on `canUseTool` for the permission flow. pi has none at the public API. Decide: does this kill the per-tool permission story, or does Brief 1's hook inventory provide a substitute? If neither, the recommendation should explicitly call out that per-tool permissions become advisory (system-prompt language + wrapper-skill discipline) rather than enforced.

## Suggested approach

- Read `apps/cli/ai/mcp-server.ts` end-to-end to see how Studio uses the MCP SDK today.
- `ls node_modules/@modelcontextprotocol/sdk/dist/` and read the client-side typings (`client/index.d.ts`, `client/stdio.d.ts` if present).
- Walk `apps/cli/ai/runtimes/pi/index.ts` (especially `buildAgentTools` and `toToolDefinition`) and figure out where exactly DLA tools would splice in. The existing `wpcom_request` tool is the structural analog.
- Walk DLA's `src/mcp-server.ts` (via the prior-art `wave-1-dla-inventory.md`, sections 4 and 5) for the request/response shapes — particularly the `structuredContent` returned by `liberate_inspect`, `liberate_diagnose`, etc.
- Sketch one concrete tool round-trip end-to-end: `liberate_detect` (simplest) and `liberate_inspect` (most structured), showing the JSON Schema → TSchema cast, the `execute` body, the `CallTool` invocation, and the result adaptation. Sketches in TypeScript-flavored pseudocode are fine.
- Test-build the cast mechanically if it's cheap — but no need to write a full prototype; the goal is a yes/no plus a concrete sketch.

## Deliverable

A markdown file at `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-mcp-bridge-feasibility.md` with frontmatter and sections:

1. **MCP SDK client API at installed version** (with code references).
2. **Tool wrapping shim** — concrete TypeScript sketch of the adapter, with notes on schema cast, result adaptation, and `structuredContent` handling.
3. **Lifecycle & startup latency** — decision and rationale.
4. **Abort propagation** — wiring sketch.
5. **Permission gating without `canUseTool`** — chosen approach + rationale.
6. **File layout & integration seams** — proposed module tree and the diff against `buildAgentTools`.
7. **Slash-command + wrapper-skill plumbing** — concrete wiring against `AI_SKILL_COMMANDS` + Skill tool.
8. **Gotchas & open questions** — anything that needs a wave-2 spike.
9. **Verdict** — works / works-with-caveats / blocked, and a recommendation strength (strong / acceptable / dispreferred).

## Out of scope

- Implementing the bridge (no code changes — sketches only).
- Re-investigating DLA's tool list. Use `prior-art/wave-1-findings/wave-1-dla-inventory.md`.
- Permission policy bucket *content* (which DLA tool goes in which bucket) — that's reused as-is from `prior-art/rsm-3139-spec.md`. Just confirm the mechanism Studio uses to enforce it (or note that it's advisory).
- Bundling/distribution — that's Brief 5.
- Vendoring DLA's `src/lib` — that's Brief 3.
