---
name: replicate-with-blocks
description: Spec-driven, whole-site block-theme reconstruction for a liberated site. Invokes design-foundations → creating-themes → clustering → spec extraction → generating-patterns (fan-out, per cluster) → assemble → validate → install → design-qa to produce a responsive, editable WordPress block theme that matches the source site's layout, content structure, and visual design. Call after `liberate` (extraction) and before content import, or re-run standalone to re-theme an already-extracted site. Use when the user says "rebuild this site," "replicate the design," "make a theme that matches," "recreate the layout," or asks for a WordPress version of a liberated site.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
disable-model-invocation: true
---

# Replicate

You are a **design sub-orchestrator**. You drive the spec-driven whole-site block-reconstruction flow, delegating judgment to the composable skills below and determinism to MCP tools, then assembling and validating what they return. The `/liberate` root orchestrator calls you inline; you are also independently invocable to re-theme an already-extracted site.

> **Entry contract.** Dispatched by `/liberate` after extraction — the `siteDir` from `liberate_paths` is the resolved `<outputDir>`. **Assume it already holds the capture** (`output.wxr`, `html/*.html`, `screenshots/manifest.json`, media). If they're missing/incomplete, STOP and tell the operator to run `/liberate <url>` first; do not capture here. (Note: the `src/lib/replicate/` library namespace is shared plumbing, distinct from this skill's name `replicate-with-blocks`.)

The acceptance bar is source parity, not a pleasant approximation:

- Preserve observed section order, header/footer structure, navigation labels, CTA placement, media placement/aspect ratios, column counts, alignment, spacing rhythm, and responsive stacking.
- Use source text and uploaded media only. Do not invent copy, placeholder cards, stock-like sections, or generic marketing layouts.
- Templates render imported post/product content through proper WP template hierarchy; patterns and layout skeletons are for pages. Do not reconstruct posts or products section-by-section — that is handled by templates + Query Loop + WooCommerce.
- Do not hand-author Custom HTML blocks (`core/html` / `wp:html`) for layout or styling. Use core blocks first; embed a custom block inside the theme (`blocks/<slug>/`) only when a source component cannot be expressed any other way (see anti-patterns). **One sanctioned exception:** the deterministic per-section *coverage-gated verbatim fallback* (`src/lib/replicate/html-fallback.ts`) emits a section's sanitized source HTML as a `core/html` island when the structured render would otherwise DROP content — see "core/html fallback" below. You never author these by hand; `reconstructPagePattern` emits them automatically when a render is badly lossy.
- The old 27-pattern library is now seed material in the `section-mapping` catalog — it is not the primary mechanism. Builders pick block templates from the catalog; they do not pick-tweak from the 27-pattern library.

## Prerequisites

Confirm these exist in `<outputDir>/` (the resolved site dir from `liberate_paths` / provided `siteDir`) before starting:

- `design-foundation.json` — produced by `design-foundations`. **Required.** If missing, stop and tell the caller to run `design-foundations` first.
- `design.md` — frozen brief from `design-foundations`. Required (written in the same step).
- `html/*.html` — rendered HTML per page from the capture stage. If missing, stop: the screenshot/HTML capture stage was skipped. Re-run extraction with screenshots enabled.
- `screenshots/desktop/*.png` + `screenshots/mobile/*.png` — for verification and QA.
- `screenshots/manifest.json` — URL → file map.
- `output.wxr` — and optionally `products.jsonl` / `products.csv` for Woo sites.

`palette.json`, `typography.json`, and `breakpoints.json` (from screenshot aggregation) are consumed by `design-foundations` and baked into `design-foundation.json`; you do not read them directly.

## MCP tools you call

Use these tools rather than reimplementing their logic in Bash. Each has a typed I/O schema in the codebase.

| Tool | What it does |
|---|---|
| `liberate_section_extract({ url\|html, mediaMap, detail })` | `detail:"signature"` → ordered section-type sequence + structural attrs (all pages, off saved `html/<slug>.html`); `detail:"full"` → `specs/<rep>/section-<n>-<type>.md` (computed styles, interaction model, uploaded WP media URLs, brightness, motion — reps only) |
| `liberate_cluster_pages({ outputDir, signatures })` | Groups pages by exact layout signature → `cluster-map.json` (cluster per unique signature, representative = richest HTML) |
| `liberate_reconstruct_pages({ outputDir, studioSitePath, themeSlug, pages })` | **PRIMARY page path.** Reconstructs EVERY content page from its OWN captured section specs (no shared cluster skeleton): per page → capture specs, download+install its media, reconstruct gated block markup, install `patterns/page-<slug>.php` + `templates/page-<slug>.html` (+ `front-page.html` for home), force a pattern re-scan. Replaces cluster-rep-only reconstruction + carried-HTML fallback |
| `liberate_compose_instantiate({ outputDir, skeleton, pageContent, mediaMap })` | LEGACY (superseded by `liberate_reconstruct_pages` for pages). Deterministic slot-fill: cluster layout skeleton + this page's content → `post_content` block markup; returns `{ postContent, misfit }` |
| `liberate_validate_artifacts({ patterns: ArtifactPattern[] })` | Security + quality trust boundary. Asserts: escaping (`esc_html`/`esc_attr`/`esc_url`), no raw `<?php`/`<script>`/`on*=`, emitted text ⊆ spec captured text (provenance), no remote CDN URLs, no `{{placeholder}}` text, block-comment-only markup. **Takes `patterns`, not `outputDir`.** NOTE: `liberate_reconstruct_pages` already runs this gate per-page against each page's OWN spec corpus and refuses to install a failing page — that internal gate is AUTHORITATIVE. `scripts/_validate.ts <outputDir>` is a convenience sweep over the on-disk `theme/patterns/*.php`, but its provenance corpus is APPROXIMATE (sourced from `html/<slug>.html`), so it can emit provenance FALSE-POSITIVES (e.g. text the renderer concatenated across source elements). Treat its provenance flags as "verify against the source," not as gate failures; security/injection/drift checks are exact. |
| `liberate_install_theme({ outputDir, studioSitePath, themeFiles, themeSlug })` | Writes theme files into a running Studio site and activates the theme (streaming / watch-loop context) |
| `liberate_preview({ outputDir, themeFiles, themeSlug, open?, port? })` | Standalone context: creates/reuses a Studio site, imports WXR + products.csv, writes + activates the theme |

