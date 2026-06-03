# WordPress Site Generator — Evolution Plan + Eval Harness (Slice A)

> Status: approved (decomposition + Slice A). Slices B–G are scoped here at the
> "system" level; each gets its own detailed spec/plan when it is built.
>
> Companion docs: `~/Sites/wordpress-site-generator-plan.md` (original plan),
> `~/Sites/telex-cli-extraction-analysis.md` (Telex extraction analysis). The
> feature being evolved landed in commit `ab860c8c` on `feat/wordpress-site-generator`.

## Context

`ab860c8c` added an end-to-end WordPress site generator to the `studio ai` /
`studio code` agent: five generation tools (`generate_design_previews`,
`generate_theme`, `generate_companion_plugin`, `seed_content`, `generate_image`)
plus knowledge skills and generator prompt fragments, orchestrated by the
`site-generator` skill. Output is a pure-presentation block theme + a companion
plugin (behaviour) + content seeded into the live DB.

It works, but is "not great yet." Six fronts were raised; a parallel
evidence-based investigation (Studio output vs the Telex reference, both on
disk) grounded each one. The findings reframed two of them materially.

## Goals and findings (the six fronts)

1. **Custom blocks are under-produced** (reframed). *Core* block composition is
   already good — recent Studio output (`laptaria`, `boogie-bar`, `heysaymay`,
   Jun 2) has 0 `wp:html` section dumps and 25–63 composed core blocks/page,
   matching Telex; the "no blocks" sites the user saw (`the-daily-hygge`,
   `maison-clouet`, `elara-voss`) all predate the feature. The real gap is
   **companion-plugin custom blocks**: Telex reliably generates at least one
   (e.g. a contact form), driven by two triggers — (a) explicit user request
   (e.g. "a slideshow on the homepage"), and (b) any CPT in the content model
   that takes user input (contact, bookings, submissions). Studio's manifest /
   content-model planning does not reliably propose these. → **Slice D**.
2. **JSX/React block authoring.** Studio is developer-centric; users expect
   React/JSX, not build-less vanilla JS. Telex already authors editor code as
   JSX/React compiled by `wp-scripts build` (only front-end `view.js` stays
   plain JS) — so this is parity, not new territory. Feasible via in-process
   `esbuild` (already a dependency; standalone Node ships with Studio; WP
   packages externalize to `wp.*` globals). Developers must be able to
   hand-edit generated `src/` and recompile. → **Slice E**.
3. **Telex Imagen endpoint.** Telex generates imagery with Google Imagen 4 via
   the WPCom proxy using a static Automattic `a8c-vrtx-` credential + slug
   `telex-theme-image` — which is exactly why it 403s for per-user Studio
   tokens. We cannot distribute that credential inside Studio, so the credential
   stays server-side: a new Telex `POST /api/v1/images/generate` endpoint
   authenticates the Studio user via their wp.com bearer (existing
   `BearerAuthMiddleware`) but calls Imagen with Telex's credential. → **Slice F**
   (separate repo, parallel track).
