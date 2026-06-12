# Review 2

## Verdict: approved

## Summary

Re-review of commit `65ce8848` ("Fix tsx resolution in DLA bridge"), the must-fix from review-1. Scope is exactly the two files touched by that commit (`tools/dla/bridge.ts` and `tools/dla/tests/bridge.test.ts`); nothing else from T1–T9 moved. The fix is the expected one-liner — `require.resolve('tsx/cli')` instead of `require.resolve('tsx/dist/cli.mjs')` — and the comment block around it now correctly explains why the deep `dist/` subpath fails (no exports key). The new test coverage is solid: three tests in a new `defaultTransportProvider — real require.resolve paths` block exercise the production code path (not the injected `BridgeTransportProvider` stub), including a regression guard that fires if upstream `tsx` ever re-exposes the deep subpath. I confirmed the suite actually catches the bug by temporarily reverting the one-line fix and re-running the bridge tests — the e2e `connect()` test fails fast with the expected `ERR_PACKAGE_PATH_NOT_EXPORTED` assertion. With the fix restored, all gates pass.

## Checks

| Check          | Command                                                       | Result                                |
| -------------- | ------------------------------------------------------------- | ------------------------------------- |
| DLA tests      | `npx vitest run tools/dla/`                                   | 4 files / 45 tests passed             |
| Bridge tests   | `npx vitest run tools/dla/tests/bridge.test.ts --reporter verbose` | 14 tests passed (3 new in real-resolve block) |
| CLI tests      | `npx vitest run --project cli`                                | 61 files / 632 tests passed           |
| Type check     | `npm run typecheck`                                           | All workspaces pass (incl. `@studio/dla`) |
| Lint           | `npx eslint tools/dla/bridge.ts tools/dla/tests/bridge.test.ts` | 0 errors                            |
| CLI build      | `npm run cli:build`                                           | Vite emits all bundles                |
| Scope          | `git diff --stat 43a7d920..65ce8848 -- tools/`                | Only `bridge.ts` (+8/-2) and `bridge.test.ts` (+96/-1) |
| Regression catch | Revert one-line fix locally, re-run `tools/dla/tests/bridge.test.ts` | e2e `connect()` test fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` — fix restored |

## CLI Verification

Evidence saved to `issues/rsm-3143-dla-pi-research/verification/`:

### Command Runs

| Command invoked                                                                          | Expected                                                       | Observed                                                                                              | Pass? |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| `STUDIO_DLA_ENABLED=1 node apps/cli/dist/cli/main.mjs code --help`                       | Prints usage; exit 0                                           | Usage printed; exit 0                                                                                 | yes   |
| `require.resolve('tsx/cli')` anchored to built `apps/cli/dist/cli/main.mjs`              | Resolves to `node_modules/tsx/dist/cli.mjs`                    | Resolved to `…/node_modules/tsx/dist/cli.mjs`                                                         | yes   |
| `require.resolve('data-liberation/src/mcp-server.ts')` anchored to the built CLI         | Resolves to the DLA `mcp-server.ts`                            | Resolved to `…/node_modules/data-liberation/src/mcp-server.ts`                                        | yes   |
| Real-bridge e2e test (`defaultTransportProvider.connect()`) with fix applied              | Connects, no `ERR_PACKAGE_PATH_NOT_EXPORTED`                   | Connects in ~350 ms, no resolution error                                                              | yes   |
| Same e2e test with fix reverted (`tsx/dist/cli.mjs`)                                      | Fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`                     | Fails: `expected 'ERR_PACKAGE_PATH_NOT_EXPORTED' not to be 'ERR_PACKAGE_PATH_NOT_EXPORTED'`           | yes (test catches the bug) |

### Output Evidence

| Run                                              | Evidence file                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `STUDIO_DLA_ENABLED=1 studio code --help` stdout | `verification/review-2-code-help-stdout.txt`                           |
| Same run, stderr                                 | `verification/review-2-code-help-stderr.txt`                           |
| Built-CLI `require.resolve` probe                | `verification/review-2-resolution-check.txt`                           |

## Issues

None. Both review-1 must-fix items are resolved:

1. The one-line spelling change (`tsx/cli`) is in place at `tools/dla/bridge.ts:269`, and the surrounding JSDoc now documents why the deep `dist/` subpath cannot be used — future maintainers won't be tempted to revert.
2. The new tests in `tools/dla/tests/bridge.test.ts` cover the production resolution path that the previous mock-injected coverage missed: (a) positive resolution of `tsx/cli` and `data-liberation/src/mcp-server.ts` through the bridge's own `createRequire` anchor; (b) a regression guard asserting `tsx/dist/cli.mjs` is not exported; (c) an end-to-end check that `defaultTransportProvider.connect()` does not throw a path-resolution error, with the only acceptable failure mode being non-resolution errors (DLA missing creds, etc.). Test (c) is the one that actually catches the regression — verified empirically by reverting and re-running.

Other items from review-1 (Issue 2 about `tools/dla/dist/` `outDir` collision) remain unchanged and were correctly flagged as informational only.
