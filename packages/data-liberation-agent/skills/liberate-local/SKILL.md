---
name: liberate-local
user-invocable: false
disable-model-invocation: true
description: The OWNED LOCAL static-site path of /liberate — dispatched inline by `/liberate` when its input is a local directory (not a URL). Point it at a directory of hand-authored / Claude-generated HTML+CSS+JS and it stands up a fresh WordPress Studio site and converts the source into a native block theme + live editable pages, carrying the source's own CSS/JS for identical parity. The local-source analog of the URL path: no extraction (the source is already on disk), no platform detection — it provisions the Studio target itself (studio site create), processes the HTML/CSS/JS, then builds the theme and the site. One command drives everything. Hidden from autocomplete and runs only via the `/liberate` front door; not directly user-invokable.
---

# Liberate a local static site

> **Dispatched by `/liberate`.** This is the local-directory branch of the `/liberate` front door, not a standalone entry point — it is `user-invocable: false` (hidden from the user's autocomplete) and `disable-model-invocation: true` (the Skill tool can't invoke it). Instead, `/liberate <dir>` reads & follows this SKILL.md inline (see `skills/liberate/SKILL.md` → "Step R — Route on input type"). The steps below run in that shared context.

The **owned local-source** path: a directory of HTML/CSS/JS → a live WordPress Studio site running a native block theme that carries the source's own design. Unlike the URL path of `/liberate` (which detects a remote platform and extracts over the network), this path has the source on disk already, so it skips detect/discover/extract entirely and goes straight to: **provision the Studio site → process the source → build the theme + pages → capture → parity compare → deterministic repair.**

`liberate_convert_local_site` is the one command that drives all of it (with `createSite: true` it provisions the Studio target too). This skill is the thin front door that resolves inputs, runs that command, and reports.

---

## Pipeline overview

```
/liberate-local <source-dir>
│
├─ resolve inputs: source dir · site name · theme slug · Studio site path · output dir
│
├─ if JS-data OR static content cards: start these together, then wait for both:
│     ├─ background provision: studio site create --path <studioSitePath> --start --skip-browser --skip-log-details
│     └─ model-local-data subagent → <outputDir>/data-model.json
│
└─ liberate_convert_local_site({ dir, studioSitePath, createSite:true, … })  ── one command, drives everything:
      1 createSite      studio site create (fresh WP+SQLite, started)  — skipped if the site already exists or was already provisioned (idempotent)
      2 ingest          source HTML → native block sidecars (roundtrip-validated) + per-instance lib-i styles
      3 block-fixer     canonicalize each page through @wordpress/blocks (editor-valid markup)
      4 design capture  serve source over HTTP → palette/typography/breakpoints + self-host Google fonts
      5 theme assemble  block theme: nav from the graph, footer, no-title page templates, carried source.css/js + instance-styles.css (+ add_editor_style)
      6 install         write + activate the theme; create WP Pages from sidecars (idempotent via _source_url); front page; page template
      7 compare         capture the WP replica (desktop+mobile) and score parity vs the source
      8 repair          deterministic parity loop: diff → computed-style probe → parity-patch.css → re-compare (bounded, no AI)
```

There is no path checkpoint (unlike `/liberate`): the owned-local path is always carry-to-block-theme — the source IS the design authority. The only decision is the optional editor-fidelity surface (below).

---

## Step-by-step

### Step 0 — Resolve inputs

Ask for the **source directory** if not given. Then derive (let the operator override any):

- `dir` — the absolute source directory (HTML/CSS/JS).
- `themeSlug` — kebab-case, e.g. `basename(dir)` → `maison-clouet`.
- `siteTitle` — the home page `<title>`, or a name the operator gives.
- `studioSitePath` — `~/Studio/<slug>` for a fresh site (must NOT collide with an existing unrelated site unless you intend to reuse it). Confirm the chosen path with the operator before creating.
- `outputDir` — liberation artifacts (sidecars, reports, screenshots). Default `~/Studio/_liberations/<slug>` or a run-local dir.

### Step 0b — WordPress-driven data (conditional)

If the source renders its main content from **JavaScript data** (an empty `<div id="…">` filled at runtime by a mount call over an in-file array, e.g. a catalog/listing/gallery) or from repeated **static-HTML content cards** (post-preview cards on index/archive pages), those grids would be **empty or non-native in the block editor** on a straight carry. In that case, first produce the data model:

