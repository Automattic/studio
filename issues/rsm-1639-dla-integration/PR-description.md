## Related issues

- Related to RSM-1639 (https://linear.app/a8c/issue/RSM-1639/figure-out-how-to-make-the-data-liberation-agent-dla-available-within)
- Project: https://linear.app/a8c/project/bring-data-liberation-into-studio-code-8e53bd986fcc

This PR is a research artifact only. No code changes. It produces a recommended integration path for the Data Liberation Agent (`Automattic/data-liberation-agent`) inside the `studio code` AI-agent CLI command, so that a future `/migrate` slash command can call it.

## How AI was used in this PR

This was an AI-orchestrated research effort. A research-lead agent planned the investigation in four parallel waves, assignable researcher agents executed each wave with file-level evidence-gathering inside both `apps/cli/` and a shallow checkout of `Automattic/data-liberation-agent`, the lead evaluated findings against a written "research complete" criterion, and the synthesis report and this PR description were produced by the lead. All concrete file paths, line numbers, type signatures, MCP tool names, and bundling sizes in the report are sourced directly from the codebase (Studio CLI, the Claude Agent SDK at `node_modules/@anthropic-ai/claude-agent-sdk@0.2.117`, and the DLA repo) — not from the model's training data. The orchestrator log and individual researcher findings live under `issues/rsm-1639-dla-integration/findings/` for review.

## Proposed Changes

This PR adds research artifacts under `issues/rsm-1639-dla-integration/`:

- `research-plan.md` — research question, sub-questions, four-wave plan, findings log, evaluation against "research complete" criteria.
- `tasks/wave-1-*.md` — four task briefs assigned to wave-1 researchers (DLA inventory; Studio Code skill/MCP/slash-command plumbing; Claude Agent SDK plugin/MCP loading semantics; CLI bundling and distribution constraints).
- `findings/wave-1-*.md` — four exhaustive researcher reports, each with evidence (file paths, line numbers, manifest contents verbatim, MCP type signatures, disk sizes, release cadences).
- `research-report.md` — synthesis. Five integration approaches investigated; head-to-head comparison; opinionated recommendation; open questions for the implementation phase.
- `PR-description.md` — this document.

**Recommended path (CLI-only):** vendor DLA's plugin tree under `apps/cli/ai/dla/` via a build-time fetch script (modeled on the existing `scripts/download-agent-skills.ts`); load it as a second local plugin alongside `apps/cli/ai/plugin/` in `apps/cli/ai/agent.ts:130-149`; boot DLA's MCP server as a stdio child-process entry alongside Studio's in-process MCP at `apps/cli/ai/agent.ts:80-84`; surface `/migrate` as a skill-based slash command in `tools/common/ai/slash-commands.ts:8-13` pointing at a thin Studio-side wrapper skill that drives DLA's `liberate` workflow and uses DLA's existing `delegate: true` import mode to hand artifacts back to Studio's site-creation and `wp_cli` plumbing. End-to-end UX, plug-in points, and the full trade-off set are in `research-report.md`.

**Electron-side flags surfaced** (not addressed in this PR — flagged so the owner can decide):
- `apps/cli/vite.config.prod.ts` is missing the `viteStaticCopy` target for `apps/cli/ai/plugin/` that the dev/npm configs already have. The Electron-bundled CLI may be loading no plugin tree at all today. Independent of this integration, but blocks it. Needs a 5-minute verification with a real `npm run cli:package`.
- `apps/studio/src/ipc-handlers.ts:295-306` only re-routes `AI_SKILL_COMMANDS` entries — handler-only slash commands won't appear in the desktop slash menu. Confirms why the recommended approach uses a skill-based slash command rather than a handler.
- `apps/studio/forge.config.ts:182-218` already prunes per-platform native binaries; if DLA's vendored tree introduces any new native-bearing package, the prune logic needs an entry.

## Testing Instructions

This PR has no code changes. To review the research:

1. Read `issues/rsm-1639-dla-integration/research-report.md` end-to-end. The Executive Summary and Recommendation sections are the load-bearing parts.
2. For each claim that influences your decision, cross-check against the corresponding `findings/wave-1-*.md` file — every claim cites file paths and line numbers.
3. If you disagree with the recommended approach, the "Approaches Investigated" and "Comparison" sections list the four alternatives with concrete pros/cons and explicit rejection reasons.
4. The "Open Questions" section enumerates items deferred to the implementation phase — please flag any that you think should be answered before we cut a follow-up implementation issue.

## Pre-merge Checklist

- [ ] Have you checked for TypeScript, React or other console errors? (n/a — no code changes)
- [ ] Recommendation reviewed by a Studio CLI maintainer.
- [ ] Recommendation reviewed by a DLA maintainer (specifically: the proposal to vendor at a pinned SHA, the assumption that `delegate: true` is the canonical handoff for hosts like Studio Code, and the request to consider tagged public releases so we can move to an npm dep long-term).
- [ ] Open Questions triaged — confirmed the `vite.config.prod.ts` plugin-copy gap is real before opening the implementation issue.
- [ ] Linear ticket RSM-1639 updated with the recommendation and a link to this PR.
