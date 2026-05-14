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

- [ ] **Real-site lifecycle verified.** Reviewer manually runs `STUDIO_DLA_ENABLED=1 studio code` against at least one live Wix or Squarespace test site, walks through `/liberate <url>` end-to-end, and confirms the new Studio site contains the expected pages, posts, and media. This is the load-bearing check the orchestrator could not perform.
- [ ] **Feature-flag default decided for v1.** Currently `STUDIO_DLA_ENABLED` is **off by default** — both the bridge spawn and the policy extension factory early-return when the flag is unset. Owner to confirm whether v1 ships off (current state) or on. If shipping on, the v1 release needs a docs update (the README explicitly mentions the flag) and the bug bar may move.
- [ ] **Playwright Chromium download story.** T9 sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in CI configs as defensive forward-compat, but the design doc (T11) flags that the env var is currently **inert against modern Playwright**: neither `playwright` nor `playwright-core` has a postinstall hook that honors it, and DLA's own postinstall is `playwright install chromium` which runs unconditionally. Decision needed: either accept the ~150 MB cost in CI (the env var is zero-cost insurance for the future), upstream a fix to DLA's postinstall, or vendor-patch DLA's postinstall in Studio's install pipeline.
- [ ] **DLA SHA pin is current at merge time.** `apps/cli/package.json` pins `data-liberation` to commit `17219c42b0420267302b138bf402930508006e0e` (audited HEAD as of 2026-05-07). DLA has no semver releases; the pin should be re-verified against `Automattic/data-liberation-agent` `HEAD` before merge and bumped if needed. After bumping, re-check `tools/dla/policy.ts` `defaultPolicyBuckets` for any new tools.
- [ ] **Orphan-work caveat surfaced for the next maintainer.** DLA's MCP server does not honor `notifications/cancelled`; cancelled `liberate_extract` keeps crawling server-side until the bridge's `dispose()` SIGKILLs the child at session teardown. Filesystem cleanup is bounded by DLA's resume-safe protocol (`extraction-log.jsonl`, `session.json`). Documented in `docs/design-docs/cli.md` and surfaced here so the reviewer is not surprised. Candidate upstream issue against `Automattic/data-liberation-agent`; team lead to file manually.
- [ ] Have you checked for TypeScript, React or other console errors? — Yes (`npm run typecheck` clean across all workspaces; lint clean on touched files).
- [ ] Is the PR scoped? — Combined research + implementation, intentionally bundled by owner direction. The implementation is the **direct response** to the research recommendation; both artifacts read in tandem.
- [ ] Does the PR avoid `apps/studio/` changes? — Yes (`git diff --stat 46d83870..HEAD -- 'apps/studio/'` is empty).
