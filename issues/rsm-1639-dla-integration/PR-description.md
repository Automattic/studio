## Related issues

- Related to RSM-1639 (https://linear.app/a8c/issue/RSM-1639/figure-out-how-to-make-the-data-liberation-agent-dla-available-within)
- Related to RSM-1675 (implementation phase)
- Project: https://linear.app/a8c/project/bring-data-liberation-into-studio-code-8e53bd986fcc

> **Status: draft — DO NOT MERGE.** This PR holds two phases of work in a single branch by explicit owner request: the research artifacts under `issues/rsm-1639-dla-integration/` (RSM-1639) and the implementation that turns the recommendation into shipped code (RSM-1675, eight `[code]` tasks T1–T8 plus two `[docs]` tasks T9–T10). It stays draft after review so the open questions called out below can be triaged before any merge attempt.

## How AI was used in this PR

Both phases were AI-orchestrated through the `orchestrator` skill. The roster:

- **Research phase (RSM-1639).** A research-lead agent planned the investigation in four parallel waves; four researcher agents executed each wave with file-level evidence-gathering inside `apps/cli/`, the Claude Agent SDK at `node_modules/@anthropic-ai/claude-agent-sdk@0.2.117`, and a shallow checkout of the private `Automattic/data-liberation-agent` repo; the lead synthesised findings into the recommendation report. Every concrete file path, line number, type signature, MCP tool name, and bundling size in `research-report.md` is sourced directly from the codebase, not from the model's training data.
- **Implementation phase (RSM-1675).** A planner agent decomposed the recommendation into ten ordered atomic tasks (`plan.md`); eight implementer agents (one per `[code]` task) landed T1–T8 against the plan; a code-reviewer agent ran the full vitest workspace, typecheck, lint, and dev/prod CLI builds, and approved the implementation (`review-1.md`); two documentator agents wrote T9 and T10; this PR description and the documentation review (`doc-review-1.md`) are produced by a final doc-reviewer pass.

The orchestrator log, individual researcher findings, planning artifacts, code-review evidence, and the doc-review report all live under `issues/rsm-1639-dla-integration/` for inspection.

## Proposed Changes

### Research artifacts (`issues/rsm-1639-dla-integration/`)

- `research-plan.md` — research question, sub-questions, four-wave plan, findings log, evaluation against "research complete" criteria.
- `tasks/wave-1-*.md` — four task briefs assigned to wave-1 researchers (DLA inventory; Studio Code skill/MCP/slash-command plumbing; Claude Agent SDK plugin/MCP loading semantics; CLI bundling and distribution constraints).
- `findings/wave-1-*.md` — four exhaustive researcher reports, each with evidence (file paths, line numbers, manifest contents verbatim, MCP type signatures, disk sizes, release cadences).
- `research-report.md` — synthesis. Five integration approaches investigated (vendor + stdio MCP; vendor + in-process MCP; npm dep; runtime fetch; handler-only CLI spawn); head-to-head comparison; opinionated recommendation; eight open questions for the implementation phase.
- `plan.md` — atomic, ordered task plan derived from `research-report.md`. Tracks which open questions each task resolves.
- `review-1.md` — code-reviewer's verdict (approved) for T1–T8 with command outputs, per-task acceptance verification, and a list of non-blocking nits.
- `verification/` — captured stdout for each verification command in the code review.
- `doc-review-1.md` — this doc-reviewer's verdict for T9–T10.
- `PR-description.md` — this document.

### Implementation (`apps/cli/`, `tools/common/ai/`, root `scripts/`, root `package.json`, root `vitest.config.ts`)

The implementation realises Approach A from `research-report.md`: vendor DLA's plugin tree under `apps/cli/ai/dla/`, load it as a second local SDK plugin alongside `apps/cli/ai/plugin/`, and boot DLA's MCP server as a stdio child-process entry alongside Studio's in-process MCP. A new `/migrate` slash command surfaces this through a thin Studio-side wrapper skill that drives DLA's `liberate_*` workflow and uses DLA's existing `delegate: true` import mode to hand artifacts back to Studio's `site_create` and `wp_cli` plumbing.

Eight `[code]` tasks (each a single commit on the branch):

- **T1 — `apps/cli/vite.config.prod.ts` static-copy fix.** Adds the `viteStaticCopy` block that the dev/npm configs already have for `ai/plugin`. This was a pre-existing latent bug independently surfaced by the research (`research-report.md` Open Question 1) — landing it first makes T5 verifiable. Confirmed by inspecting `apps/cli/dist/cli/plugin/.claude-plugin/plugin.json` after `npm run cli:build:prod`. (Commit `14a58dda`.)
- **T2 — `scripts/download-data-liberation-agent.ts`.** Build-time fetch script modeled on `scripts/download-agent-skills.ts`. Pinned SHA, GH_PAT/GH_TOKEN auth, graceful skip when no token, tarball download, atomic-ish staging swap, `tsc` pre-compile (no runtime `tsx` dependency), `dist-vendored/` → `src/` rename, vendored PHP under `src/lib/preview/scripts/` preserved, `.dla-pinned-sha` provenance file, `--update`/`STUDIO_REFRESH_DLA=1` opt-in. Four vitest cases. (Commit `d329634b`.)
- **T3 — Postinstall + runtime deps.** Wires the fetch script into the root `package.json` postinstall chain after `download-agent-skills.ts`; adds `fast-xml-parser ^5.7.2` and `papaparse ^5.5.3` to `apps/cli/package.json`; adds `apps/cli/ai/dla/` to `.gitignore`. (Commit `20169f27`.)
- **T4 — Vite static-copy targets for `ai/dla`.** All three Vite configs (`vite.config.dev.ts`, `vite.config.npm.ts`, `vite.config.prod.ts`) gain an `existsSync`-guarded `ai/dla` target so the build still works on contributors without the vendored tree. Cross-config snapshot test in `apps/cli/tests/vite-config.test.ts`. (Commit `5785f4d5`.)
- **T5 — `agent.ts` plugin + MCP wiring.** `apps/cli/ai/agent.ts` registers DLA conditionally on `dlaAvailable` (`fs.existsSync(path.resolve(import.meta.dirname, 'dla'))`). DLA loads as a second local plugin and as a stdio MCP server keyed under `data-liberation`, spawned with `process.execPath` against the absolute path to the pre-compiled `mcp-server.js`. `STUDIO_WPCOM_TOKEN` is forwarded explicitly; `LIBERATION_TOKEN`/`SHOPIFY_ADMIN_TOKEN` are forwarded transitively via `...resolvedEnv`. The `wpcomAccessToken` read in `apps/cli/commands/ai/index.ts` is moved out of the `site?.remote` guard so the token is available to DLA regardless of site type. Four agent.test.ts cases cover the conditional wiring. (Commit `4231813d`.)
- **T6 — `/migrate` slash command.** `tools/common/ai/slash-commands.ts` appends `{ name: 'migrate', description: __('Migrate a site from a closed platform into Studio') }` to `AI_SKILL_COMMANDS`. The shared list auto-wires the chat dispatcher in `apps/cli/commands/ai/index.ts`, the autocomplete provider in `apps/cli/ai/ui.ts`, the desktop IPC dispatcher in `apps/studio/src/ipc-handlers.ts`, and the renderer composer slash hints — no Electron-side change required because the skill-based path was chosen specifically to satisfy the existing IPC dispatcher's `AI_SKILL_COMMANDS` filter. Test in `tools/common/ai/tests/slash-commands.test.ts`. (Commit `aaa50d3d`.)
- **T7 — `apps/cli/ai/plugin/skills/migrate/SKILL.md`.** Studio-side wrapper skill with `user-invocable: true` (with C, not the K typo present in older Studio skills), `argument-hint: <source-url>`, and a precise `allowed-tools` list scoped to the DLA tools we use plus the Studio MCP tools we drive. Body covers Steps 1–9 (identify, inspect, confirm, extract, verify, setup-with-delegate, create Studio site, import-with-delegate, wrap up) plus an explicit "What this skill does NOT do" footer documenting the deferral of headless mode (Approach E). Includes the `importWxr` blueprint shape so the model can construct it for very large WXR exports that would otherwise hit the WP-CLI 120s IPC timeout. Vitest case in `apps/cli/ai/tests/plugin-skills.test.ts`. (Commit `202302c2`.)
- **T8 — `canUseTool` permission scoping.** `apps/cli/ai/dla-permissions.ts` exports `buildDlaCanUseTool(options)`; `agent.ts` wires it to `query()`'s `canUseTool` only when DLA is available. Read-only DLA tools (`liberate_detect`, `liberate_discover`, `liberate_inspect`, `liberate_status`, `liberate_verify`) auto-allow; `liberate_import` with `delegate: true` auto-allows; ask-once tools (`liberate_extract`, `liberate_setup`, `liberate_map_apis`, `liberate_probe`, plus `liberate_import` without `delegate`) prompt via the existing `onAskUser` plumbing and memoise per-session via a closure-scoped `Set`; default-deny when `onAskUser` is missing (with a TODO referencing OQ2 for a future non-interactive opt-in flag) and on unrecognised DLA tools. 11 vitest cases cover the policy. (Commit `e57e012f`.)

Two `[docs]` tasks:

- **T9 — `apps/cli/README.md`.** New "Migrate from a closed platform" section (after "Studio Code"). Documents the eight supported platforms, the `/migrate` and `/migrate <url>` invocation shapes, the agent-driven flow (inspect → extract → verify → site-create → import), the `LIBERATION_TOKEN`/`SHOPIFY_ADMIN_TOKEN` requirement for Webflow/Shopify, the `~/Studio/` landing dir, the `GH_PAT` requirement at install time, and a credit line for the Data Liberation Agent. ToC updated. (Commit `fb85ddce`.)
- **T10 — `docs/design-docs/cli.md`.** New "Data Liberation Agent integration" architecture section. Covers vendoring (the fetch script, `tsc` pre-compile, `dist-vendored/` → `src/` rename, vendored PHP, `.dla-pinned-sha`), plugin and MCP wiring (`process.execPath`, absolute path to `mcp-server.js`, no `cwd` field on `McpStdioServerConfig`, env forwarding), the `delegate: true` handoff contract, the `canUseTool` permission policy, and the SHA-pin update cadence. Cross-links to `research-report.md` for trade-off rationale. (Commit `c18568a0`.)

### Electron-side gotchas surfaced and resolved

- **`vite.config.prod.ts` plugin-copy gap (was Open Question 1).** Independently fixed by T1 — adding the `viteStaticCopy` block for `ai/plugin` ensures the Electron-bundled `studio code` actually loads the SDK plugin tree. The gap was pre-existing and would have silently shipped without DLA forcing a verification.
- **Electron IPC dispatcher requirement (`apps/studio/src/ipc-handlers.ts:295-306`).** Only forwards `AI_SKILL_COMMANDS` entries; handler-only slash commands would not appear in the desktop slash menu. The skill-based shape of `/migrate` (T6 + T7) satisfies this constraint by construction — no Electron-side change required.

### Out of scope (consciously deferred)

- `/migrate --headless` (Approach E from `research-report.md`) — documented as deferred in T7's "What this skill does NOT do" footer.
- Migrating existing Studio skills off the `user-invokable` (with K) typo — orthogonal cleanup, T7 just uses the correct `user-invocable` (with C) for the new skill.
- Anything under `apps/studio/` — out of scope by construction (CLI-only PR per the research scope).
- Multi-plugin name namespacing verification (Open Question 4) and DLA orphan-cleanup behaviour (Open Question 7) — deferred upstream; require a real `cli:package` run with DLA vendored to verify.

## Testing Instructions

### Reviewing the research

1. Read `issues/rsm-1639-dla-integration/research-report.md` end-to-end. The Executive Summary and Recommendation sections are load-bearing.
2. For each claim that influences your decision, cross-check against the corresponding `findings/wave-1-*.md` file — every claim cites file paths and line numbers.
3. The "Approaches Investigated" and "Comparison" sections list the four alternatives with concrete pros/cons and explicit rejection reasons.
4. The "Open Questions" section enumerates items deferred to the implementation phase. `plan.md` records which open questions each implementation task resolves.

### Reviewing the implementation

The full vitest workspace passes (1474 tests across 158 files), typecheck is clean, lint is clean on every file the patches touched, and dev/prod CLI builds both succeed without DLA vendored. To reproduce locally:

```bash
npm install                                 # postinstall skips DLA fetch when GH_PAT is unset
npm run typecheck                           # all four workspaces
npx vitest run                              # full workspace
npx vitest run --project=cli                # CLI tests
npx vitest run --project=common --project=scripts
npm run cli:build                           # dev build
npm run cli:build:prod                      # prod build, validates T1
node apps/cli/dist/cli/main.mjs code --help # smoke check, default locale
LANG=fr_FR.UTF-8 node apps/cli/dist/cli/main.mjs code --help # smoke check, French
```

Captured outputs from the code-reviewer's verification run live at `issues/rsm-1639-dla-integration/verification/review-1-*.txt` for direct inspection.

### Exercising `/migrate` end-to-end

The full `/migrate` flow can only be exercised with a vendored DLA tree, which requires read access to the private `Automattic/data-liberation-agent` repo:

1. Set `GH_PAT` in your environment with read access to the repo.
2. Run `npm install` (the postinstall step will run `scripts/download-data-liberation-agent.ts` and populate `apps/cli/ai/dla/`).
3. Run `npm run cli:build` and confirm `apps/cli/dist/cli/dla/.claude-plugin/plugin.json` is present.
4. Run `node apps/cli/dist/cli/main.mjs code` and type `/migrate` (or `/migrate https://example.wixsite.com/foo`).
5. The agent should walk you through inspect → extract → verify → site-create → import. The `canUseTool` policy will prompt before `liberate_extract` and unmemoise after the session ends.

Without `GH_PAT`, the postinstall logs a warning and exits 0; `/migrate` is gated on `fs.existsSync(apps/cli/ai/dla)` at runtime in `agent.ts`, so the agent runs normally without DLA but the `/migrate` skill is unavailable. The unit-test path for T2/T5/T7/T8 covers both branches without needing DLA vendored.

## Pre-merge Checklist

This PR is intentionally draft — owner has flagged it as **DO NOT MERGE**. The items below need to be resolved before any merge attempt.

- [ ] Have you checked for TypeScript, React or other console errors? Verified clean by `review-1.md`.
- [ ] **Real `npm run cli:package` run with DLA vendored.** Confirms the `apps/cli/vite.config.prod.ts` plugin-copy fix lands DLA into the Electron extra-resource bundle (Open Question 1, resolved by T1, but verification with DLA vendored is still pending — the code-reviewer ran the prod build without DLA on disk).
- [ ] **`GH_PAT` distribution decision (Open Question 6).** Right now contributors must supply their own PAT or the install silently skips DLA. Long-term resolution: push the DLA team for tagged public releases so we can move to an npm dep (Approach C from `research-report.md`). Short-term: decide whether the team uses a shared GitHub App token, per-user PATs, or a public-mirror-of-tagged-releases workflow.
- [ ] **Bump `DLA_PINNED_SHA` from the `'main'` placeholder.** Currently `scripts/download-data-liberation-agent.ts` pins to `'main'`; before merge it must be a real commit SHA (TODO comment in the script tracks this).
- [ ] **Multi-plugin name namespacing verification (Open Question 4).** A 10-minute test during implementation: spawn `studio code` with DLA vendored and confirm DLA's MCP tools surface as `mcp__data-liberation__*` exactly once (no double-registration via DLA's own `.claude-plugin/plugin.json#mcp` colliding with our `query()`-time `mcpServers` entry).
- [ ] **DLA orphan-cleanup behaviour (Open Question 7).** Confirm DLA's `src/lib/preview/studio.ts:266-279` `rmSync` of orphan Studio site dirs does not double-manage sites Studio Code creates directly.
- [ ] Recommendation reviewed by a Studio CLI maintainer.
- [ ] Recommendation reviewed by a DLA maintainer (specifically: vendoring at a pinned SHA, the assumption that `delegate: true` is the canonical handoff for hosts like Studio Code, and the request to consider tagged public releases so we can move to an npm dep long-term).
- [ ] Linear tickets RSM-1639 and RSM-1675 updated with the recommendation, the implementation summary, and a link to this PR.
