# Review 1

## Verdict: rejected

## Summary

The 9 implementation commits (T1–T9) land a clean, well-tested workspace package at `tools/dla/`, a pi-runtime wiring that's properly feature-flagged, a non-MCP standalone `studio migrate` command, and CI Playwright skip wiring. Code quality, test coverage, type safety, lint, scope (no `apps/studio/` touches), and translation wrapping are all in good shape. All 1721 unit tests pass, the CLI builds cleanly, and both `studio code` and `studio migrate` boot.

However, the headline behavior of the integration — the DLA bridge actually loading DLA tools into the agent — does not work at runtime. Booting `studio code` with `STUDIO_DLA_ENABLED=1` reproduces the implementer-flagged `tsx/dist/cli.mjs` resolution bug: `tsx`'s `exports` map does not expose that subpath, so `require.resolve('tsx/dist/cli.mjs')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. The bridge's graceful-degradation path catches the throw and continues without DLA tools — the agent still answers, but the `liberate_*` tools are never registered. This contradicts T6's acceptance criterion ("`liberate_detect` shows up in the tool list"). The unit tests miss the bug because they bypass the production transport via the (otherwise sound) `BridgeTransportProvider` injection.

The fix is a one-liner (`tsx/cli` instead of `tsx/dist/cli.mjs`) — the standalone migrate command's `resolveTsxCli` (`apps/cli/commands/migrate/resolvers.ts`) already uses the correct form.

## Checks

| Check         | Command                                                                                | Result                                       |
| ------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| Unit tests    | `npm test` (root, all workspaces)                                                      | ✅ 188 files / 1721 tests passed             |
| Type check    | `npm run typecheck`                                                                    | ✅ All workspaces pass (incl. `@studio/dla`) |
| Lint          | `npx eslint tools/dla apps/cli/ai/runtimes/pi/index.ts apps/cli/commands/migrate ...`  | ✅ 0 errors, 1 ignored-file warning on .md   |
| CLI build     | `npm run cli:build`                                                                    | ✅ Vite emits all bundles                    |
| Scope         | `git diff --stat 46d83870..43a7d920 -- 'apps/studio/'`                                 | ✅ No changes to `apps/studio/`              |
| Flag gating   | grep `STUDIO_DLA_ENABLED` across runtime — both bridge spawn + policy factory          | ✅ Both early-return when flag is unset      |

## CLI Verification

Evidence saved to `issues/rsm-3143-dla-pi-research/verification/`:

### Command Runs

