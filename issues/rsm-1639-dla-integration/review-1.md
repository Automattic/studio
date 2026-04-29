# Review 1

## Verdict: approved

## Summary

The eight `[code]` tasks (T1–T8) for the DLA integration land cleanly within scope. All source changes stay in `apps/cli/`, `tools/common/ai/`, root `scripts/`, root `package.json`, and root `vitest.config.ts` — no `apps/studio/` or `apps/ui/` files touched. Each task's acceptance criteria from `plan.md` are met: T1 closes the `vite.config.prod.ts` plugin gap (verified by inspecting `apps/cli/dist/cli/plugin/.claude-plugin/plugin.json` after `cli:build:prod`); T2 ships a build-time fetch script with a graceful no-token skip path and four vitest cases covering the spec; T3 wires the postinstall step plus `fast-xml-parser` and `papaparse` into `apps/cli/package.json`; T4 conditionally registers `ai/dla` static-copy targets across all three Vite configs with a cross-config test that flips the `existsSync` branch on disk; T5 wires DLA as a second local plugin and stdio MCP server (correctly dropping `cwd` and using absolute `args`, verified against `McpStdioServerConfig` at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1005`); T6 adds the `/migrate` slash command via the shared list; T7 adds the wrapper SKILL with `user-invocable: true` (with C, not the K typo) and an explicit assertion in tests; T8 wires a `canUseTool` permission scoping callback in a sibling `apps/cli/ai/dla-permissions.ts` with thorough policy-based tests including default-deny when `onAskUser` is unavailable. Approach E (`/migrate --headless`) and the `user-invokable` typo cleanup were both correctly deferred.

The full vitest workspace (1474 tests across 158 files) passes, typecheck passes, lint is clean on every file the patches touched, the dev and prod CLI builds both succeed, and `node apps/cli/dist/cli/main.mjs code --help` renders correctly under both default and French locales. T9–T10 (docs) remain pending as planned.

## Checks

| Check                              | Command                                                                                                                                         | Result                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Full vitest (workspace)            | `npx vitest run`                                                                                                                                | 1474 passed across 158 files                      |
| CLI tests project                  | `npx vitest run --project=cli`                                                                                                                  | 559 passed across 54 files                        |
| common + scripts test projects     | `npx vitest run --project=common --project=scripts`                                                                                             | 301 passed across 25 files                        |
| scripts test project (T2)          | `npx vitest run --project=scripts`                                                                                                              | 4 passed across 1 file                            |
| Type check                         | `npm run typecheck`                                                                                                                             | No errors (all four workspaces clean)             |
| ESLint (touched files)             | `npx eslint apps/cli/ai/agent.ts apps/cli/ai/dla-permissions.ts ... scripts/download-data-liberation-agent.ts ... tools/common/ai/...` | No errors. Pre-existing parsing error on root `vitest.config.ts` confirmed unrelated (reproduces on baseline) |
| CLI build (dev)                    | `npm run cli:build`                                                                                                                             | Built; `dist/cli/plugin/skills/migrate/SKILL.md` present, `dist/cli/dla` correctly absent (no GH_PAT, graceful skip) |
| CLI build (prod, validates T1)     | `npm run cli:build:prod`                                                                                                                        | Built; `dist/cli/plugin/.claude-plugin/plugin.json` present, T1 fix verified |
| Scope (forbidden dirs)             | `git diff 322a5c3e..HEAD --name-only` filtered                                                                                                  | Zero changes under `apps/studio/` or `apps/ui/`   |

## CLI Verification

Evidence saved to `issues/rsm-1639-dla-integration/verification/`:

### Command Runs