4. **Speed (20 min vs 3–5 min)** is orchestration topology, not model speed
   (Studio already uses Sonnet 4.6, faster than Telex's Opus 4.6). Causes: five
   tools run strictly sequentially with an agent turn between each; internal
   pools capped at 4/5/3; `generate_image` is fully serial; `seed_content` does
   ~60–90 serial WP-CLI round-trips over the PHP-WASM daemon IPC bus. → **Slices
   B, C, G**.
5. **Loops to test ideas.** An eval harness exists (`eval/` PromptFoo +
   `eval-runner.ts`) but it drives the *agent* (non-deterministic). What's
   missing is a deterministic, agent-free harness that calls the tool
   `rawHandler`s directly. → **Slice A (build first)**.
6. **Split into individually shippable pieces.** This decomposition is the
   answer; see below.

## Decomposition into shippable slices

| Slice | What ships | Depends on | Track |
|---|---|---|---|
| **A — Eval harness** | Deterministic agent-free generation loop + scorecard (timing, core- and custom-block metrics, validation, screenshots). Touches no production code. | — | now |
| **B — Speed: concurrency + parallel images** | Raise `runPooled` caps 4/5/3→8; pool the serial image loops. | A (to measure) | Studio |
| **C — Single-pass DB seeding** | Replace per-item WP-CLI loop with one `wp eval-file` PHP pass. | A | Studio |
| **D — Custom-block fidelity** | Manifest reliably plans custom blocks from the content model (input-CPTs → form/submission blocks) + explicit user features; companion plugin generates them. | A | Studio |
| **E — JSX/React authoring** | In-process esbuild compile; hand-editable `src/` + a recompile (`rebuild_block`) affordance. | A; composes with D | Studio |
| **F — Telex Imagen endpoint** | `POST /api/v1/images/generate` + `Api\V1\ImageController` (reuses bearer auth + `AiClientFactory`), then a config-gated `wpcom-image.ts` switch. | — | Telex worktree (parallel) |
| **G — Single-pool orchestration (endgame)** | Collapse theme+plugin+seed content-generation into one flat `runPooled` request set; defer writes. | B, C | Studio |

Notes:
- **D + E together deliver "great custom blocks": D decides *when/what*, E decides *how*.**
- The `wp:html` enforcement gate (auto-run the existing `validateHtmlBlockPolicy`
  inside `generate_theme`/`seed_content`) is a small optional hardening folded
  into D, not a headline — core-block quality is already good but nothing
  *enforces* it, so a regression would ship silently.
- **Shipping/branching:** the harness imports the generation tools added in
  `ab860c8c`, so it is not independently landable on `trunk` ahead of the
  feature. Work continues on `feat/wordpress-site-generator` with each slice as
  a clean, separable commit so PRs can be split when the feature lands. Slice F
  lives entirely in the Telex repo and is independently shippable there.

## Slice A — Generation eval harness (detailed design)

### Why first
It is the keystone: it lets an engineer (human or agent) run the full
generation pipeline on a fixed spec without driving the interactive agent by
hand, and produces a quality + timing scorecard. It (a) measures every other
slice's before/after, and (b) turns the reframed #1 (custom blocks) from
anecdote into a tracked metric *before* any generator change.

### Location & build wiring (as built)
The vite build resolves entries against `apps/cli` and the `cli` alias, and the
Vitest setup discovers tests under `apps/cli/ai/`, so the code lives there while
the data/results live at the repo root:
- `apps/cli/ai/eval-wsg/run.ts` — entry (arg parsing, preflight, loop, output);
  added as the `eval-wsg` input in `apps/cli/vite.config.dev.ts`, emitting
  `apps/cli/dist/cli/eval-wsg.mjs`.
- `apps/cli/ai/eval-wsg/pipeline.ts` — impure orchestration (calls the tool
  `rawHandler`s + `runManifest`).
- `apps/cli/ai/eval-wsg/scorecard.ts` — pure analysis (block counting,
  validation/screenshot parsing, custom-block analysis, expectations, summary).
- `apps/cli/ai/eval-wsg/specs.ts` — spec type + loader/validator.
- `apps/cli/ai/eval-wsg/safety.ts` — the `wsg-eval-` guarded-delete predicate.
- `apps/cli/ai/tests/eval-wsg.test.ts` — Vitest unit tests for the pure helpers.
- `eval/wsg/specs/*.json` — the seed spec matrix (repo root).
- `eval/wsg/results/<runId>/` — per-case + `summary.json` scorecards + screenshots.
- `package.json` script `eval:wsg`: `cli:build` then run the compiled entry.

Flags: `--dry-run` (validate specs + print plan, no tools/login), `--no-images`
(fast/cheap loops), `--keep-site` (debug), `--specs-dir` / `--out-dir`, and
positional `caseId`s to run a subset.

### Spec format (`eval/wsg/specs/*.json`)
```json
{
  "caseId": "restaurant-reservations",
  "spec": {
    "name": "Ember & Oak",
    "type": "restaurant",
    "audience": "local diners",
    "tone": "warm, refined",
    "topic": "a wood-fired neighbourhood restaurant in Lisbon",
    "layoutPreference": "landing-page",
    "pages": ["Home", "Menu", "About", "Reservations", "Contact"],
    "features": ["reservation form"]
  },
  "expects": {
    "needsCompanionPlugin": true,
    "minPages": 4,
    "minCustomBlocks": 1,
    "inputCptsNeedBlock": true
  }
}
```
Seed matrix chosen to exercise custom blocks: a brochure (expects none), a
restaurant with reservations, a shop with products + contact, a portfolio with
an explicit slideshow request.

### Pipeline sequence (agent-free; calls tool `rawHandler`s directly)
For each spec, with per-stage `Date.now()` timing:
1. Create a throwaway site named `wsg-eval-<caseId>-<runId>` (`createSiteTool`,
   creates + starts).
2. `runManifest(JSON.stringify(spec))` → manifest object.
3. `generateDesignPreviewsTool` → take `design/design-1.html` as the chosen design.
4. `generateThemeTool` with `{ nameOrPath, spec, design, manifest }`.
5. `generateCompanionPluginTool`, `seedContentTool`, `generateImageTool` with the
   same manifest.
6. `validateAndFixBlocksTool` over each generated `parts/*.html`,
   `templates/*.html`, and seeded `wp-content/uploads/wsg-seed/*.html`; parse the
   `N/M blocks valid` result.
7. `takeScreenshotTool` `{ url, viewport: "all" }`; persist the PNG paths.
8. Guarded delete of the throwaway site.

Each stage is wrapped so a failure is recorded and the run continues to
teardown (no orphaned eval sites).

### Scorecard (`eval/wsg/results/<runId>/<caseId>.json` + `summary.json`)
```json
{
  "caseId": "restaurant-reservations",
  "ok": true,
  "stageTimingsMs": { "createSite": 0, "manifest": 0, "designPreviews": 0,
                       "theme": 0, "companionPlugin": 0, "seed": 0,
                       "images": 0, "validate": 0, "screenshot": 0 },
  "coreBlocks": { "byFile": { "templates/index.html": 42 }, "wpHtmlViolations": 0 },
  "customBlocks": {
    "planned": ["reservation-form"],
    "generated": ["reservation-form"],
    "inputCptsWithoutBlock": [],
    "compiles": true,
    "validates": true
  },
  "validation": { "byFile": { "templates/index.html": { "valid": 42, "total": 42 } } },
  "screenshots": ["results/<runId>/restaurant-reservations-desktop.png"],
  "errors": []
}
```
`customBlocks` is the instrumentation for the reframed #1: planned (from
`manifest.companionPlugin.blocks`) vs generated (block dirs on disk), whether
every input-CPT got a block, and whether blocks compile/validate. `summary.json`
aggregates pass/fail and per-stage timing across the matrix. An optional LLM
aesthetic score can reuse the existing `eval/grader-provider.mjs`.

