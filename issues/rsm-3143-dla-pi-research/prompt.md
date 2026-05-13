# RSM-3143: Re-research DLA integration into `studio code` given pi-coding-agent migration

- **Ticket:** https://linear.app/a8c/issue/RSM-3143/re-research-dla-integration-into-studio-code-given-pi-coding-agent
- **Branch:** `rsm-3143-dla-pi-research`

Re-do the DLA integration research now that two things have changed since RSM-1639 closed:

1. The Data Liberation Agent repo (`Automattic/data-liberation-agent`) was made **public** on 2026-05-07.
2. Studio CLI migrated from `@anthropic-ai/claude-agent-sdk` to `@mariozechner/pi-coding-agent@0.70.2` in PR #3360 (commit `406b7494`, also 2026-05-07). The host-side wiring assumptions in the original research-report — `Options.mcpServers`, `Options.plugins`, `canUseTool`, `apps/cli/ai/agent.ts` — no longer exist on trunk.

The DLA-side findings from RSM-1639 are still valid (DLA's surfaces, MCP tools, `delegate: true` contract, runtime needs). The host-side findings are stale. Re-use the prior art selectively — see `prior-art/`.

Open question: how does the `pi-coding-agent` runtime in `apps/cli/ai/runtimes/pi/` accept third-party tool surfaces, and what's the cleanest mechanically-compatible way to land a `/migrate` slash command driven by DLA's tools?

Candidate shapes to evaluate (non-exhaustive):

- **Bridge:** spawn DLA's stdio MCP server, wrap each tool as a pi `AgentTool` using `@modelcontextprotocol/sdk` (still in Studio's deps).
- **Vendor as AgentTools:** import `data-liberation/src/lib/...` modules directly and write pi AgentTools that call DLA internals (skips DLA's MCP surface; ties to its internal API).
- **Upstream pi-coding-agent:** push the maintainer to add MCP support so the original research's wiring shape works.
- **Different host entirely:** spawn DLA's CLI as a subprocess from a slash command (Approach E from the original research; was rejected because it loses the agent in the loop — re-evaluate against pi).

Deliverable: a synthesis report covering the viable options against the pi-coding-agent runtime, their tradeoffs, and a recommended path forward. No code changes.

## Prior art

Preserved under `prior-art/` for the research-lead to consult:

- `prior-art/rsm-1639-research-report.md` — the original research report. DLA-side sections are still authoritative; host-side sections (Approach A, B, C as wired against `claude-agent-sdk`) are stale.
- `prior-art/wave-1-findings/` — the four wave-1 findings from RSM-1639. `wave-1-dla-inventory.md` is still authoritative (modulo the 2-week-newer DLA HEAD). `wave-1-studio-skill-plumbing.md` and `wave-1-claude-plugin-mechanics.md` are stale (describe `claude-agent-sdk`). `wave-1-bundling-distribution.md` is partially stale (build pipeline still applies; SDK-specific bits do not).
- `prior-art/rsm-3139-spec.md` — the (cancelled) Approach C spec written against `claude-agent-sdk`. Useful for the wrapper-skill content and per-tool permission policy, which are reusable regardless of host runtime.
- `prior-art/rsm-3139-plan.md` — the (cancelled) Approach C plan, including the planner's discovery of the pi-coding-agent migration and the bridge proposal. Read the "Ambiguities" section in particular.

Predecessor tickets: RSM-1639 (research, Done), RSM-1675 (impl Approach A, Cancelled), RSM-3139 (impl Approach C, Cancelled).
