# Documentation Review 1

## Verdict: rejected

## Summary

Both doc commits are well-written and well-scoped: T10 (`apps/cli/README.md`) lands a clean user-facing "Migrate from a closed platform" section in the right place in the ToC, and T11 (`docs/design-docs/cli.md`) lands a thorough "Data Liberation Agent integration" architecture section that covers topology, bridge spawn, tool wrapping, two-layer permission policy, feature-flag gating, bare-name tool surface, `delegate: true` handoff, both user surfaces, and the orphan-work + Playwright caveats. Voice, structure, and CLI/App scope separation are all sound — neither doc reaches into `apps/studio/` territory and the cross-link between the two docs is correct ("for the user-facing surface, see `apps/cli/README.md`").

The rejection is for two factual inaccuracies. The first is a hard miss in T11's "Bridge spawn" section: the design doc says the bridge resolves `tsx/dist/cli.mjs`, but T11 was committed at 01:06:09, **before** the post-review-1 fix at 01:18:41 (commit `65ce8848`) changed the resolution to `tsx/cli`. The current code uses `tsx/cli`, so the design doc is now stale and contradicts the implementation it claims to document — including a paragraph that explicitly suggests "reconciling" to `tsx/cli` as a future TODO, when in fact the reconciliation has already happened. The second is in T10: the README tells users the Playwright Chromium download is "on demand … before the first extract starts", but DLA's `package.json` has `"postinstall": "playwright install chromium"`, which runs at `npm install -g wp-studio` time, not on first migration. (The design doc itself gets this partially right on one line and wrong on another — see Issue 3 for that internal contradiction.)

Both fixes are small and bounded — a paragraph rewrite for Issue 1, a one-sentence rewrite for Issue 2, and a one-sentence reconciliation for Issue 3.

## Issues

### Issue 1: T11 documents the pre-fix tsx resolution path that no longer exists

**What's wrong:** The "Bridge spawn" section in `docs/design-docs/cli.md` says:

> `tsx` is loaded as the loader entry. The bridge resolves it as `tsx/dist/cli.mjs` via `createRequire(import.meta.url).resolve('tsx/dist/cli.mjs')`. The standalone `studio migrate` path in `apps/cli/commands/migrate/resolvers.ts` resolves the same binary via `tsx/cli` instead — the public exports key. Both paths land on the same file; the bridge's spelling depends on hoisting layout while `tsx/cli` is the canonical subpath. This discrepancy is harmless today but should be reconciled (prefer `tsx/cli`).

The actual code at `tools/dla/bridge.ts:269` (post-fix commit `65ce8848`) reads `require.resolve('tsx/cli')`, identical to `apps/cli/commands/migrate/resolvers.ts:30`. There is no longer a discrepancy. The design doc was written before the fix landed (T11 committed at 01:06:09; fix at 01:18:41) and was never updated.

Worse, the doc is actively misleading: it tells future maintainers the bridge "should be reconciled (prefer `tsx/cli`)" when the reconciliation is already in the tree. It also misstates that `tsx/dist/cli.mjs` is "harmless" — code-review-1 demonstrated it throws `ERR_PACKAGE_PATH_NOT_EXPORTED` against `tsx@4.21.0`, and that bug was the entire reason for the fix commit and the new regression tests in `tools/dla/tests/bridge.test.ts`.

**Where:** `docs/design-docs/cli.md`, "Data Liberation Agent integration" → "Bridge spawn" section, second bullet (currently lines 81–82).

**Expected:** Replace the bullet with something like:

> `tsx` is loaded as the loader entry. Both the bridge (`tools/dla/bridge.ts`) and the standalone `studio migrate` path (`apps/cli/commands/migrate/resolvers.ts`) resolve it as `tsx/cli` — the public `exports` key. The deep `tsx/dist/cli.mjs` subpath is intentionally not exposed by `tsx`'s `exports` map and throws `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime; see the regression tests in `tools/dla/tests/bridge.test.ts` that guard against re-introducing the deep subpath.

A short pointer to the resolution-bug history (or the fix commit) is optional but useful for future maintainers.

**Severity:** must-fix

### Issue 2: T10 misrepresents when the Playwright Chromium download happens

**What's wrong:** The README says:

> The first migration on a machine also downloads a Playwright Chromium build on demand (~150 MB), so expect a one-time delay before the first extract starts.

But `node_modules/data-liberation/package.json` has `"postinstall": "playwright install chromium"` — the Chromium download fires at `npm install -g wp-studio` time, not lazily on first migration. End-users who install via `npm install -g wp-studio` will see the ~150 MB delay during install, not during their first `studio migrate` run.

