## Related issues

- Related to RSM-3143 (research artifact + implementation, lands in this PR)

> **Naming note:** The command was renamed from `/migrate` to `/liberate` (and `studio migrate` to `studio liberate`) post-implementation per owner direction, to align with DLA's `liberate_*` tool prefix and its underlying `data-liberation` package. The PR description below has been updated in place; historical research artifacts (`research-report.md`, `plan.md`, `wave-1-findings/`, `prior-art/`) deliberately retain the original `/migrate` recommendation as evidence of the design conversation.
- Supersedes RSM-1639 (research, Done — host-side findings stale; runtime shifted from `@anthropic-ai/claude-agent-sdk` to `@mariozechner/pi-coding-agent`)
- Supersedes RSM-1675 (impl Approach A, Cancelled — vendor + fetch script)
- Supersedes RSM-3139 (impl Approach C, Cancelled — npm-dep against the old claude-agent-sdk)
- Supersedes PR #3277 (closed)

## How AI was used in this PR

This PR was orchestrated end-to-end via the `/orchestrator` skill across two phases. The full agent cascade:

**Research phase (RSM-3143):**
- 1 research-lead delegating sub-questions
- 5 parallel wave-1 researchers (pi extensibility surface; MCP bridge feasibility; vendor-as-AgentTools; subprocess revisit; upstream and bundling)
- Research-lead synthesised the report after evaluating no wave-2 was required

**Spec-to-code phase:**
- 1 planner converting the research recommendation into an 11-task plan
- 9 implementer agents (one per code task: T1 scaffolding, T2 deps, T3 bridge, T4 policy wiring, T5 skill + vite prod fix, T6 bridge bring-up/teardown, T7 slash command, T8 standalone `studio liberate` (originally `studio migrate`), T9 Playwright env in CI)
- 1 fix-implementer to resolve the `tsx/dist/cli.mjs` → `tsx/cli` resolution bug surfaced by code-review
- 1 code-reviewer running twice (rejected after T1–T9, approved after the fix at commit `65ce8848`)
- 2 documentator agents (T10 README, T11 design doc)
- 1 doc-reviewer (this pass)

Reviewers should especially scrutinise: the `tools/dla/` bridge contract (250 LOC, type-safe but uses one documented `inputSchema as unknown as TSchema` cast — see `wave-1-mcp-bridge-feasibility.md` §2 for why this is safe); the two-layer permission policy in `tools/dla/policy.ts`; the `STUDIO_DLA_ENABLED` feature-flag gating in `apps/cli/ai/runtimes/pi/index.ts`; and the `/liberate` skill body at `apps/cli/ai/skills/liberate/SKILL.md`.

**Draft PR — not for immediate merge.** Per owner direction, both the research artifacts and the implementation land in the same PR. The PR is opened as a draft pending human review on a real Wix/Squarespace test site with `STUDIO_DLA_ENABLED=1` and pending product decisions on the feature-flag default for v1 (currently off).

## Proposed Changes

### Research artifacts (RSM-3143)

- `issues/rsm-3143-dla-pi-research/research-report.md` — synthesis report. Recommends MCP-stdio bridge as the canonical `/liberate` path against pi-coding-agent, with Subprocess as a separate `studio liberate <url>` standalone CLI command and Vendor-as-AgentTools as a documented fallback. (Research artifact still references the original `/migrate` name; the as-shipped command is `/liberate`.)
- `issues/rsm-3143-dla-pi-research/research-plan.md` — research plan with wave-1 findings log.
- `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-*.md` — five wave-1 researcher findings: pi extensibility surface, MCP bridge feasibility, vendor-as-AgentTools, subprocess revisit, upstream + bundling.
- `issues/rsm-3143-dla-pi-research/prior-art/` — preserved prior-art bundle (RSM-1639 + RSM-3139 specs/plans/notes).
- `issues/rsm-3143-dla-pi-research/plan.md` — 11-task implementation plan derived from the research.
- `issues/rsm-3143-dla-pi-research/review-1.md` + `review-2.md` — code-review verdicts.
- `issues/rsm-3143-dla-pi-research/doc-review-1.md` + this `PR-description.md`.