- Dispatch the **`model-local-data`** skill via a subagent (so the nested skill runs to completion without interrupting this workflow), pointing it at the source dir + output dir. It runs the scaffold to decide the source: `js-array`, `html-cards`, or `none`. For JS arrays it reads the source JS; for static content cards the scaffold's records come from `discoverHtmlCards`. It writes `<outputDir>/data-model.json` (posts/taxonomy + native query loops + a faithful card render).
- At the same time, start Studio provisioning in the background:

  ```
  studio site create --path <studioSitePath> --start --skip-browser --skip-log-details
  ```

  Start this right after resolving inputs and dispatching the data-model fill. Wait for BOTH the background provisioning command and the `model-local-data` subagent to finish before Step 1.
- When that file exists, the convert step below **auto-activates** the data path: it inserts the items, registers any needed custom type/taxonomy, replaces the mounts/card containers with `core/query` loops (editable/analyzable in the editor), and neutralizes the JS data-mounts or static card container + rebinds any modal to per-card DOM islands — while keeping styling/animation/filter JS.
- Step 1 still calls `liberate_convert_local_site` with `createSite: true`. The convert handler is idempotent, so it reuses the already-provisioned site and skips re-provisioning; behavior is unchanged, only the orchestration order and wall-clock time change.

Run the scaffold to decide. If `discovered.source` is `none`, fall through to the pure carry path (today's behavior): do not use a data model, pass `dataModel: false` to the convert call to force the data path off even if a model file is present, and let Step 1 provision or reuse the site idempotently.

### Step 1 — Convert (one command)

Call `liberate_convert_local_site` with `createSite: true`:

```
liberate_convert_local_site({
  dir:            "<source-dir>",
  studioSitePath: "~/Studio/<slug>",
  outputDir:      "<output-dir>",
  themeSlug:      "<slug>",
  siteTitle:      "<title>",
  createSite:     true,     // provision the Studio site if it doesn't exist (idempotent)
})
```

- **createSite** runs `studio site create` only when no WP install exists at `studioSitePath` — a re-run reuses the site (and re-converts idempotently). Admin creds come from env `WP_ADMIN_USER` / `WP_ADMIN_PASS`; omit them and Studio auto-generates (fine for convert-only).
- **carryCss / carryJs** default ON — the source's own stylesheet + scripts are carried into the theme (the parity mechanism). Pass `false` for a tokens-only theme.
- **nativeBehaviors** (opt-in) swaps carried JS for native Interactivity blocks (reveal/sticky/tabs/slider/modal); unmapped behaviors land in `behavior-gaps.json`. Default OFF (maintain the source JS).
- **editableIslands** (opt-in) converts carried `core/html` islands into editable `dla/editable-html` blocks (text+image bindable, static-save, render-anywhere). Default OFF.
- **editorSurface** (opt-in) also scores each page in the live block editor canvas — needs `WP_ADMIN_PASS` in env; warn-only for carry (it does not flip the verdict).

Narrate progress. On `isError`, surface the message (a missing source dir, a Studio create failure, a roundtrip/compose failure per page) and stop.

### Step 2 — Report

From the handler summary + `parity-report.json` in the output dir, report:

- the Studio site (created vs reused) + its live URL,
- pages composed / failed / empty + low-confidence count,
- **parity**: per-page desktop/mobile scores, the averages, `allPass`, and repair rounds/converged,
- any warnings (carried-asset notes, sticky-not-carried, behavior gaps).

Honest visual assessment: itemize real differences; do not oversell a match (see the match-section skill's anti-gaming rules if doing a polish pass).

---

## Idempotency & resume

Re-running `/liberate-local <dir>` on the same `studioSitePath`:

- **skips** site creation (the site exists),
- re-ingests + re-converts deterministically,
- re-installs pages by `_source_url` (no duplicates),
- re-runs the parity loop.

To start completely fresh, point at a new `studioSitePath` (or delete the old site via `studio site delete`).

---

## Notes

- This path needs **Studio installed** and the `studio` CLI on PATH (`studio site create` provisions WP + SQLite and starts the site on a Studio-assigned port; the convert auto-resolves the live URL via `wp option get siteurl`).
- The source is trusted (owned). There is no platform adapter, no network extraction, no products path — it's structure + design carry.
- The theme is a real block theme: pages are block-editable, the carried CSS is the design authority, and per-instance source styles ride fixer-safe `lib-i` classes (so editor saves don't drop them). Carried CSS is also loaded into the editor canvas (`add_editor_style`).
- Measured timing: a fresh convert with provisioning took about 3m36s, while reusing an already-provisioned site took about 2m. On the JS-data path, overlapping the background `studio site create` with the model fill hides roughly 1.5m of fixed provisioning cost.
- Deeper overlap of ingest or design capture would require splitting the convert handler. Keep this workflow to the provisioning overlap unless that handler split exists.
