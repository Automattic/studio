# Slice G — Single-Pool Orchestration (merge plan)

> Grounded by a parallel read of the three generation tools (`generate-theme.ts`,
> `generate-companion-plugin.ts`, `seed-content.ts`) + all collaborators. Every
> claim cites a function + line. This is the implementation plan; execute against it.

## Goal
The agent calls `generate_theme` → `generate_companion_plugin` → `seed_content`
sequentially, each running its own bounded LLM pool then writing, with agent
turns + idle between. Each phase's wall-clock is gated by its **single longest
call** (style.css ~14k tokens; main plugin PHP ~12k). Slice G merges the
GENERATION of all three into ONE flat pool (concurrency 8), deferring ALL
disk/DB writes to the end, so the long-poles overlap the many cheap
page/block/CPT calls instead of stacking. Expected win materially larger than
Slice B's caps (which couldn't beat the longest single call).

## Shared modules (extract; the 3 tools import their pieces back — no duplication)
- **`theme-build.ts`** ← from `generate-theme.ts`: `normalizeSpecJson` (collapse the 3 copies), `renderFunctionsPhp` (:27), `renderStyleHeader` (:53), `ensureStyleHeader` (:73), `activateTheme` (:86); **new** `buildThemeTasks(manifest, ctx)` (from the inline `planned` literal :140-197) and `writeThemeFiles(dir, results, contract)` (from :205-216).
- **`plugin-build.ts`** ← from `generate-companion-plugin.ts`: `ensurePluginHeader` (:45), `activatePlugin` (:57); **new** `buildMainPhpTask` (:114), `buildBlockTask` (:135), `writeBlockResult(dir, block, files, contract)` (the reconcile→write src/→compileBlock loop :155-181).
- **`seed-build.ts`** ← from `seed-content.ts`: `collectPageTargets` (:51), `runCptEntries` (:101), `getAbspath` (:157), `wpcomImagesAvailable` (:141), `PreparedItem`; **new** `makeImageFinalizer(...)` (factory of the inline `finalizeImages` :204-225) and `seedPreparedItems(site, prepared, contentMode)` (the Phase-2 `withDaemon` block :347-401).

## Flat task list (one runPooled, concurrency 8)
Manifest + contract + vocabulary derived ONCE first (manifest can NOT join the pool — it gates everything). Discriminated-union results routed by `kind`:
`theme-file` | `plugin-main` | `plugin-block` | `page` | `cpt`. Each task keeps its own try/catch (per-task failure isolation; the long-pole singletons style.css/main-PHP must ALSO be guarded — `runPooled` has no internal catch, an unguarded throw rejects the whole pool).

## Deferred write sequence (strict order, after the pool resolves)
1. Write theme files (`.html` → `reconcileMarkup` first), then `functions.php`.
2. Write plugin main PHP (`ensurePluginHeader`).
3. Write + compile each block (`reconcileBlockJsonName` → write `src/` → `compileBlock` → `build/`).
4. Activate theme (after 1).
5. Activate plugin (after 2–3; main PHP registers from `build/`).
6. Seed content — one `wp eval-file` pass (after 4–5; upserts CPTs + references blocks that exist only once the plugin is active).
7. Combined summary + `JSON.stringify(manifest)` verbatim.

**Image exception:** `finalizeImages` writes PNGs + rewrites the HTML `src` atomically *during* generation (Phase 1); keep that paired (do NOT buffer bytes for step 6). The pool fully resolves before step 6, so the PNG exists before the seeder reads the HTML. Needs the resolved `siteUrl` (from CLI config, not the running site).

## New tool + skill
`generate_site` tool (`tools/generate-site.ts`): mirrors `generate_theme`'s args (`nameOrPath`, `spec`, `design?`, `manifest?`, `withImages?`), delegates to `orchestrate.ts` `generateSite(...)`, returns the MANIFEST block verbatim. Register after `generateThemeTool` in `tools/index.ts`. SKILL.md collapses steps 4–6 into one "Generate the whole site" step; old 7→5, 8→6. The 3 tools stay registered/functional (additive).

## Risks
1. `siteUrl` needed at gen time — resolve once up front (CLI config, stable).
2. CPT content generated before plugin keys registered — safe: keys are deterministic from the manifest; the DB upsert still runs after plugin activation.
3. Per-task failure isolation — carry over existing try/catch; **add guards to the style.css + main-PHP singletons**.
4. Brochure sites (no plugin) / empty-content sites — conditionally omit plugin + CPT tasks; still write+activate theme.
5. Activation when site stopped — theme/plugin degrade to "written, not activated"; seed throws (idempotent re-run).
6. Proxy concurrency — keep pool at 8; rely on `withTransientRetry`.
7. Daemon cycles — optionally wrap activate-theme + activate-plugin + seed in one `withDaemon`.

## Verification
Timing: instrument task start/end; assert style.css + main-PHP intervals OVERLAP page/CPT/block intervals; total < sum of the 3 legacy phases. Correctness (the gate): `idViolations 0`, `cptUnreg 0`, blocks compile + render, menu populates + front page set, theme+plugin active, and (spies) NO write/compile/wpCli before the pool resolves + activate-theme < activate-plugin < seed.

## TDD-able pure units (test first)
`buildThemeTasks` (count/order/maxTokens/temp), the result router (`GenResult[]` → grouped), `collectPageTargets`, the `prepared → seedItems` mapping, `makeImageFinalizer` (injected generate/persist).
