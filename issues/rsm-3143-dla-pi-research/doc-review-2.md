# Documentation Review 2

## Verdict: approved

## Summary

Re-review of the three must-fix issues from `doc-review-1.md` after the documentator's fix commit `892493c1`. The fix is exactly the right shape: three sentence-level edits across two files (`apps/cli/README.md` +1/-1, `docs/design-docs/cli.md` +2/-2), no prose drift, no scope creep into `apps/studio/`. All three issues are cleanly resolved and the PR description (committed at `8bd351e0`, untouched here) remains accurate against the current branch state.

## Verification of doc-review-1 must-fix issues

### Issue 1: T11 bridge-spawn tsx path — resolved

The "Bridge spawn" bullet in `docs/design-docs/cli.md` (line 82) now reads:

> Both the bridge (`tools/dla/bridge.ts`) and the standalone `studio migrate` path (`apps/cli/commands/migrate/resolvers.ts`) resolve it as `tsx/cli` — the canonical key in tsx's package `exports` map. The deep `tsx/dist/cli.mjs` subpath is intentionally not exposed by `exports` and throws `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime; the regression tests in `tools/dla/tests/bridge.test.ts` (the `defaultTransportProvider — real require.resolve paths` block) lock both invariants in so the bridge can never silently regress back to the deep subpath.

Cross-checked: `tools/dla/bridge.ts:269` and `apps/cli/commands/migrate/resolvers.ts:30` both call `require.resolve( 'tsx/cli' )`. The referenced test block exists at `tools/dla/tests/bridge.test.ts:235` (`describe( 'defaultTransportProvider — real require.resolve paths', () => { ... } )`). The "should be reconciled" TODO is gone, the `ERR_PACKAGE_PATH_NOT_EXPORTED` failure mode is named, and the regression test is pointed at — all three asks from the original review's "Notes for the next fix pass" are satisfied.

### Issue 2: T10 README Playwright timing — resolved

The trailing sentence in the Migrate section (line 122 of `apps/cli/README.md`) now reads:

> Installing the Studio CLI also downloads a Playwright Chromium build (~150 MB) used for the Wix and Squarespace adapters, so the initial `npm install -g wp-studio` pulls more than the base CLI does.

The "on demand" / "before the first extract starts" framing is gone. The cost is attributed to install time and the `npm install -g wp-studio` invocation is named explicitly, matching DLA's `postinstall: "playwright install chromium"` behaviour.

### Issue 3: T11 design-doc Playwright contradiction — resolved

The Playwright caveat section (line 132 of `docs/design-docs/cli.md`) now reads:

> End-users pay the ~150 MB download cost on `npm install -g wp-studio`, driven by DLA's `postinstall: "playwright install chromium"` hook.

The contradictory "Chromium auto-installs lazily on first use by the platform adapters that need it" sentence is gone. The remaining statement is internally consistent and matches DLA's actual postinstall behaviour. The rest of the caveat (about `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` being inert against modern Playwright, neither `playwright` nor `playwright-core` having a postinstall hook, DLA's own postinstall calling `installBrowsers()` directly) is preserved unchanged and remains correct.

## Drift check

`git diff 8bd351e0..892493c1 --stat` confirms the fix is scoped to exactly the two doc files with 3 insertions and 3 deletions. No surrounding prose was edited and no other files were touched. The PR description at `issues/rsm-3143-dla-pi-research/PR-description.md` remains accurate — no implementation has changed since the doc-review-1 commit, only the three sentence-level doc fixes addressed above.

## Issues

None.
