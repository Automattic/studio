## Related issues

- Related to RSM-3143 (research artifact)
- Supersedes RSM-1639 (research, Done — host-side findings now stale)
- Supersedes RSM-1675 (impl Approach A, Cancelled)
- Supersedes RSM-3139 (impl Approach C, Cancelled) and PR #3277 (closed)

## How AI was used in this PR

This PR is **research output only — no code changes**. The investigation was orchestrated by an AI research-lead delegating to five parallel AI researchers (one per sub-question), each producing a wave-1 finding with concrete file/line evidence against pi-coding-agent 0.70.2 and DLA HEAD at `17219c42b0420267302b138bf402930508006e0e`. The research-lead read all five findings in full, evaluated them against the "research-complete vs wave-2" criteria in `research-plan.md`, decided no wave 2 was needed, and synthesized the report. Reviewers should verify the cited file paths and line ranges (every load-bearing claim in `research-report.md` cites a wave-1 finding section, which cites the underlying source).

**Draft / Proof of Concept**: this PR is a research artifact intended as directional guidance for a follow-up implementation ticket. It should not be merged without a separate implementation-phase ticket that turns the recommendation into a spec + code.

## Proposed Changes

- Add `issues/rsm-3143-dla-pi-research/research-report.md` — synthesis report (Executive Summary, four Approaches Investigated, Comparison, Recommendation, Open Questions). Recommends **MCP-stdio bridge** as the canonical `/migrate` path against pi-coding-agent, with Subprocess as a separate `studio migrate <url>` standalone CLI command and Vendor-as-AgentTools as a documented fallback.
- Add `issues/rsm-3143-dla-pi-research/research-plan.md` — research plan with the wave-1 findings log filled in and the wave-2 decision (no wave 2) documented.
- Add `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-*.md` — five wave-1 researcher findings: pi extensibility surface, MCP bridge feasibility, vendor-as-AgentTools, subprocess revisit, upstream + bundling.
- Add `issues/rsm-3143-dla-pi-research/PR-description.md` — this PR description.
- Existing committed (earlier in this saga): `prompt.md`, `prior-art/`, `tasks/`.

**Headline recommendation:** Studio adds DLA as `github:Automattic/data-liberation-agent#<sha>`, spawns DLA's stdio MCP server as a child process at `studio code` session bring-up, and wraps each remote tool as a pi `ToolDefinition` in `apps/cli/ai/runtimes/pi/`'s existing `customTools` array. Per-tool permission gating uses an inline extension factory on `DefaultResourceLoader` subscribing to `pi.on('tool_call', handler)` returning `{block: true, reason}` — mechanically equivalent to what `canUseTool` was in the previous Claude SDK. `/migrate` lands via the existing `AI_SKILL_COMMANDS` registry plus a bundled `apps/cli/ai/skills/migrate/SKILL.md` reusing RSM-3139's wrapper-skill body verbatim.

**Scope flag:** all proposed work lives in `apps/cli/`. One Electron-side touchpoint flagged for the owner: `apps/cli/ai/skills/` is not copied by `vite.config.prod.ts` (same gap RSM-1639 flagged for the old `ai/plugin` path) — confirm or fix as part of the implementation work. No other `apps/studio/` changes proposed.

## Testing Instructions

This PR adds documentation only; there is no code to test. Reviewers can verify:

- Read `research-report.md` end-to-end. The Executive Summary should make the recommendation clear in 2-3 paragraphs.
- Spot-check three load-bearing claims by following their citations:
  - "Pi accepts plain JSON Schema in `ToolDefinition.parameters`" → `wave-1-mcp-bridge-feasibility.md` §2 → `node_modules/@mariozechner/pi-ai/dist/utils/validation.js:253-280`. Reviewer can run `grep -n "hasTypeBoxMetadata" node_modules/@mariozechner/pi-ai/dist/utils/validation.js` locally.
  - "`extensionFactories` reachable from `createAgentSession`" → `wave-1-pi-extensibility-surface.md` §2 → `node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:272-278`. Reviewer can grep for `extensionFactories` in that file.
  - "Pi maintainer rejected first-party MCP support" → `wave-1-upstream-and-bundling.md` §1.2 → GitHub issue [earendil-works/pi#563](https://github.com/earendil-works/pi/issues/563). Reviewer can open the issue and confirm the closing comment.
- Check that the recommendation explicitly addresses RSM-1639's original constraints (DLA's `delegate: true` contract; permission-policy buckets from RSM-3139; bundle/distribution against Studio's Vite + electron-forge pipeline; no Electron-side proposal beyond the one flagged static-copy gap).
- Check the Open Questions list captures everything that is not resolved by wave 1 (the most material one is whether `pi-mcp-adapter` is a viable Studio dependency — flagged as a 30-minute spike before implementation commits to Studio-owned wiring).

## Pre-merge Checklist

- [x] Have you checked for TypeScript, React or other console errors? — N/A (no code changes)
- [x] Is the PR scoped to a single concern? — Yes (single research artifact)
- [x] Does the recommendation supersede prior tickets clearly? — Yes; RSM-1639, RSM-1675, RSM-3139, PR #3277 named in the "Related issues" section and in the report's status line
- [x] Does the recommendation flag Electron-side touchpoints? — Yes; the `vite.config.prod.ts` static-copy gap is the only flagged Electron-side touchpoint, called out in both the recommendation and Open Questions
- [x] Is there enough evidence for an implementation-phase planner to write a spec? — Yes; all four approaches have concrete file/line evidence; Bridge has an end-to-end wiring sketch in `wave-1-mcp-bridge-feasibility.md` §6 plus the recommendation section's nine numbered next steps