| Command invoked                                                       | Expected behavior                                                                                       | Observed behavior                                                                          | Pass?  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| `node apps/cli/dist/cli/main.mjs code --help`                         | Render `studio code` subcommand usage; should list `code [message]` and `code sessions`                 | Rendered correctly with all flags and subcommands                                          | yes    |
| `LANG=fr_FR.UTF-8 node apps/cli/dist/cli/main.mjs code --help`        | Same usage, with the localized strings translated                                                       | Rendered with French translations on existing strings (e.g. "Agent d'IA", "Commandes :")   | yes    |
| `node apps/cli/dist/cli/main.mjs --help`                              | Top-level help renders `studio code` among commands                                                     | Rendered correctly                                                                         | yes    |
| `npm run cli:build`                                                   | Dev build copies `ai/plugin/` and (when present) `ai/dla/` into `dist/cli/`                             | `dist/cli/plugin/skills/migrate/SKILL.md` present; `dist/cli/dla` absent (no GH_PAT — expected graceful skip) | yes    |
| `npm run cli:build:prod`                                              | Prod build copies `ai/plugin/` (T1 fix)                                                                 | `dist/cli/plugin/.claude-plugin/plugin.json` and `dist/cli/plugin/skills/migrate/SKILL.md` present                          | yes    |

### Output Evidence

| Run                                            | Evidence file                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Top-level help                                 | `verification/review-1-toplevel-help.txt`                                                           |
| `studio code --help` (default locale)          | `verification/review-1-code-help-stdout.txt`                                                        |
| `studio code --help` (French locale)           | `verification/review-1-code-help-fr.txt`                                                            |
| Full vitest workspace                          | `verification/review-1-full-tests.txt`                                                              |
| CLI vitest project                             | `verification/review-1-cli-tests.txt`                                                               |
| common + scripts vitest projects               | `verification/review-1-common-scripts-tests.txt`                                                    |
| scripts vitest project (T2)                    | `verification/review-1-scripts-tests.txt`                                                           |
| Typecheck                                      | `verification/review-1-typecheck.txt`                                                               |
| ESLint touched files                           | `verification/review-1-eslint-touched.txt`                                                          |
| ESLint full set (incl. pre-existing config error) | `verification/review-1-eslint.txt`                                                                  |
| CLI build (dev)                                | `verification/review-1-cli-build.txt`                                                               |
| CLI build (prod)                               | `verification/review-1-cli-build-prod.txt`                                                          |

The `/migrate` flow itself can only be exercised end-to-end with a vendored DLA tree (gated on `GH_PAT`), which is unavailable in this review environment by design. The graceful skip path is verified — the build proceeds without DLA, and the test in `apps/cli/ai/tests/agent.test.ts` ("does not register data-liberation MCP server when dla/ dir is missing") covers the runtime branch.

## Per-task acceptance verification

