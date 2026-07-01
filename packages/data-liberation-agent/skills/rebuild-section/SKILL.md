---
name: rebuild-section
description: R4a of the design-qa escalation ladder — rebuild ONE divergent section into canonical, editable WordPress core blocks from its source HTML, screenshots, spec, and design tokens, when R1–R3 (CSS / spec-rebuild / re-extract) could not reach visual parity. Dispatched as a subagent by design-qa; not user-invocable. Output ships ONLY if it re-scores `match` and survives canonicalization with no content loss — otherwise the loop falls to the R4b styled-island floor.
disable-model-invocation: true
---

## When to use me

You are a subagent dispatched by `design-qa` for **one** section that is still
`divergent` after R1 (theme/CSS), R2 (rebuild block markup from spec), and R3 (re-extract
spec). Your job is **R4a**: author native WordPress **core blocks** that reproduce this
section's layout and content faithfully, from richer inputs than R2 had (the source HTML and
the rendered screenshots, not just the spec).

Do **not** use me to invent content, to redesign, or to "improve" the section. Reproduce the
source. If you cannot reach `match` within the gates below, say so plainly and return your
best attempt — the orchestrator falls to **R4b** (a deterministic styled-island floor),
which is the correct outcome, not a failure on your part.

## Inputs the orchestrator gives you

- The section's `SectionParity` record — **which signals tripped** (`section-dropped`,
  `bg-color`, `column-flatten`, `media-dropped`, `unstyled-island`) and the evidence samples.
  These tell you exactly what is wrong; fix those, don't guess.
- The section's **source HTML** and its **`styledHtml`** (computed-style-inlined snapshot) —
  the ground truth for layout and content.
- **Source and replica section screenshots** (cropped to the band) — what it should look like
  vs. what shipped.
- The **`SectionSpec`** (headings, body, cells, images, `columnCount`, `backgroundColor`).
- **`design-foundation.json`** tokens (color / typography / spacing roles) — use these so the
  output is on-theme, not hardcoded values.
- `studioSitePath` (e.g. `~/Studio/example-com`) + `themeSlug` — locate the installed theme so the variation inventory (`styles/blocks/*.json`) can be listed; the dispatching orchestrator passes both.

## What to produce

Native WordPress block markup reproducing the section: `core/columns` + `core/column` for
multi-column bands, `core/group` for backgrounds/spacing, `core/heading`, `core/paragraph`,
`core/image`, `core/buttons`/`core/button`, `core/list`, etc.

**Canonicalization constraint (hard):** sizing and styling MUST survive
`@wordpress/blocks` serialize→parse. Use **core block attributes and class names**
(`align`, `width`, `style.spacing`, `backgroundColor`/`textColor` token slugs, `layout`)
— **never inline `<figure style="...">` or ad-hoc inline styles on block wrappers**, which
the canonicalizer strips ([[project_block_fixer_canonicalization_constraint]]). When a value
maps to a `design-foundation` token, reference the token slug, not a raw hex/px.

**Styling decisions:** follow `skills/replicate-with-blocks/styling-priority.md` — the preset→patch→instance→variation→layout→CSS cascade, the structured-props cheat sheet, and the hard bans (no raw style="" attrs, no invented className CSS hooks). Native blocks only; core/html islands are exempt.

**Existing block style variations — inventory first.** Before emitting ANY new style, list `<studioSitePath>/wp-content/themes/<themeSlug>/styles/blocks/*.json`. Each file is a registered variation (`slug`, `title`, `blockTypes`, `styles`). When one matches what the section needs, REUSE it: apply `is-style-<slug>` on the block. NEVER redeclare an existing slug, never invent an `is-style-*` class with no backing file. New variations follow styling-priority.md option 5 (recurring + nameable only) and are written as a new `styles/blocks/<slug>.json` file (slug `lib-` prefixed) plus the class on each claiming block.

**Preserve ALL source content** — every heading, paragraph, list item, button label, and
image in the source section must appear in your output. Do not truncate, dedupe, or drop
([[feedback_never_lose_source_content]]). If the source shows a heading and an identical
paragraph, reproduce both.

## Acceptance gates — your output ships ONLY if ALL pass

The orchestrator runs these after you return. Author with them in mind; you **cannot
self-accept** — acceptance is the measured re-score, not your assertion.

1. **Block-markup oracle** — the markup parses cleanly via the WordPress block parser
   (`liberate_validate_artifacts`). No malformed blocks, no injection vectors.
2. **Canonicalization round-trip** — survives `@wordpress/blocks` serialize→parse with no
   attribute/class loss (the block-fixer check). If a style would be stripped, you used the
   wrong mechanism — move it to a core attribute/className.
3. **Re-measured `section-parity` = `match`** — after reinstall + re-capture, all five robust
   signals clear: section present, `bgDeltaE ≤ 10`, `columnCountMatch`, media present, not an
   unstyled island. A `3 → 1` column collapse, a wrong background, or a dropped image FAILS.
4. **Content coverage = no loss** (`measureSectionCoverage`) — every captured text item and
   image is present in your markup.

If any gate fails, the rung fails and the loop falls to **R4b**. That is a valid, faithful
floor (the styled island renders pixel-accurate, just not block-editable) — never argue a
failed rebuild into a pass, and never ship a flatten or an unstyled island as a "known gap"
([[feedback_honest_visual_assessment]], [[project_faithful_recreation_enforcement]]).

## Method

1. Read the divergence reasons first — they scope the fix.
2. Read the `styledHtml` to recover the true layout (column count, alignment, backgrounds)
   and the source HTML for the exact content and structure.
3. Map the layout to core blocks: a row of N cards → `core/columns` with N `core/column`;
   a text-over-photo band → `core/cover`; a media-beside-text → `core/columns` (one column
   image, one text). Match the **source** column count exactly.
4. Resolve colors/fonts/spacing to `design-foundation` token slugs.
5. Return the block markup. The orchestrator reinstalls, re-captures, and re-scores.

## Stay generic

Derive everything from the inputs for THIS section. Never hardcode a site's colors,
filenames, copy, or section order ([[feedback_scripts_must_be_site_agnostic]]). The same
skill must rebuild any platform's bespoke section.