### Code deliverables (T1–T9)

- **T1 — `tools/dla/` workspace package scaffold** (commit `a3b2be96`): new `@studio/dla` workspace package as a sibling of `tools/common/`. Adds `tsconfig.json`, `package.json`, alias wiring in `apps/cli/tsconfig.json` and `apps/cli/vite.config.base.ts`.
- **T2 — DLA + tsx runtime deps** (commit `2df39446`): pins `"data-liberation": "github:Automattic/data-liberation-agent#17219c42b0420267302b138bf402930508006e0e"` and `"tsx": "^4.19.0"` in `apps/cli/package.json` `dependencies`. `tsx` lives in runtime deps so it survives `--omit=dev`.
- **T3 — MCP-stdio bridge** (commit `22d5144a`): `tools/dla/bridge.ts`, `agent-tool-adapter.ts`, `content-adapter.ts`, `policy.ts`, `index.ts`, plus four vitest files (45 tests). Spawns DLA's MCP server as a child process via `process.execPath` + `tsx`, connects an MCP `Client` over stdio, lists tools, and adapts each into a pi `ToolDefinition`. Defaults `degraded: true` on spawn or `listTools` failure rather than crashing session startup.
- **T4 — DLA policy extension factory wired into pi runtime** (commit `286a4c50`): `apps/cli/ai/runtimes/pi/index.ts` constructs `DefaultResourceLoader` with `extensionFactories: [ createDlaPolicyFactory(defaultPolicyBuckets) ]` when `STUDIO_DLA_ENABLED=1`. Inline `extensionFactories` load even with `noExtensions: true`, so no other loader flags flip.
- **T5 — `/liberate` skill + vite prod skills-copy fix** (commit `0de39aa0`): `apps/cli/ai/skills/liberate/SKILL.md` (frontmatter `name` + `description` only; body uses bare DLA tool names and steers callers toward `delegate: true`). `apps/cli/vite.config.prod.ts` learns the same `ai/skills` static-copy target that `dev.ts` and `npm.ts` already had — previously, the prod-bundled CLI silently shipped without skills.
- **T6 — DLA bridge bring-up + teardown** (commit `aedb5e7b`): `maybeStartDlaBridge` runs before `createStudioAgentSession`; the bridge handle is threaded through `buildAgentTools` and its `tools` spliced into the local-site tool list (not the remote-site branch, to avoid recursive migrations back into Studio). Teardown lives in the existing `finally` block alongside `session.dispose()`.
- **T7 — `/liberate` slash command** (commit `b1bebaaa`): registers `{ name: 'liberate', description: __(...) }` in `tools/common/ai/slash-commands.ts`'s `AI_SKILL_COMMANDS`. The existing skill-dispatcher in `apps/cli/commands/ai/index.ts` routes through `runAgentTurn(buildSkillInvocationPrompt('liberate'))`.
- **T8 — `studio liberate <url>` standalone command** (commit `b42a8286`): new yargs command at `apps/cli/commands/liberate/`. Thin wrapper that spawns DLA's CLI via `process.execPath` + `tsx`, inherits stdio, forwards `SIGINT` / `SIGTERM`, propagates exit code. No agent in the loop — DLA's own Ink UI streams to the terminal.
- **T9 — Skip Playwright Chromium download in CI build pipelines** (commit `43a7d920`): sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in `.buildkite/pipeline.yml`, `.buildkite/release-build-and-distribute.yml`, `.buildkite/release-pipelines/code-freeze.yml`, `.github/workflows/publish-npm-package.yml`, and `apps/cli/package.json`'s `install:bundle` script. See the **Playwright env-var caveat** below.
- **Fix (post-review-1)** (commit `65ce8848`): `tools/dla/bridge.ts` resolves `tsx` as `tsx/cli` (the public exports key) rather than `tsx/dist/cli.mjs`, which throws `ERR_PACKAGE_PATH_NOT_EXPORTED` against `tsx@4.21.0`. Adds three regression tests against the production `defaultTransportProvider` resolution path.

### Doc deliverables (T10, T11)