| Command invoked                                                                                       | Expected behavior                                              | Observed behavior                                                                                            | Pass? |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----- |
| `node apps/cli/dist/cli/main.mjs code --help`                                                         | Prints `studio code` usage                                     | Usage printed; exit 0                                                                                        | yes   |
| `node apps/cli/dist/cli/main.mjs migrate --help`                                                      | Prints `migrate <url>` usage with `--output` / `--non-interactive` | Usage printed; exit 0                                                                                        | yes   |
| `LANG=es node apps/cli/dist/cli/main.mjs migrate --help`                                              | yargs chrome translated, new strings unchanged (no Spanish .jed yet) | yargs translates "Show help", "Positionals:", etc.; new `__()`-wrapped strings stay in English (expected)    | yes   |
| `node --input-type=module 'require.resolve("tsx/dist/cli.mjs")'` against root `node_modules`          | Resolve path                                                   | FAILS with `ERR_PACKAGE_PATH_NOT_EXPORTED` (tsx 4.21.0 exports map has no `./dist/cli.mjs` key)              | no    |
| `STUDIO_DLA_ENABLED=1 ... node apps/cli/dist/cli/main.mjs code --json "hello world"`                  | DLA bridge boots, `liberate_*` tools registered as customTools | Bridge spawn fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`; degraded path takes over; 0 `liberate_*` tools seen | **no** |

### Output Evidence

| Run                                          | Evidence file                                                       |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `studio code --help`                         | `verification/review-1-code-help-stdout.txt`                        |
| `studio migrate --help`                      | `verification/review-1-migrate-help-stdout.txt`                     |
| `studio migrate --help` (Spanish)            | `verification/review-1-migrate-help-i18n-stdout.txt`                |
| `tsx`/DLA resolution check                   | `verification/review-1-tsx-resolution.txt`                          |
| `STUDIO_DLA_ENABLED=1 studio code` transcript | `verification/review-1-dla-enabled-stdout.txt`                      |
| Bridge-degraded summary + root cause          | `verification/review-1-dla-bridge-degraded.txt`                     |

## Issues

### Issue 1: DLA bridge spawn fails at runtime — `tsx/dist/cli.mjs` is not an exported subpath of the `tsx` package

**What's wrong:** `require.resolve('tsx/dist/cli.mjs')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` because `tsx@4.21.0`'s `exports` map only exposes `./cli` → `./dist/cli.mjs`; the literal `./dist/cli.mjs` subpath is intentionally not exported. The implementer flagged this in the prompt as a likely must-fix; I reproduced the failure end-to-end. With `STUDIO_DLA_ENABLED=1`, the bridge log emits

```
[@studio/dla] failed to spawn DLA MCP server (Package subpath './dist/cli.mjs' is not defined by "exports" in /…/node_modules/tsx/package.json); continuing without DLA tools.
[studio code] DLA bridge degraded; continuing without DLA tools (...).
```

and no `liberate_*` tool ever shows up in the agent transcript. T6's acceptance criterion ("`liberate_detect` shows up in the tool list") therefore is not satisfied for any real session — every invocation falls into the degraded path. The graceful-degradation guardrail is correct and prevents a crash, but the bridge itself is non-functional today.

The standalone `studio migrate` command (added in T8) already uses the canonical form (`apps/cli/commands/migrate/resolvers.ts:30` → `require.resolve('tsx/cli')`) which resolves cleanly to the same file. The bridge needs the same spelling.

**Where:** `tools/dla/bridge.ts:267` — `const tsxCli = require.resolve( 'tsx/dist/cli.mjs' );`

**Expected:** `const tsxCli = require.resolve( 'tsx/cli' );` (or follow the existing pattern in `apps/cli/commands/migrate/resolvers.ts:30`). Add a unit test that exercises the production `defaultTransportProvider` resolution (not just the swappable `BridgeTransportProvider`) so this regression cannot recur silently — e.g. a vitest that calls `require.resolve('tsx/cli')` and `require.resolve('data-liberation/src/mcp-server.ts')` and asserts both succeed.

**Severity:** must-fix

### Issue 2 (informational, not a blocker): `tools/dla/tsconfig.json` `outDir: dist` collides with built artifacts

The package's `tsconfig.json` sets `outDir: "dist"` and `declaration: true`, and a `tools/dla/dist/` directory is present in the worktree (from a `tsc` build run). The directory is not in `.gitignore` (no `.gitignore` at `tools/dla/` and the root one does not cover it) so a future `npm run -w @studio/dla build` could commit emitted `.d.ts` files. `tools/common/` has the same shape, so this is a pre-existing pattern rather than a T1 regression — flagging only for awareness.

**Severity:** should-fix (pre-existing pattern; not blocking this PR)

## Implementer-flagged items — disposition

The prompt asked me to confirm a list of flagged items. Disposition:

1. **T3 `tsx` path bug** — Confirmed must-fix; root cause of Issue 1 above. End-to-end reproducer captured.
2. **T9 Playwright env-var inertness** — Confirmed: T9 ships the env var in `.buildkite/pipeline.yml`, `.buildkite/release-build-and-distribute.yml`, `.buildkite/release-pipelines/code-freeze.yml`, `.github/workflows/publish-npm-package.yml`, and `apps/cli/package.json`'s `install:bundle` script. Whether the env var actually saves the ~150 MB depends on whether the active `data-liberation` SHA's postinstall path reads it — that empirical check is out of scope here. The defensive ship-it is the right call and matches the planner direction. Not a must-fix.
3. **T3 deviations from sketch:** all sound.
   - Using pi-coding-agent `ToolDefinition` rather than pi-agent-core `AgentTool` is consistent with how `apps/cli/ai/runtimes/pi/index.ts` already feeds `customTools` (it converts its native `AgentTool` values to `ToolDefinition` via `toToolDefinition`). The bridge skips that conversion by emitting `ToolDefinition` directly — cleaner.
   - Test path `tools/dla/tests/` mirrors `tools/common/lib/tests/`. Fine.
   - `BridgeTransportProvider` injection is a small, well-documented extension over the spec; tests use it appropriately. It is also the reason the tsx-resolution bug evaded automated coverage — see Issue 1's recommendation to add a real-resolution test.
   - `degraded`/`degradationReason` are useful and consumed in `apps/cli/ai/runtimes/pi/index.ts:267-273` for a warning log.
4. **T6 remote-site branch comment** — Present at `apps/cli/ai/runtimes/pi/index.ts:494-497` (JSDoc on `buildAgentTools`). Clear.
5. **T5 frontmatter** — Confirmed: only `name` + `description`. The skill loader (`apps/cli/ai/skills.ts`) consumes those two fields; omitting `user-invocable`/`argument-hint`/`allowed-tools` is the right call since they are no-ops. Skill body wires `liberate_*` (bare names) and steers callers toward `delegate: true` for `liberate_import` — matches the bridge contract.
6. **`STUDIO_DLA_ENABLED` feature flag** — Confirmed both paths gate on it (`apps/cli/ai/runtimes/pi/index.ts:260` for bridge spawn, line 468 for policy factory). Both early-return when the flag is unset, and the runtime-policy and runtime-bridge tests exercise the unset / `=0` / `=1` cases for each. With the flag off, the runtime is structurally identical to pre-T6.

## Next steps if rejected

The fix is mechanical and small (one line in `tools/dla/bridge.ts`, plus a test that exercises real `require.resolve` for the two entry points). Once the bridge spawn works, re-run `STUDIO_DLA_ENABLED=1 studio code` and confirm `liberate_*` tools show up in the customTools list to satisfy T6's acceptance criterion. After that, this PR is in good shape and should approve cleanly.