## Sub-skills you invoke

Read each skill's SKILL.md before using it.

- **`design-qa` is `disable-model-invocation: true`** — the Skill tool will REFUSE to launch it. Do not try to "invoke" it; READ its `SKILL.md` and follow it inline in this shared context, driving its MCP tools (`liberate_replicate_verify`, `evaluateResponsive`) yourself.
- **`design-foundations` is model-invocable** (a user may run it standalone), but in THIS flow you still run it inline for shared context — read its `SKILL.md` and drive `liberate_design_foundation_scaffold`/`_save`/`_validate` yourself.
- **`generating-patterns` / `compose-page-blocks` / `editing-themes` / `editing-blocks` are ALSO `disable-model-invocation: true`** — you cannot `Skill`-launch them. Invoke each by **dispatching a subagent whose prompt points it at the skill's `SKILL.md`** (the builder fan-out in Step 4 already works this way); the subagent reads the file and follows it. This matches the subagent-dispatch convention and keeps the workflow from stalling on a refused Skill call.

| Skill | When |
|---|---|
| `design-foundations` | Step 1 — if `design-foundation.json` or `design.md` are missing |
| `creating-themes` | Step 1 — emits `theme.json`, `style.css`, `functions.php`, parts skeleton, base templates, self-hosted fonts |
| `generating-patterns` | Step 4 — one builder per cluster representative (fan-out, concurrency-capped). SUPPLEMENTARY — skip when `liberate_reconstruct_pages` (Step 5) covers every page (the default) |
| `compose-page-blocks` | Step 5 — misfit pages only (post-compose sanity check flagged them as unmatched) |
| `design-qa` | Step 7 — visual QA loop after install |
| `editing-themes` | Step 7 — apply fix directives from `design-qa` |

## The 8-step flow