### Reuse (do not rebuild)
Auth (`generation/llm.ts` / `auth.ts`), daemon (`generation/site-wp.ts`),
WP-CLI, manifest chaining (`generation/generators.ts` `runManifest`), block
validation (`validate-and-fix-blocks`), screenshots (`take-screenshot`), and the
PNG-byte / `N/M valid` parsing already proven in `eval/promptfoo.config.yaml`.

### Safety
- Site deletion is guarded by a predicate that **only** deletes sites whose name
  starts with `wsg-eval-`; anything else is refused (unit-tested). The harness
  never touches a non-eval site.
- The harness is opt-in (`npm run eval:wsg`), never wired into CI without an
  explicit gate, and creates/destroys only its own sites.

### Runtime prerequisites
`npm run cli:build`; logged into WordPress.com (`studio auth login`) or
`STUDIO_WPCOM_TOKEN` set (generation + imagery route through the WPCom AI proxy).

### Out of scope for Slice A
Any change to a generator, tool, or prompt; CI integration; the LLM aesthetic
grader (optional follow-up). Slice A only *observes*.

## Acceptance criteria (Slice A)
- `npm run eval:wsg` runs the full pipeline on the seed matrix against
  throwaway sites and writes per-case + summary scorecards.
- The scorecard reports per-stage timing, core-block counts (+ `wp:html`
  violations), custom-block planned-vs-generated (+ input-CPT coverage +
  compile/validate), validation pass-rates, and screenshot paths.
- Pure helpers (scorecard math, block counting, spec parsing, guarded-delete
  predicate) have passing Vitest unit tests.
- A failed stage is recorded and the throwaway site is still torn down; no
  orphaned `wsg-eval-*` sites remain.
- No production code path is modified; `typecheck` and `eslint` pass.

## Resolved decisions
- Build order: **eval harness first**.
- JSX strategy: **uniform JSX + in-process esbuild** (one contract), with
  hand-editable `src/` + recompile (deferred to Slice E).
- Telex images: **Option A** — Telex endpoint, separate worktree, parallel track.
- Blocks #1: **re-scoped to custom-block fidelity**; instrumented by Slice A,
  fixed in Slice D, authoring upgraded in Slice E.

## Open questions (deferred to their slices)
- D: exact rule set for deriving custom blocks from the content model (mirror
  Telex's `data-persistence` logic) — investigate when D starts.
- E: the recompile affordance shape (`rebuild_block` tool vs a per-block
  `package.json` build script) — decide when E starts.
- F: per-user rate-limiting policy on the Telex endpoint.
