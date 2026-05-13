---
id: wave-1-subprocess-revisit
wave: 1
title: Re-evaluate the subprocess approach (Approach E) against pi
---

# Wave 1 — Subprocess approach revisited

## Goal

The original RSM-1639 research rejected "spawn DLA's CLI as a subprocess from a slash command" (Approach E) because it took the agent out of the loop — the user would `/migrate https://...` and DLA's Ink-based interactive CLI would take over until done, with the agent contributing nothing.

Against pi, the picture is different: we can wrap the DLA CLI as a single pi `AgentTool` whose `execute` spawns the child, streams output back, and returns a structured result. The agent stays in the loop and can reason over the result; DLA is a black box. Re-evaluate this approach against pi's runtime and decide whether it deserves to be a contender.

## Questions

1. **CLI subcommand surface.** Per `prior-art/wave-1-findings/wave-1-dla-inventory.md` sec 2, DLA exposes `data-liberation liberate|inspect|adapt|import|verify|qa|diagnose|setup|mcp`. For a single-tool wrapper, which subcommand(s) would the wrapper call — one tool that calls the high-level `liberate` (which orchestrates internally), or one tool per subcommand?
2. **Single vs. fan-out.** Tradeoff:
   - **Single tool** (`run_dla_cli(subcommand, args, url)`): simple wrapping, agent supplies subcommand + args, agent loses fine-grained reasoning per phase.
   - **Multiple tools** (`dla_inspect(url)`, `dla_liberate(...)`, etc.): tools mirror the MCP surface 1:1 in semantics but each wraps a CLI call — eliminates `npx tsx` overhead per call (or magnifies it, depending on whether each subcommand pays a startup cost).
   Evaluate both. The single-tool variant is what makes this distinct from Bridge/Vendor; the multi-tool variant collapses back toward Bridge-with-different-IPC.
3. **Interactive prompts.** DLA's CLI uses Ink screens (`src/ui/*.tsx`) — does it ever block on stdin for user input? If yes, which subcommands, and what's the wrapping strategy — preflight check (require `--non-interactive` flag if DLA supports it) or capture the prompt and surface it via Studio's `createAskUserQuestionTool`?
4. **Output capture.** DLA's CLI outputs Ink-rendered tty output. Capturing that into a tool result is lossy (ANSI codes, terminal widths, redraws). Options:
   - Pipe stdout/stderr, strip ANSI, return raw.
   - Force a non-Ink mode (if DLA supports a `--json` flag, use that).
   - If neither works, this is a structural blocker — note it.
5. **Sub-agent reasoning.** DLA's MCP `delegate: true` lets a sub-agent reason inside DLA's process. A subprocess approach loses that — does the wrapper-skill make up for it (instructing the host agent to do the reasoning between subprocess calls), or does this fundamentally cripple the workflow?
6. **Process lifecycle & resource consumption.** Each DLA call pays `npx tsx` startup (a few seconds). For the multi-tool variant, this happens N times per `/migrate` flow. Quantify against Studio's UX budget. For the single-tool variant, it happens once but the agent is blocked the whole time without progress reporting unless we wire streaming via `onUpdate`.
7. **Slash-command + wrapper-skill plumbing.** Same as the other briefs — `/migrate` triggers a skill that drives the wrapper tool(s). Confirm this still works and identify divergences from the Bridge/Vendor plumbing.
8. **Permission gating.** Subprocess approach naturally inherits whatever Studio's tool-level policy enforces in the wrapper's `execute` — the gating is at Studio's seam, not inside DLA. Confirm this and note any tools (e.g. `import` writing to WordPress) that need per-call confirmation.

## Suggested approach

- Read DLA's `src/cli.ts` (referenced in `wave-1-dla-inventory.md` sec 2) to understand the subcommand routing and which screens block on input.
- Check DLA's package.json scripts for any `--json` / `--non-interactive` modes.
- Sketch the single-tool wrapper concretely — `execute` invokes `child_process.spawn('npx', ['tsx', 'src/cli.ts', subcommand, ...args])`, pipes stdout/stderr, awaits exit, returns `{content: [{type: 'text', text: capturedOutput}]}`. Note signal handling for abort.
- Compare against Bridge/Vendor on agent-in-the-loop, latency, maintenance, and UX richness.

## Deliverable

A markdown file at `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-subprocess-revisit.md` with frontmatter and sections:

1. **CLI subcommand inventory** — what's spawnable.
2. **Single vs. fan-out tradeoff** — table, with recommended choice.
3. **Interactivity & output capture** — feasibility check + risks.
4. **`delegate: true` impact** — does losing DLA's sub-agent reasoning matter for `/migrate`?
5. **Latency & resource notes** — concrete numbers if you can get them, otherwise a careful estimate.
6. **Concrete wrapper sketch** — single-tool implementation pseudo-code.
7. **Comparison vs. Bridge & Vendor** — short table on agent-in-the-loop, latency, maintenance, UX.
8. **Verdict** — works / works-with-caveats / blocked + recommendation strength.

## Out of scope

- Implementing the wrapper.
- Re-investigating DLA's tools/surfaces.
- Permission policy bucket content.
- Bundling/distribution.