- **T10 — `apps/cli/README.md`** (commit `7c083282`): new "Migrate from a closed platform" section between "Studio Code" and "Import and export". Covers user-facing surface only — both invocation modes (`/liberate` inside `studio code` with `STUDIO_DLA_ENABLED=1`, and `studio liberate <url>` standalone), platform credential env vars (`LIBERATION_TOKEN`, `SHOPIFY_ADMIN_TOKEN`), and the Playwright Chromium cost.
- **T11 — `docs/design-docs/cli.md`** (commit `0cd93cab`): new "Data Liberation Agent integration" section. Documents the as-built architecture: dep pin model, `tools/dla/` layout, bridge spawn pipeline, tool wrapping, two-layer permission policy, feature-flag gating, bare-name tool surface, `delegate: true` handoff contract, both user surfaces, the orphan-work caveat (DLA does not honor `notifications/cancelled`), the Playwright env-var caveat, and the update cadence.

### Scope

All code changes live in `apps/cli/` and the new `tools/dla/` workspace package. **No `apps/studio/` changes.** No Electron-side touchpoints.

## Testing Instructions

### Build + unit tests

```bash
npm install
npm run cli:build
npm test
```

Expected: 1721+ tests pass across all workspaces (45 in `tools/dla/` alone). `npm run typecheck` passes for all workspaces including `@studio/dla`. `npx eslint tools/dla apps/cli/ai/runtimes/pi/index.ts apps/cli/commands/liberate` returns 0 errors.

### Exercise `/liberate` end-to-end (agent path)

The agent integration is gated behind `STUDIO_DLA_ENABLED=1` for v1. Without the flag, `studio code` behaves identically to pre-PR.

```bash
STUDIO_DLA_ENABLED=1 node apps/cli/dist/cli/main.mjs code
# inside the session:
/liberate https://your-test-wix-or-squarespace-site.example
```

Expected: the agent introduces the skill, calls `liberate_inspect`, narrates results, asks `AskUserQuestion` to confirm, runs `liberate_extract` → `liberate_verify` → `liberate_setup` (with `delegate: true`), creates a Studio site via `site_create` with an inline `importWxr` blueprint step, then calls `liberate_import` with `delegate: true` and handles the returned manifest (media copy, redirect map, authors, optional Shopify products via `wp_cli`).

Smoke-check the bridge is active:

```bash
STUDIO_DLA_ENABLED=1 node apps/cli/dist/cli/main.mjs code --json "list all tools available"
```

Expected: the response mentions `liberate_inspect`, `liberate_extract`, etc. alongside Studio's own tools. If the bridge fails to spawn, the runtime logs `[studio code] DLA bridge degraded; continuing without DLA tools (...)` and proceeds without DLA — the agent still answers, but `liberate_*` tools are absent.

For Webflow / Shopify test sites, also set `LIBERATION_TOKEN=...` / `SHOPIFY_ADMIN_TOKEN=...` before launching.

### Exercise `studio liberate <url>` (standalone path)

```bash
node apps/cli/dist/cli/main.mjs liberate --help
node apps/cli/dist/cli/main.mjs liberate https://example.com --output ./out --non-interactive
```

Expected: DLA's Ink UI streams directly to the terminal. `--output` and `--non-interactive` are forwarded; any additional DLA flags work too (yargs is non-strict for this command). Exit code propagates DLA's exit code; `SIGINT`/`SIGTERM` are forwarded to the child.

### Permission policy

The destructive `liberate_import` bucket blocks calls without `delegate: true`. The block fires in two layers: the adapter-layer `shouldBlock()` check inside the tool's `execute()` wrapper, and the runtime-layer `pi.on('tool_call', ...)` extension hook. Either layer alone is sufficient; the second is defence-in-depth.

To smoke-test policy, watch the agent transcript for any `liberate_import` call without `delegate: true` — it should fail with the Studio policy error rather than hitting DLA. (The skill body explicitly instructs the agent never to call `liberate_import` without `delegate: true`.)

### Verify CI Playwright env