> **Page path is deterministic-first.** `liberate_reconstruct_pages` (Step 5) is the PRIMARY, self-contained page path: it captures each page's OWN computed-style specs, reconstructs gated block markup, and installs per-page patterns + templates. It does **not** consume `cluster-map.json` or the Step 3/4 spec+builder artifacts. So in the default flow:
> - **Step 2 (cluster) is INFORMATIONAL** — it surfaces sitewide-shared chrome and an archetype map for the run-report, but does not gate reconstruction. Where the layout signature is unreliable (e.g. Wix serves CSS cross-origin, collapsing nearly every page to one signature) clustering is near-useless — that's expected, and fine; `reconstruct_pages` still works per-page.
> - **Steps 3–4 (per-cluster specs → `generating-patterns` builder fan-out) are SUPPLEMENTARY.** Skip the fan-out when `reconstruct_pages` covers every page (the default). Reach for it only when reconstruct leaves a real gap (a bespoke section it can't map) or is unavailable (legacy `compose-instantiate` path). Step 3.5 (asset triage) applies to the primary path and is NOT supplementary.
> - Header/footer chrome comes from `liberate_theme_scaffold` (Step 1), not the builders.

### Step 1 — Foundation + theme scaffold

**If `design-foundation.json` and `design.md` already exist, skip to the build gate check and continue.**

1a. Invoke `design-foundations`. It reads `html/`, `screenshots/`, `palette.json`, `typography.json`, `breakpoints.json`, and `manifest.json`; emits `design-foundation.json` (semantic token roles: `color.accent.primary`, `typography.families.display`, etc.) and freezes `design.md`. Do not proceed with raw aggregates.

1b. Invoke `creating-themes`. It reads `design-foundation.json` + `design.md` and emits:
  - `theme/theme.json` (schema v3, token roles mapped from foundation — see token mapping below)
  - `theme/style.css` (with the correct theme header)
  - `theme/functions.php`
  - `theme/parts/header.html` and `theme/parts/footer.html` (skeleton — overwritten in step 5)
  - `theme/templates/index.html`, `theme/templates/page.html`, `theme/templates/single.html`, `theme/templates/single-product.html`, `theme/templates/archive-product.html` (base — content slots filled in step 5)
  - Self-hosted font declarations

**Build gate (after foundation):** validate `theme.json` against schema v3 and run the known-activation-fatals lint via `lintThemeJson` in `src/lib/replicate/theme-json-lint.ts` (e.g. `spacingScale.theme:false` fatal, missing `version` field). Fail → fix `theme.json` before continuing. Do not skip the gate.

**Token mapping (theme.json from design-foundation.json):**

- `color.surface.*` → `settings.color.palette` entries: `surface-base`, `surface-raised`, `surface-inverse`
- `color.text.*` → `text-default`, `text-muted`, `text-subtle`, `text-inverse`
- `color.accent.*` → `accent-primary`, `accent-warning`, `accent-warm`, `accent-highlight`
- `color.border.*` → `border-default`, `border-subtle`
- `typography.families.body` → `settings.typography.fontFamilies[0]`
- `typography.families.display` → `settings.typography.fontFamilies[1]` (omit if `null` — do NOT hallucinate a serif)
- `typography.families.mono` → `settings.typography.fontFamilies[2]` (omit if `null`)
- `breakpoints.lg` → `settings.layout.contentSize`; `breakpoints.xl` → `settings.layout.wideSize`
- `components.*` → `styles.blocks.core/*` overrides (button, paragraph, separator, etc.)

If you provide explicit `settings.spacing.spacingSizes`, omit `settings.spacing.spacingScale` entirely. Do not set `settings.spacing.spacingScale.theme` to `false`.

### Step 2 — Cluster

2a. Call `liberate_section_extract` with `detail:"signature"` for every page in `html/*.html`. This is a batch call over saved HTML — no re-navigation, no Playwright.

2b. Call `liberate_cluster_pages` with all page signatures → `cluster-map.json`. Pages with identical section-type sequences join one cluster. Near-matches (edit-distance ≤ 1) merge with a note. The representative is the cluster member with the most sections (richest HTML by byte size). Exact-signature clustering only — fuzzy deferred.

Read `cluster-map.json` and note: how many clusters, which pages are in each, who the representative is.

### Step 3 — Per-cluster representative specs

For each cluster representative, call `liberate_section_extract` with `detail:"full"`. This emits `<outputDir>/specs/<rep>/section-<n>-<type>.md` for each section of the representative page.

Spec files are the contract between extraction and pattern generation. Each spec contains: interaction model, Y band, background color + brightness, text/accent colors, overlay flags, headings (verbatim), body text (verbatim), buttons (label/href/colors), list items, and image references (uploaded WP-library URLs or `assets/<local-filename>`). For a `review-grid` section the spec also carries `reviews[]` — source-VERBATIM `{ category, stars, quote, author }` records pulled from the served HTML by the deterministic `review-extract.ts` extractor. When `reviews[]` is present, the builder MUST render them verbatim and MUST NOT synthesize review prose; when a review band is detected but `reviews[]` is empty, use the missing-content fallback (placeholder + run-report flag).

**Per-cluster readiness check:** before dispatching a builder, verify each spec has: interaction model set, computed styles present, media local-pathed (no CDN URLs), brightness recorded. Incomplete spec → fix it, don't dispatch.

**Page-builder sections (Shopify/Replo, Shogun):** these stores have rich repeated components — `product-card-row` (image + title + price), `review-grid` (star rating + quote + name), `app-download` (store-badge images), and email-capture heroes. `liberate_section_extract detail:"full"` now classifies these as their own interaction models; the builder maps each to the matching `references/section-mapping.md` template. Don't let a product/review row collapse to generic `static`/`columns`. Note: page-builder review carousels nest their slides too deep for the geometry classifier to read as repeated children, so a review band can first classify as `static` — but `liberate_section_extract` runs the deterministic review extractor over the section's served HTML and, when it finds star-rated quotes, promotes the model to `review-grid` and attaches the verbatim `reviews[]`. So the real reviews are captured even when the band "looked" static. Never assume reviews are unreachable JS and never invent them.

**Missing-media:** if a spec's image slot has no local/WP-library URL (capture failed), the builder must emit a sized placeholder and add a `details.provenanceFlags` entry — NOT substitute an unrelated photo. A non-zero provenance count is a `warn`, not a silent pass. The extractor now captures page-builder CDN imagery (Replo `assets.replocdn.com`, etc.) regardless of host/extension, so genuine misses should be rare.

Sitewide-shared sections (header, footer, a recurring CTA band that appears identically across clusters) are identified here and built once — deduplicated before builder dispatch.

### Step 3.5 — Asset triage (decorative imagery → structural intent)

Classify decorative-looking assets BEFORE reconstruction so the builder expresses them structurally instead of emitting broken/cluttered images.

1. Candidates are deterministic — pipe a short script to `npx tsx --input-type=module` (from the repo root): `import { selectTriageCandidates } from './src/lib/replicate/triage-candidates.js'` over every captured page's SectionSpecs (`<outputDir>/sections/<slug>.json`). Zero candidates → skip this step entirely.
2. For EACH candidate, LOOK at it (fetch the asset file, or crop the section screenshot at the candidate's position). Classify:
   - `keep` — real content: logo, illustration, product shot, photo, meaningful icon. When in doubt, KEEP (never-lose-source-content).
   - `decoration` — divider line, ornament, gradient stripe, background blob. Write a 1-sentence description of what the visual IS (e.g. "thin full-width horizontal rule between sections") — downstream uses it to pick a structural replacement (`wp:separator` / parent `border.*` / parent `background`); `wp:html` is banned.
3. Write `<outputDir>/asset-triage.json` atomically (tmp + rename): `{"schema":1,"site":"<origin>","entries":[{"url","sectionSelector","verdict","description"}]}`. COPY `url` and `sectionSelector` VERBATIM from the `selectTriageCandidates` output — the downstream join is exact-string on both fields; rewriting, normalizing, or trimming either breaks the match silently. The reconstruct handler consumes the file automatically; absent file = no behavior change. Capture-once: an existing file is reused on re-runs — delete it to re-triage.

### Step 4 — Build (fan-out) — SUPPLEMENTARY (skip when `reconstruct_pages` covers all pages)

> **Default flow skips this.** Page content is reconstructed per-page in Step 5 (`liberate_reconstruct_pages`), not from cluster skeletons. Run this fan-out ONLY when reconstruct can't map a bespoke section (needs a custom builder) or is unavailable.

Invoke one `generating-patterns` builder **per cluster representative**. Builders are run in parallel, concurrency-capped to ~4–6. On Codex/Gemini, run sequentially.

Each builder receives (by path — builders are read-only on shared artifacts):
- `design.md` path
- Theme slug
- Token snapshot from `design-foundation.json`
- Uploaded media URL map
- The cluster's spec files (`specs/<rep>/section-*.md`)
- The section-mapping catalog (`skills/generating-patterns/references/section-mapping.md`)
- The spec-files contract (`skills/generating-patterns/references/spec-files.md`)

Each builder returns a **structured JSON envelope** — `{ patterns: [{ slug, php }], sitewideFlags: [...], notes: [...] }` — validated by `parseBuilderEnvelope` in `src/lib/replicate/builder-envelope.ts`. A malformed or partial return is a builder failure → retry once → fall back to sequential for that cluster. Never silently use partial output.

Builders emit **layout skeletons per cluster** (section-mapping templates with content slots filled from the spec's verbatim content), not finished per-page markup. Sitewide-shared sections (flagged in `sitewideFlags`) become registered WP patterns or template parts referenced by slug.

Persist each cluster's patterns **before** marking it built in `session.json` (write-then-mark for resume). Log failures to `theme/debug/cluster-<n>.json` and `theme/notes.md`.

Checkpoint by cluster-group with a compaction/handoff between groups (full state in `session.json` + a short design-state summary) so the orchestrator's context can reset without losing contract artifacts.

### Step 5 — Assemble

**PRIMARY PAGE PATH — reconstruct EVERY content page (not just cluster reps).** Call `liberate_reconstruct_pages({ outputDir, studioSitePath, themeSlug, pages: [...] })` with **every** content page (`{ slug, sourceUrl, title, isHome }`), where home page sets `isHome:true`. For each page it captures computed-style section specs, downloads + installs that page's section media (incl. sibling background-image heroes), reconstructs verbatim block-pattern markup from THAT page's own specs (grids, FAQ accordions, icon assets, 2-column photo heroes, source section background colors), GATES it through `validate_artifacts`, installs `patterns/page-<slug>.php` + `templates/page-<slug>.html` (+ `front-page.html` for home), and forces a pattern re-scan so it renders immediately. It reconstructs each page from its OWN specs — no shared cluster skeleton — so heterogeneous pages don't depend on a matching representative.

**This replaces the cluster-representative-only reconstruction.** Do NOT leave non-representative pages rendering carried `wp:post-content` through `page.html` — that renders raw source-platform HTML and looks drastically different from the source. Every content page gets reconstructed. A page whose pattern FAILS the gate is reported (not installed) — fix the tooling/spec, never ship carried HTML as the "faithful" answer.

**core/html verbatim fallback (per-section, renderer-emitted).** Inside `reconstructPagePattern`, each section's structured render is checked for content loss (`measureSectionCoverage`): if a captured image is dropped, or rendered text coverage falls below `TEXT_FLOOR` (0.5), the renderer emits the section's sanitized source HTML as a `core/html` island instead (`html-fallback.ts`) and records an `html-fallback#<n>` flag. This preserves content the structured path would otherwise silently drop ([[feedback_never_lose_source_content]]) — the provenance gate guards against INVENTED text, NOT DROPPED text. **The trigger is deliberately conservative (only when badly broken) because an island carries the source HTML but NOT its CSS, so a CSS-styled section renders UNSTYLED inside it — worse than an incomplete-but-styled structured render.** Surfaced as `run-report.htmlFallbackSections` (a warning, not a pass/fail): in QA, vision-check each island — text-heavy sections render fine verbatim, but a CSS-layout section that fell back will look unstyled and should be treated as a fidelity gap. Note: coverage measures text PRESENCE, not semantic correctness — a paragraph mis-rendered as a heading still "covers" its text and won't trip the fallback.

**Legacy cluster-skeleton path (`liberate_compose_instantiate` + `compose-page-blocks`):** superseded for page faithfulness by `liberate_reconstruct_pages`. Clustering (Step 2) is still useful for identifying sitewide-shared chrome and for posts/products *templates*, but page CONTENT is reconstructed per-page. Only fall back to compose-instantiate if `liberate_reconstruct_pages` is unavailable.

**Header/footer:** reconstruct the header from the SOURCE header — never from WordPress's page list. The deterministic `liberate_theme_scaffold` handler does this for you: it reads the captured `html/homepage.html`, extracts the real **logo image** + the **primary top-level nav** (label + href) via `extractThemeChromeFromHtml`, infers light/dark header tone, and emits explicit `wp:navigation-link`s + a `core/image` logo. Requirements for any header you build or refine:

- **Logo:** use the source's real logo image (`<header>`'s logo `<img>`/SVG — NOT a product image, NOT `wp:site-title` text). Fall back to `wp:site-title` only when no logo image exists.
- **Nav:** explicit `wp:navigation-link`s for the source's **top-level primary menu only** (e.g. Shopify `nav.header__inline-menu` top-level items). NEVER use `wp:page-list` — it dumps every published WP page (Sample Page, Checkout, account, recall notices) as junk. Drop mega-menu sub-links, the mobile-drawer duplicate, and social/account/cart/search affordances. Map nav items to local pages where they exist; keep external destinations (e.g. Support→Zendesk) as-is.
- **Announcement bar:** preserve the source's top announcement/utility bar when present.

Build the footer from the cluster representative's footer spec. Write both to `theme/parts/header.html` and `theme/parts/footer.html`.

**Self-host source fonts:** `liberate_theme_scaffold` parses `@font-face` rules from the captured HTML/CSS, downloads the referenced font files into the theme `assets/fonts/`, emits matching `@font-face` rules into `style.css`, and binds the captured family in `theme.json` `settings.typography.fontFamilies` (with `fontFace[]`). This is generic — it captures whatever the source self-hosts (e.g. getsnooz.com loads **Larsseit** from the Shopify CDN), not a hardcoded list. The display/heading family is rebound to the real captured typeface even when `design-foundation.json` recorded an open *substitute* (e.g. "Poppins, sans-serif" → corrected back to self-hosted Larsseit). Never leave headings/body in a system fallback when the source's font is self-hostable. Bogus captured line-heights (`0` / `0px`) are sanitized to a sane default.

**Posts:** render through `templates/single.html` + blog/archive template + Query Loop. No per-post section reconstruction.

**Products:** render through `templates/single-product.html` + `templates/archive-product.html` + WooCommerce. No per-product section reconstruction.

Assemble all theme files into a single in-memory array for install:

```ts
themeFiles: [
  { relativePath: "style.css", content: "/* Theme Name: ... */" },
  { relativePath: "theme.json", content: "..." },
  { relativePath: "functions.php", content: "<?php ..." },
  { relativePath: "templates/index.html", content: "<!-- wp:... -->" },
  { relativePath: "templates/page.html", content: "..." },
  { relativePath: "templates/single.html", content: "..." },
  { relativePath: "templates/single-product.html", content: "..." },
  { relativePath: "templates/archive-product.html", content: "..." },
  { relativePath: "parts/header.html", content: "..." },
  { relativePath: "parts/footer.html", content: "..." },
  { relativePath: "patterns/<cluster-slug>.php", content: "<?php /** Title: ... */ ?> ..." },
  // ...one pattern file per cluster representative's built layout skeleton
]
```

Custom blocks (rare — only when core blocks cannot express a real source interactive component) embed in the theme as `blocks/<slug>/src/` + `blocks/<slug>/build/`. Register from `build/` in `functions.php` via `register_block_type`. Emit both `src/` and `build/` in `themeFiles[]`. Namespace: `<siteSlug>-replica/<block-name>`. Use `"supports": { "html": false }` and `"apiVersion": 3`.

### Step 6 — Validate

`liberate_reconstruct_pages` ALREADY gates every page through `validate_artifacts` against that page's own spec corpus and refuses to install a failing page — that is the authoritative trust boundary and it ran in Step 5. For an independent on-disk sweep, run `scripts/_validate.ts <outputDir>` (auto-discovers `theme/patterns/*.php`). Its security/injection/drift checks are exact; its provenance check is APPROXIMATE (corpus from `html/<slug>.html`) and can FALSE-POSITIVE when the renderer concatenated text across source elements — verify any provenance flag against the source before treating it as real. The raw `liberate_validate_artifacts` MCP tool takes `{ patterns: ArtifactPattern[] }` (not `{ outputDir }`).

It asserts:
- All source-derived text is escaped (`esc_html`/`esc_attr`/`esc_url`)
- No raw `<?php` / `<script>` / `on*=` handlers in emitted markup (PHP injection + stored XSS defense)
- Emitted text is a subset of spec captured text (provenance — flags invented prose)
- No remote CDN URLs (all assets must be uploaded WP-library URLs or theme-shipped `assets/`)
- No unresolved `{{placeholder}}` text
- Block-comment-only markup

**Fail → fix the patterns/templates, do not install.** Gate failures surface in `run-report.json`.

### Step 7 — Install + QA

**Blockify post/page bodies (blocks path only):** BEFORE importing, call `liberate_blockify_wxr({ outputDir })`. It rewrites every post/page `content:encoded` body in `output.wxr` through the source adapter's block recipe (seam 2) so imported posts land as editable Gutenberg blocks instead of one Classic block (e.g. Squarespace `sqs-block` bodies). No-op when the platform adapter has no recipe (`skipped:true`); lossless otherwise — bodies it can't convert stay verbatim, and attachments/nav/terms are untouched. It mutates `output.wxr` in place, so it MUST run before the import below. (Blog posts are imported as-is — not section-reconstructed — so this is the only thing that blockifies their bodies. The theme/carry path never calls this.)

**Install:**

- **Streaming / watch-loop context:** call `liberate_install_theme({ outputDir, studioSitePath, themeFiles, themeSlug })` using the exact `themeSlug` value from the runner prompt. Writes files into the running Studio site and activates. No site creation, no duplicate WXR import.
- **Standalone replicate:** call `liberate_preview({ outputDir, themeFiles, themeSlug: "<siteSlug>-replica" })`. Creates/reuses a Studio site (clean site on full re-run; keep existing on resume) and imports `output.wxr` + `products.csv`.

**Binary assets:** `themeFiles[]` is text-only — the self-hosted fonts (`.woff2`), localized `logo.png`, and icon SVGs live on disk at `<outputDir>/theme/assets/` (written by `liberate_theme_scaffold persist:true`). Both `liberate_install_theme` and `liberate_preview` now bridge them via `assetSourceDir`. If you install by some other path (e.g. a manual copy), you MUST also copy `<outputDir>/theme/assets/` into the live theme or the replica renders with system fonts and a broken logo.

**Reconstruct order:** `liberate_reconstruct_pages` requires the theme already installed in the live Studio site, so install (above) FIRST, then run Step 5's reconstruct against the resulting `studioSitePath` (`~/Studio/<siteName>`). `liberate_preview` returns `siteName`, not the path.

Verify: `themeWritten > 0` and `warnings` empty. Capture the replica URL.

**Site hygiene (verify after install — the WXR imports onto a fresh WP install):**
- **Static front page.** `liberate_reconstruct_pages` sets `show_on_front=page` + `page_on_front` to the `isHome` page. Confirm `wp option get show_on_front` == `page`; otherwise `/` renders the blog index, not the homepage reconstruction.
- **WP-default junk + slug collisions.** A fresh WP install ships `Sample Page`, a `Hello world!` post, and an auto-drafted `Privacy Policy`. The default `privacy-policy` draft STEALS the slug, forcing the source privacy page to import as `privacy-policy-2` — which then mismatches the `slug` you pass to `reconstruct_pages` (it would write the reconstruction into the wrong post). `startStudioPreview` deletes these defaults before import; if you import some other way, delete them first (`wp post delete` by slug `sample-page`/`hello-world`/`privacy-policy`) and confirm imported pages kept their source slugs (`wp post list --post_type=page --fields=ID,post_name`).

**QA:** run `liberate_compare` to write comparison.json (v2) with per-viewport height metrics, then invoke `design-qa` with the replica screenshots directory passed as `replicaShotsDir` so the parity gate can use the comparison data. `design-qa` captures replica desktop + mobile screenshots, pairs them with source screenshots, runs the responsiveness gate (390px — HARD: no horizontal overflow, sections reflow), and produces qualitative observations + A/B/C classification per archetype representative.

- **Responsiveness gate is hard.** A theme that overflows at 390px fails, full stop.
- **Grade EVERY page, not just one representative per archetype** — the user sees every page, and a cluster's non-rep members can differ sharply from its rep. QA must screenshot + classify each reconstructed page.
- **A page rendering carried `wp:post-content` (raw source-platform HTML) through `page.html` is a FAIL (C), never a B/"pass-with-notes".** It is not a faithful reconstruction — it is the absence of one. The overall verdict cannot be "pass" while any content page is carried-HTML; fix it by running that page through `liberate_reconstruct_pages`.
- **Visual parity is a hard gate.** Every content-page section gets a measured `SectionParity` record; any unaccepted `divergent` section (flattened columns, wrong band color, dropped media, unstyled island) keeps the run at `fail`. Pixel-diff is a forces-inspection signal, not the gate value.
- Between iterations, climb the escalation ladder (R1 CSS → R2 rebuild block markup → R3 re-extract spec → R4 styled rebuild) — each iteration a STRONGER rung, not the same tweak; reinstall via `liberate_install_theme`; re-run `design-qa`.
- **3 iterations is a circuit-breaker checkpoint, not an exit.** If the ladder is exhausted without `match`, do NOT log-and-ship: stop and ask the operator (raise budget · accept-with-sign-off · abandon page). Only an operator `acceptance: { by: 'human', proof }` (or a Class-C constraint with sampled-pixel proof) lets a `divergent` section ship; everything else stays `fail`. A larger foundation problem may still warrant amending `design.md` + re-running `creating-themes` (full invalidation) as one rung.

**Return** a structured summary to the caller:

```json
{
  "siteSlug": "example-com-replica",
  "themeSlug": "example-com-replica",
  "target": { "kind": "studio", "siteId": "...", "url": "https://example-com-replica.wp.local" },
  "archetypes": ["homepage", "page", "post", "product"],
  "clustersBuilt": 5,
  "clustersFailed": 0,
  "misfitPages": [],
  "qa": { "responsivePass": true, "qualitative": "B", "itersUsed": 2 },
  "openQuestions": [],
  "runReport": "<outputDir>/run-report.json"
}
```

## Gates summary

| Gate | When | Hard? |
|---|---|---|
| Build gate (theme.json schema v3 + lintThemeJson activation fatals) | After step 1 | Yes — fix before continuing |
| Per-cluster readiness check (specs complete before builder dispatch) | Before step 4 | Yes — fix spec, don't dispatch |
| Builder envelope validation (parseBuilderEnvelope) | After step 4 each builder | Yes — retry → sequential, never use partial |
| validate-artifacts (escaping + provenance + injection + placeholders) | Step 6, before every install | Yes — fix, don't install |
| Responsiveness gate (390px, no overflow, sections reflow) | Step 7 QA | Hard — fail = not done |
| Visual-parity gate (measured `SectionParity` per section; verdict via `buildRunReport`) | Step 7 QA | **Hard** — any unaccepted `divergent` section, or a reconstructed page with no sampled sections, = `fail` |
| Qualitative observations (typography nuance, micro-spacing) | Step 7 QA | Soft — surfaced, not blocking |

## Decision rules

- **Never claim a match you haven't measured.** Default to skepticism. "Matches" / "looks good" / "close enough" / "strong parity" are STOP signs — open source vs replica, sample pixels, and itemize the concrete differences (lead with what's WRONG) before any positive claim. When the operator says it doesn't match, they're right: apologize, re-measure brutally, list every gap, fix, re-measure. Under-claim and keep working; never over-claim and stop. (Full rule in `design-qa` SKILL → "Honesty discipline.")
- **Keep all guidance and code GENERIC.** Reconstruction logic, classifiers, and skill rules must work for ANY source site — derive everything from the captured artifacts (specs, screenshots, computed styles), never hardcode a site's colors, image filenames, copy, or section order. A one-off hand-patch to make a single site look right is not a fix; the fix lives in the generic pipeline.
- **Trust `design-foundation.json`** for tokens. Don't reinterpret colors from raw palette. Don't hallucinate a display font when `typography.families.display: null`.
- **Reach parity with core blocks + SCOPED THEME CSS — this is the primary parity lever, not optional polish.** Core-block *attributes* alone cannot express many bespoke source sections (overlapping/positioned hero, circular icon rows, colored pill-tag rows, two-tone split rows, exact band colors at exact positions, gapless full-bleed stacking). The answer is NOT to flatten to an approximate generic layout and call it "close." It is: keep the structure + content in editable core blocks, give the section (or block) a stable `className` (e.g. `specialty-grid`, `pill-row`, `is-replica-card`), and add a **scoped CSS rule in `style.css`** (enqueued via `functions.php`) that reproduces the source's exact treatment (shape, position, size, color, spacing). Blocks stay editable; CSS closes the pixel gap. A per-block `className` + theme CSS rule is the sanctioned way to pixel-match — use it whenever attributes fall short, every time, rather than settling. (This is distinct from hand-authored `core/html`, which is still banned — see below. CSS in `style.css` is encouraged; `<style>`/markup soup in content is not.)
- **Drive every divergent section to `match` — do not stop at "improved."** If a section doesn't match the source, climb the ladder (R1 token/CSS → R2 rebuild block markup → R3 re-extract spec → R4 styled rebuild: core blocks + a scoped `style.css` rule) and re-measure until it matches. The 3-iteration checkpoint exists to ask for more BUDGET, not as license to ship a divergence. Reaching parity is the default expectation; you should not need to ask the operator whether to proceed to parity — proceed.
- **Prefer core blocks for STRUCTURE.** `wp:columns`, `wp:cover`, `wp:group`, `wp:buttons`, `wp:details`, `wp:navigation` cover most observed layouts; pair them with theme CSS for exact visuals (above).
- **Common bespoke section recipes (block + CSS), so they don't flatten:**
  - *Full-bleed hero* (image + overlay headline) → `wp:cover` (image as `url`, `dimRatio` overlay, inner heading in `text-inverse`). NEVER a `wp:group` with a flat dark `background-color` + a `text-default` heading (that renders an invisible black-on-black title). If the captured hero `<img>` src is empty, recover it from the page's largest captured image / media library and build the cover from that.
  - *Numbered/feature card row* → `wp:columns` of equal-height `wp:column`s, each a `wp:group.is-replica-card` (number + title + desc + `wp:button`). Match the source card background (often white/none — don't over-tint).
  - *Circular icon/specialty row* → `wp:columns`; each item a `wp:group` with `className:"...-disc"` + a token background, sized to a circle via `style.css` (`width/height` + `border-radius:50%`), label paragraph below.
  - *Pill / tag row* → `wp:buttons` with each `wp:button` border-radius `999px` + a token background, OR styled groups; row class for `flex-wrap` + gap in `style.css`.
  - *Two-tone split row* (e.g. peach block │ photo │ coral block) → `wp:columns` with per-column `backgroundColor` tokens — one color per column, not one tint for the whole section.
  - *Gapless full-bleed bands* → every section group zeroes its own top/bottom margin; rhythm comes from each section's captured padding (so colored bands butt edge-to-edge).
- **No hand-authored `core/html`.** Never reach for `wp:html` to express layout or CSS — CSS goes in `style.css` (encouraged, per the parity rule above); structure goes in core block markup. The ONLY `wp:html` that ships is the automatic coverage-gated verbatim fallback (below), which the renderer emits — not you.
- **One layout skeleton per cluster, not per page.** Builders emit layout templates; `liberate_compose_instantiate` fills content.
- **Posts and products are data.** Route through templates + Query Loop + WooCommerce. No per-post or per-product section reconstruction.
- **Skip archetypes with `count === 0`** silently.
- **Skip count=0 archetypes** and do not build templates for hypothetical content types.
- **Sitewide sections (header, footer, recurring CTA bands) are built once** and deduped before builder dispatch.
- **Builders are pure.** They never write to disk — only return strings. The orchestrator persists and marks built.
- **Budget guard:** a run exceeding the configurable subagent/cluster/elapsed ceiling pauses and asks the operator rather than running away.

## Anti-patterns

- **Picking and tweaking from the 27-pattern library directly.** The 27-pattern library is now seed material folded into the `section-mapping` catalog. Builders read `section-mapping.md` and `spec-files.md`. Do not reach back to `skills/replicate-with-blocks/references/patterns/`.
- **Generating patterns from scratch without a catalog match.** Check `section-mapping.md` first. Fresh generation is the last resort.
- **Reading WXR `<wp:post_content>` and recreating it as blocks.** Content transformation is out of scope. The theme renders what's already in WXR; it doesn't reconstruct it.
- **Generating a pleasant generic theme.** A clean generic layout is failure when the source has a different section order, grid, spacing, media treatment, header, footer, or responsive stack.
- **Hallucinating tokens.** `display: null` → omit, don't invent. No hex values in patterns — always token slugs.
- **Running `liberate_validate_artifacts` and ignoring failures.** The gate is a trust boundary. Failures mean injected/invented text could reach the installed theme.
- **Skipping the responsiveness gate.** A theme that overflows at 390px is not done, regardless of how it looks on desktop.
- **Documenting a layout divergence as a "known gap" and shipping it.** A flattened section, wrong band color, or dropped grid is not a gap to log — it is work to do. Climb the escalation ladder (R1→R4) or escalate to the operator. "Known gap" / "where it falls short" is an escalation trigger, never the terminal state of a shipped run.
- **Emitting a verdict not backed by the sampled `SectionParity` table.** "Looks good" / "honest rundown" prose cannot move a `divergent` section to pass. A reconstructed page with no sampled sections is `fail (unverified)`, not a pass — measure, don't assert.
- **Hand-authored Custom HTML for layout or CSS.** Inline `<style>`, raw SVG sets, embedded `<script>`, hidden `<form>` → all rejected. Use core blocks + `style.css` or a real theme-embedded custom block. (The automatic coverage-gated verbatim fallback is the one exception — it is renderer-emitted and sanitized, never hand-written.)
- **Custom blocks for layout-only differences.** If the only issue is "columns aren't quite right," edit the layout skeleton instead. Custom blocks are for interactive components that core blocks genuinely cannot express (multi-step form, non-standard carousel with computed state, pricing table with toggles). If the source's interactivity didn't survive extraction, use core blocks + honest static content — not a non-functional custom block.
- **Telex-flavored output.** Footer credits, plugin namespaces, and author fields use `<siteSlug>-replica`, not `telex/`.

## Reference files

Read these when the relevant step comes up — not all are needed on every run:

- **`skills/generating-patterns/references/section-mapping.md`** — interaction-model → WP block template catalog; brightness rule, gradient rule, divider rule, styling rule. Read in step 4 before dispatching builders.
- **`skills/generating-patterns/references/spec-files.md`** — the spec file contract (template, field definitions, media note). Read in step 3 when writing or auditing specs.
- **`skills/design-foundations/references/design-brief.md`** — the `design.md` 10-section template; what each section fills from, lifecycle. Read in step 1 if `design-foundations` is being invoked.
- **`skills/design-foundations/references/theme-tokens.md`** — token-role → theme.json mapping detail. Read in step 1 when token mapping is ambiguous.
- **`skills/design-qa/references/visual-qa.md`** — QA loop mechanics, failure classes A/B/C, iteration budget, run-report output. Read in step 7 before invoking `design-qa`.
- **`skills/replicate-with-blocks/styling-priority.md`** — the preset→patch→instance→variation→layout→CSS cascade, the structured-props cheat sheet, and the hard bans (no raw style="" attrs, no invented className CSS hooks). Applies to native block output; core/html islands exempt.