- **T1** — `apps/cli/vite.config.prod.ts:21–41` adds the `viteStaticCopy` block with `ai/plugin` (unconditional) and `ai/dla` (gated on `existsSync`). A code comment notes the fix is independent of DLA and reviewable on its own. Prod build produces `dist/cli/plugin/.claude-plugin/plugin.json`. Plan §T1 explicitly says no new test required for the build-config fix.
- **T2** — `scripts/download-data-liberation-agent.ts` is modeled on `download-agent-skills.ts`. Behavior covered: SHA pin (with TODO+OQ6 reference), GH_PAT/GH_TOKEN env-var fallback, skip-on-missing-token (logs warning, returns 0), tarball download via `https://api.github.com/repos/Automattic/data-liberation-agent/tarball/<sha>`, tar extraction, tsc pre-compile via injected `runCompiler` test seam, atomic-ish staging swap, `.dla-pinned-sha` provenance file, `--update`/`STUDIO_REFRESH_DLA=1` opt-in. `scripts/__tests__/download-data-liberation-agent.test.ts` covers all four spec items (skip, copy, rename, sha file). `scripts/vitest.config.ts` and `vitest.config.ts` updated to wire the new project. `.gitignore` adds `apps/cli/ai/dla/`.
- **T3** — Postinstall extended with `&& ts-node ./scripts/download-data-liberation-agent.ts` after `download-agent-skills.ts` in `package.json:33`. `apps/cli/package.json` adds `fast-xml-parser ^5.7.2` and `papaparse ^5.5.3` (versions pinned without DLA's package.json available; the agent.test.ts "missing DLA dir is non-fatal" coverage is implemented as the broader DLA-absent branch in T5's tests).
- **T4** — All three Vite configs gain `ai/dla` static-copy targets gated on `existsSync(resolve(__dirname, 'ai/dla'))`. The cross-config test in `apps/cli/tests/vite-config.test.ts` mocks `viteStaticCopy`, flips the directory state on disk via `mkdirSync`/`rmSync` with strict pre-flight refusal if the path pre-exists, and asserts the union of static-copy targets across the three configs.
- **T5** — `apps/cli/ai/agent.ts` registers DLA conditionally on `dlaAvailable`. Comment correctly documents that `McpStdioServerConfig` lacks a `cwd` field. Implementation drops `cwd` and uses `path.resolve(dlaPath, 'src/mcp-server.js')` for absolute `args`. `wpcomAccessToken` plumbing in `apps/cli/commands/ai/index.ts:447–453` is moved out of the `site?.remote` guard; the comment explains why. Tests cover all four spec branches (DLA registered/absent, plugin array length, token forwarding, canUseTool registration only when DLA is available). The token-read change introduces no behavior regression — the previous behavior assigned `wpcomAccessToken` only when `site?.remote` was truthy; the new code passes the token unconditionally, and `agent.ts:75` still gates the `isRemoteSite` flag on `activeSite?.remote && wpcomAccessToken` so remote-tools wiring is unaffected.
- **T6** — `tools/common/ai/slash-commands.ts:13` appends `{ name: 'migrate', description: __('Migrate a site from a closed platform into Studio') }`. Test in `tools/common/ai/tests/slash-commands.test.ts` asserts both presence and the canonical invocation prompt.
- **T7** — `apps/cli/ai/plugin/skills/migrate/SKILL.md` uses `user-invocable: true` (with C). The body covers Steps 1–9 plus an explicit "What this skill does NOT do" footer documenting Approach E deferral. `apps/cli/ai/tests/plugin-skills.test.ts` rolls its own minimal frontmatter parser (rather than pulling in `js-yaml`), parses the SKILL.md, asserts `name === 'migrate'`, asserts `user-invocable === true` AND `user-invokable === undefined` (per the plan's explicit requirement), validates `argument-hint`, validates the precise `allowed-tools` list, and asserts the preview tools are not allowed.
- **T8** — `apps/cli/ai/dla-permissions.ts` exports `buildDlaCanUseTool(options)`, `agent.ts:189` wires it to `query()`'s `canUseTool` only when DLA is available. Policy: read-only tools auto-allow; `liberate_import` with `delegate: true` auto-allows; ask-once tools (`liberate_extract`, `liberate_setup`, `liberate_map_apis`, `liberate_probe`, plus `liberate_import` with `delegate: false/absent`) prompt and memoise per-session via a closure-scoped Set. Default-deny when `onAskUser` is missing (correctly explicit, with a TODO referencing OQ2 for a future non-interactive opt-in flag) and on unrecognised DLA tools. 11 vitest cases cover the policy.

## Notes / minor nits (non-blocking)

These are observations worth tracking but do not warrant rejection:

- **`agent.ts:111` cites `sdk.d.ts:395`** for the `McpStdioServerConfig` shape, but the actual definition lives at `sdk.d.ts:1005`. Line 395 is mid-import-block. The substantive claim (no `cwd` field) is correct; only the line cite is stale. Not blocking — easy follow-up if revisited.
- **`dla-permissions.ts:72` uses `__('...').replace('%s', value)`** rather than the `sprintf(__('...'), value)` pattern that's idiomatic across `apps/cli/commands/{push,pull,export}.ts`. The string is wrapped in `__()` so the translation pipeline picks it up, and the substitution works correctly, but consistency with the surrounding CLI's i18n style would be slightly better.
- **`DLA_PINNED_SHA = 'main'`** in the fetch script is a known placeholder, with a TODO referencing OQ6, per plan §T2 scope. The plan accepts this; the SHA bump is a one-line change before merge.