`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is now set in:

- `.buildkite/pipeline.yml`
- `.buildkite/release-build-and-distribute.yml`
- `.buildkite/release-pipelines/code-freeze.yml`
- `.github/workflows/publish-npm-package.yml`
- `apps/cli/package.json` → `install:bundle` script

See the **Playwright env-var caveat** below for what this actually does today.

## Pre-merge Checklist

Five gates require an explicit human decision before this PR is mergeable. Each gate explains the state of the world and why the decision can't be deferred past merge.

### Gate 1 — Real-site `/liberate` lifecycle verified

- [ ] Reviewer manually runs `STUDIO_DLA_ENABLED=1 studio code` against at least one live Wix or Squarespace test site, walks through `/liberate <url>` end-to-end, and confirms the new Studio site contains the expected pages, posts, and media.

**What's happening:** All Studio CLI implementation work landed and passes the 1724-test unit/integration suite. The bridge spawns DLA, tools register, the policy gates work, the wrapper-skill body parses cleanly. **But none of the implementer agents nor the code-reviewer drove an actual `/liberate` flow against a real source site.** Doing so requires DLA's adapters to perform real network I/O against a closed platform, drive headless Chromium against Wix/Squarespace, produce a real WXR, and import it into a fresh Studio site.

**Why it's a merge-time gate:** Unit tests exercise the bridge, the adapter, the policy, and the runtime wiring — they don't exercise DLA's adapter code paths or the agent's reasoning over real DLA outputs. There may be runtime issues that only surface end-to-end: a wrong tool-argument shape the wrapper skill emits, the content adapter mishandling some MCP response variant DLA produces against a real site, the `importWxr` blueprint failing on an unexpected WXR shape, the `delegate: true` manifest containing an unexpected field. The orchestrator's agents had no way to perform this test (no disposable test site, no credentials, no human in the loop to evaluate "did the migration actually work"). A human reviewer should do it once before merging.

### Gate 2 — Feature-flag default decided for v1

- [ ] Owner confirms whether `STUDIO_DLA_ENABLED` ships **off by default** (current state) or **on by default** for v1. If on, README and design-doc references to the flag must be updated.

**What's happening:** Both the bridge spawn (in `runAgentSessionTurn`) and the policy extension factory (in `DefaultResourceLoader.extensionFactories`) check `STUDIO_DLA_ENABLED === '1'` and early-return when it's unset or `'0'`. With the flag off (the v1 default we shipped), the runtime is byte-for-byte identical to before this PR: no bridge child process, no DLA tools in `customTools`, no policy factory in the resource loader. Users running `studio code` see no `/liberate`, no DLA tools, nothing different.

**Why it's a merge-time gate:** This is a product decision, not a code one. Shipping with the flag **off** means `/liberate` is invisible to users until someone manually sets the env var — fine for a staged rollout, but defeats the discovery story (no one will find `/liberate` by accident; the slash menu won't autocomplete it). Shipping with the flag **on** means every user gets `/liberate` by default — better discoverability, but takes on the bridge child-process lifecycle, the ~150 MB Chromium download, and the cancellation-orphan caveat (Gate 5) for the entire user base on first install. The reviewer should pick which posture matches the project's rollout plan. Could also be conditional (on for opt-in beta tracks, off for stable). Either choice is defensible; the orchestrator does not have the project context to choose.

### Gate 3 — Playwright Chromium download story decided

- [ ] Owner decides whether to accept the ~150 MB CI cost, upstream a fix to DLA's postinstall, vendor-patch DLA via `patch-package`, or pre-populate `PLAYWRIGHT_BROWSERS_PATH` from a CI cache.

**What's happening:** DLA's `package.json` has `"postinstall": "playwright install chromium"`. When any `npm install` pulls DLA in (CI, dev machines, end-user `npm install -g wp-studio`), DLA's postinstall fires and downloads ~150 MB of headless Chromium binaries. Wix and Squarespace adapters use that Chromium to scrape JavaScript-rendered pages. T9 set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in `.buildkite/`, `.github/workflows/`, and the `install:bundle` script — the documented Playwright way to skip the download.

**Why it's a merge-time gate:** The T9 implementer discovered empirically that **the env var is currently inert.** Modern Playwright (the one DLA pins) no longer has a postinstall hook of its own — that hook was the only place `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` got consulted. DLA's postinstall calls Playwright's `installBrowsers()` function directly, which doesn't check the env var. So today, setting it has no effect — Chromium still downloads on every CI build. The env var landed anyway as zero-cost forward-compat (if Playwright re-adds postinstall behavior, or we patch DLA, it's already wired everywhere), but **the ~150 MB CI cost is currently unmitigated.** The reviewer should pick a mitigation strategy (or explicitly accept the cost) before merge so the gap is closed in the same release cycle, not deferred indefinitely.

### Gate 4 — DLA SHA pin is current at merge time

- [ ] Reviewer compares the pinned SHA to `Automattic/data-liberation-agent`'s `HEAD`. If DLA has shipped meaningful commits since 2026-05-07, bump the pin and re-run the smoke test. After bumping, re-check `tools/dla/policy.ts` `defaultPolicyBuckets` for any new tools.

**What's happening:** DLA isn't published to npm and has no git tags. To get a reproducible install, we pinned it to a specific commit SHA: `"data-liberation": "github:Automattic/data-liberation-agent#17219c42b0420267302b138bf402930508006e0e"` in `apps/cli/package.json`. That SHA was the DLA HEAD on 2026-05-07 (when wave-1 audited DLA's source).

**Why it's a merge-time gate:** DLA is actively developed. Between when we picked the SHA and the merge moment, DLA may have shipped useful fixes (e.g., `notifications/cancelled` support — Gate 5), or it may have shipped breaking changes our wrapper-skill or policy buckets assume the absence of. There's no automation here — no Dependabot, no Renovate, `github:` deps aren't auto-tracked. Bumping the pin is a one-line edit, but it must be a conscious decision at merge time, not "merge with the stale SHA because no one looked." Specifically: if DLA added a 14th MCP tool since 2026-05-07, our `defaultPolicyBuckets` (which enumerates all 13 known tools) will fall into the defensive "unknown DLA tool → deny" path for the new tool, making it unreachable through `/liberate` until the bucket table is extended.

### Gate 5 — Upstream-DLA issue for `notifications/cancelled` filed

- [ ] Team lead files an issue against `Automattic/data-liberation-agent` requesting that DLA's MCP server wire `notifications/cancelled` (and ideally `progressToken`) into its tool handlers.

**What's happening:** MCP has a standard protocol message called `notifications/cancelled` that a client sends to the server when it wants to abort an in-flight tool call. Well-behaved MCP servers receive it and stop the work. Studio's bridge wires this correctly — when the agent's `AbortSignal` fires (Ctrl+C, model decides to bail), the bridge forwards the abort to DLA via `notifications/cancelled`. But DLA's MCP server doesn't honor it — DLA receives the message and keeps working.

**Why it's a merge-time gate:** Concretely: if the agent kicks off `liberate_extract` against a Wix site and 30 seconds in the user cancels, Studio sees the tool call as cancelled and the agent moves on. From DLA's side, the extraction continues silently to completion, writing partial output to disk. This is bounded — DLA's resume-safe protocol (`extraction-log.jsonl`, `session.json`, `media-stubs.json`) detects and reuses those partial outputs on the next `liberate_extract` run, so it's not data loss. But it is wasted CPU/network/disk in the background and mildly surprising semantics (the user thinks they cancelled, but source-platform requests keep going for a while). The orchestrator left filing the upstream issue to a human because it's cross-team coordination, not an in-repo implementation change. Filing it before merge surfaces the gap, lets DLA's maintainers plan a fix, and tracks the eventual update to Studio's docs.

### Standard checklist

- [ ] Have you checked for TypeScript, React or other console errors? — Yes (`npm run typecheck` clean across all workspaces; lint clean on touched files).
- [ ] Is the PR scoped? — Combined research + implementation, intentionally bundled by owner direction. The implementation is the **direct response** to the research recommendation; both artifacts read in tandem.
- [ ] Does the PR avoid `apps/studio/` changes? — Yes (`git diff --stat 46d83870..HEAD -- 'apps/studio/'` is empty).