This matters because the README is the place where a new user decides whether to install Studio CLI. Telling them "expect a one-time delay before the first extract starts" both understates the install-time footprint (which they pay even if they never run `/migrate`) and overstates the first-run delay (which won't actually happen).

**Where:** `apps/cli/README.md`, "Migrate from a closed platform" section, final paragraph (currently around line 122).

**Expected:** Replace the trailing sentence with something like:

> Installing the Studio CLI also downloads a Playwright Chromium build (~150 MB) used for the Wix and Squarespace adapters, so the first install pulls more than the base CLI does.

If the team prefers to keep the user-facing surface very compact, even a shorter "Installing the CLI pulls a ~150 MB Playwright Chromium binary used for Wix and Squarespace extraction" is fine.

**Severity:** must-fix

### Issue 3: T11 internally contradicts itself on when Chromium downloads

**What's wrong:** The design doc's "Caveat: Playwright Chromium postinstall" section says both:

> End-users pay the ~150 MB download cost on `npm install -g wp-studio`

and immediately after:

> Chromium auto-installs lazily on first use by the platform adapters that need it.

The first sentence is correct against `data-liberation/package.json`'s `postinstall: "playwright install chromium"`. The second sentence describes a different (lazy-install) flow that does not match what DLA actually does. Pick one; they cannot both be true for the same install.

Concretely: the postinstall hook fires at `npm install` time and runs `playwright install chromium`, which downloads the Chromium build into Playwright's user cache. There is no separate lazy-install path on first use unless the postinstall failed or was skipped.

**Where:** `docs/design-docs/cli.md`, "Data Liberation Agent integration" → "Caveat: Playwright Chromium postinstall" (currently around lines 130–132).

**Expected:** Drop the "auto-installs lazily on first use" sentence (or rewrite it to clarify it only applies as a fallback when the postinstall is skipped). The rest of the caveat — `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` being inert against modern Playwright because neither `playwright` nor `playwright-core` has a postinstall hook that consults it, and DLA's own `playwright install chromium` postinstall doing the actual download unconditionally — is correct and lands well.

**Severity:** must-fix

## Items that are fine

For the record, I cross-checked these claims against the as-built code and they match:

- T11 topology section: `tools/dla/` layout (`bridge.ts`, `agent-tool-adapter.ts`, `policy.ts`, plus `content-adapter.ts` and `index.ts`), `@studio/dla` workspace package name, dep pin `github:Automattic/data-liberation-agent#<sha>` in `apps/cli/package.json`. All correct.
- T11 env passthrough list: `LIBERATION_TOKEN`, `SHOPIFY_ADMIN_TOKEN`, `NODE_PATH`, `NODE_OPTIONS`, plus `STUDIO_WPCOM_TOKEN` injected from session config. Matches `tools/dla/bridge.ts` `PASSTHROUGH_ENV_KEYS`.
- T11 listTools timeout (10s), SIGKILL grace period (2s), degraded-bridge fallback. All match `bridge.ts`.
- T11 `inputSchema as unknown as TSchema` cast claim and the inverse-shim reference to `apps/cli/ai/mcp-server.ts`. Correct.
- T11 two-layer policy (`shouldBlock` in the adapter wrapper; `pi.on('tool_call', ...)` in the extension factory). Matches `policy.ts`.
- T11 feature-flag gating (`maybeStartDlaBridge` + `resolveDlaExtensionFactories` both early-return on unset `STUDIO_DLA_ENABLED`). Matches `apps/cli/ai/runtimes/pi/index.ts:260` and `:468`.
- T11 bare tool names (no `mcp__data-liberation__` prefix) and the skill body cross-reference. Matches `apps/cli/ai/skills/migrate/SKILL.md`.
- T11 `delegate: true` manifest fields (`wxrFile`, `outputDir`, `mediaDir`, `productsCsv?`, `redirectMap`, `importAuthors`). Matches the skill body's Step 8.
- T11 orphan-work caveat. Sourced from research-report.md and reads cleanly.
- T11 standalone-CLI characterisation (yargs wrapper, inherits stdio, prunes `STUDIO_WPCOM_TOKEN`). Matches `apps/cli/commands/migrate/index.ts` and `resolvers.ts`.
- T10 user-facing voice, ToC placement, eight platforms listed, both invocation modes covered, `LIBERATION_TOKEN` / `SHOPIFY_ADMIN_TOKEN` notes. All correct.
- T10 / T11 CLI/App scope separation. Neither doc reaches into `apps/studio/`.

## Notes for the next fix pass

- T11 is the design-doc owner of the bridge contract — please make sure the corrected bullet **explains why** `tsx/cli` is the canonical spelling and **points at the regression test** that guards against the deep subpath, so a future maintainer doesn't repeat the bug.
- T10 should stay user-facing — keep the new paragraph short, no architecture detail.
- No other commits since the last code-review (review-2 approved at `a835eb03`) affect documentation; this review covers all in-scope doc surface.
