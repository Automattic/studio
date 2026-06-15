---
name: blocks-to-theme
description: Turn a completed html-to-blocks workspace (single or multi page) into an installable WordPress block theme, verify it in WordPress Playground, then install and activate it in a real Studio site. Stage 2 of the design-to-theme pipeline. Extracts theme.json from style evidence, infers template parts from cross-page repetition, bundles fonts and media, and gates on validation plus pixel-and-editor comparison.
user-invokable: true
---

# Blocks To Theme

Run this skill on a COMPLETED `html-to-blocks` workspace — one whose comparison gates already passed for every page. The engine tools gather evidence and verify; you make the design decisions. The final deliverable is an installed, activated block theme in a real Studio site.

Every engine tool here takes the same `workspaceRoot` the stage-1 run used. Pass it to every call.

## Required Workflow

1. Run `analyze_theme_evidence`; read `reports/theme-evidence.json`.
2. Run `infer_template_parts`; read `reports/template-parts.json`.
3. Write `plan/theme-plan.md` containing: the **token map** (value to preset slug), the **lift ledger** (every residual CSS rule with its reason category), the **parts decision** for every evidence group (unify / variant parts / leave in content, each with its cited group), the **template plan**, the **page manifest** (slugs, titles, front page), and the **media map** (source path to destination).
4. Run `fetch_theme_fonts` (see Fonts and Media).
5. Run `scaffold_block_theme` with the plan's decisions as data.
6. Run `validate_block_theme`; fix and re-scaffold until `errors` is empty.
7. Run `playground_render`; repair until every page passes both viewports AND every page's editor validation has zero failures (see Playground Gate).
8. Install into the Studio site and activate (see Install Into Studio).

## Hard Gates

### Evidence Gate

No template part without a cited occurrence group from `reports/template-parts.json`. The standing template set is `index.html` plus the generic defaults `archive.html`, `single.html`, `404.html` — these need no evidence; the scaffold composes them from the inferred chrome plus plain core blocks (query loop, post title/date/content, not-found message) styled entirely by global styles. Any template beyond that set needs a cited difference in chrome variants or the front-page designation. **Single-page runs normally produce zero parts** — parts exist to share chrome across pages, and one page has no repetition evidence.

### Lift-First Gate

Every rule remaining in theme `style.css` or any `styles.blocks[...].css` carries a reason category in the lift ledger. A rule with no category MUST lift into theme.json. Do not solve fidelity by dumping the workspace stylesheet into the theme.

### Completion Gate

The run is complete only when `validate_block_theme` reports zero errors AND `reports/theme-comparison.json` shows every page within thresholds (`maxMismatchPercent <= 1`, `maxHeightDelta <= 8`) at both viewports AND every page's `editorValidation.failures` is zero AND the theme is installed and activated in the Studio site. Quote the validation `passed` flag and the comparison aggregates in the final response. Otherwise keep repairing or report the run blocked with the metrics and the blocking cause.

## The Lifting Ladder

For every recurring style fact in the evidence report, try each rung in order and stop at the first that fits. Lower rungs are more editable and inspectable; `style.css` is the last resort.

1. **Presets** (`settings.color.palette`, `.typography.fontSizes`, `.spacing.spacingSizes`, `.custom`): recurring colors, font sizes, spacing values, custom properties become named tokens.
2. **Root styles** (`styles.color`/`.typography`/`.spacing`): the page's base background/text/font set on `body`/`:root`.
3. **Element styles** (`styles.elements.heading`/`.link`/`.button`/...): rules targeting plain elements site-wide.
4. **Block styles** (`styles.blocks["core/..."]`): rules consistently targeting one block type.
5. **Block style variations**: a named alternative look applied to some instances of a block type.
6. **Per-block CSS** (`styles.blocks["core/..."].css`): a scoped escape hatch for one block type with no structured property.
7. **Theme `style.css`**: only rules carrying a reason category below.

## The Six Lift-Reason Categories

A rule may remain in `style.css` (or any `styles.blocks[...].css`) only if the ledger tags it with at least one of:

- `media-query` — the rule lives inside `@media` (theme.json has no responsive conditions).
- `pseudo` — `::before`/`::after` content and decoration.
- `position` — `position: fixed | absolute | sticky` layering.
- `blend` — `mix-blend-mode`, `filter`, `backdrop-filter`.
- `grid` — `display: grid` and `grid-*` (no block support models arbitrary grids).
- `interaction` — `:hover`/`:focus`/`:active`/`:checked`, transitions, animations, `@keyframes`.
- `selector` — the rule targets an arbitrary class composition (`.hero__copy`, `.tier li`) that theme.json structurally cannot address. This category is JUDGED, not tool-assigned: it never applies to rules on `body`, bare element selectors, or `.wp-block-*` roots — those always lift to root styles, `styles.elements`, or `styles.blocks`.

The first six match the `cssRules[].buckets` `analyze_theme_evidence` assigns. A rule shown with an empty `buckets` array is either liftable (lift it) or a `selector` case (justify it in the ledger).

## The Two Mechanical Rewrites

You declare the token map; `scaffold_block_theme` performs these:

1. **Preset refs in block trees.** Any tree attribute value that exactly matches a token-map entry is replaced by the preset ref. With `"#0b0b0b" -> "ink"`, `"style":{"color":{"background":"#0B0B0B"}}` becomes `"backgroundColor":"ink"`. Font sizes become `"fontSize":"<slug>"`; spacing becomes `"var:preset|spacing|<slug>"`.
2. **Custom-property renames in CSS.** With `"--pad" -> "pad"`, every `var(--pad)` in residual CSS becomes `var(--wp--custom--pad)` and the `--pad` definition drops from `:root` (WordPress emits it from `settings.custom.pad`).

Only EXACT value matches rewrite (trimmed, lowercased). Never map "close" values — `#0b0b0b` and `#0c0c0c` are two tokens or one stays raw. `clamp()` values go into presets verbatim; do not flatten fluid sizes. Name presets after the source custom properties (`--bone` to slug `bone`); a nameless value gets a descriptive slug, never `color-1`. WordPress camelCases `settings.custom` keys when emitting variables — prefer lowercase single words (`pad`, `ease`, `line`); for multi-word source props pick one convention and verify the emitted variable name matches what the rewritten CSS references.

## Template Part Inference

`infer_template_parts` groups every top-level subtree across all pages by an exact hash (block names + all attribute values + inner blocks) and a structural hash (block names, sorted className lists, sorted non-content attribute keys). A group is `exact` when all occurrences share one exact hash, `structural` when shapes match but values differ; structural groups carry a `variance` table.

For every structural group, record one decision:

1. **Unify** — emit one shared part from the cleanest occurrence. Right when variance is invisible (ordering artifacts, redundant attributes, anchors that normalize after permalink rewriting).
2. **Variant parts** — emit one part per page, named `<role>-<page>` (`nav-home`, `nav-judges`). Right when variance is visible per-page chrome state (an `is-current` marker, a per-page footer column). Each page's template references its own variant.
3. **Leave in content** — no part; the subtree ships inside the page's content payload. Right when differences are copy in otherwise-unique sections.

Choose names and `area` from the occurrence evidence: `first: true` everywhere + `tagName: header`/nav block to a role name (`nav`, `site-nav`) with `area: "header"`; `last: true` everywhere + `tagName: footer` to `area: "footer"`; otherwise `area: "uncategorized"`. Read the variance tables before deciding — an attr path either appears or it does not; "looks the same to me" is not a decision input.

## Template Planning

The theme ships exactly the standing set by default: `index.html` (inferred chrome + `post-content`) plus the generic `archive.html`/`single.html`/`404.html`, which the scaffold builds automatically by wrapping plain core blocks with index's split top/bottom chrome. A `page-{slug}` template is allowed ONLY when that page needs a different chrome variant set than index, cited from `reports/template-parts.json`. `front-page.html` only when the front page's chrome differs from what would otherwise serve it; prefer the manifest's `front` flag and a page-assigned `template` first.

A template is template-part references (chrome) plus `<!-- wp:post-content /-->` (and the plain core blocks in the generic defaults). Page copy — heroes, sections, lists — lives in imported pages as editable content. Never bake a page's sections into its template. The generic defaults have no mockup, so `playground_render` does not screenshot them; `validate_block_theme` covers them. Do not spend repair cycles styling them beyond global styles.

## Fonts and Media

`fetch_theme_fonts` finds the Google Fonts `@import` in the mockup CSS, requests it with a modern Chrome UA so Google serves woff2, downloads each face into `assets/fonts/`, and returns `fontFamilies` entries with `src` values of `file:./assets/fonts/<file>`. Pass them to `scaffold_block_theme` as `fontFamilies`; do not hand-write fontFace entries. If the fetch or any download fails, the run is BLOCKED — never ship the remote `@import` in theme CSS. Report blocked with the fetch error.

**Zero remote URLs.** `validate_block_theme` fails on any `http(s)://` URL in `style.css`, `theme.json` (schema/license excepted), or any content payload, and on any internal `*.html` link that survived permalink rewriting. The fix is always to bundle the asset, never to allowlist the URL.

**Media scheme:** inventory every image/media reference from the block trees and a CSS `url()` scan; the media map lists each source with its `assets/media/` destination. `scaffold_block_theme` copies them. Content payloads use `{{THEME_URI}}/assets/media/...` placeholders that the content plugin resolves to `get_stylesheet_directory_uri()` at import. Theme CSS uses relative paths (the placeholder does not resolve in a static stylesheet); templates and parts keep the placeholder, resolved by a `render_block` filter.

## Editor-Runtime Attribute Constraints

- **No raw `var(--…)` in style attribute values** (spacing, color, etc.). The browser save escapes `--` inside `style` attributes as `u002du002d` (kses), so such markup can never validate in the editor. Tokens in attribute values must become presets (`var:preset|spacing|<slug>`), which are exempt. Raw `var()` is fine in CSS files — only attribute values are affected.
- **`wp_slash` PHP-inserted block JSON.** Block attributes containing `&`, `<`, `>`, `"`, or `--` are escaped as `\uXXXX` in the serialized comment JSON. Anything inserting that markup through PHP must `wp_slash()` it first — `wp_insert_post` unslashes input and corrupts the escapes. The generated content plugin does this; any custom import path must too.

## Playground Gate

`playground_render` boots a real WordPress via `@wp-playground/cli`, mounting the theme and plugins, activating them, calling the content plugin's `<prefix>_import_pages()` (the same path the admin "Import pages" button uses), then screenshotting each page logged-out at `/?pagename=<slug>` (and `/` for the front page) through the same capture path stage 1 used. The first run downloads the WordPress build — needs network and a generous timeout; on failure the error includes the Playground log tail, so read it before assuming a visual problem.

Expect NEW drift on the first run that the workspace preview never had:

- **block-library CSS** — core block defaults (paragraph/heading margins, button/navigation styling, image figure spacing).
- **global-styles preset CSS** — the CSS WordPress generates from your theme.json can cascade differently.
- **layout supports** — `is-layout-constrained`/`is-layout-flow` add content-width centering and block-gap margins. A section that filled the width on workspace CSS alone can render with gutters; `width: 100%` cannot beat `.is-layout-constrained > *:not(.alignwide):not(.alignfull)`. The block carries width through `align` (full/constrained for centered inner content, full/default on outer and inner for edge-to-edge). Confirm the first section's computed width equals the viewport before assuming a CSS fix.

**Where to fix what:** token/element drift (wrong color/size/spacing from a preset, heading/link styles) to **theme.json**. Width or block-gap drift from layout rules to the block's own `align`/`layout`/spacing — prefer setting it in the stage-1 tree and re-serializing so the source of truth stays consistent; `width`/`margin` in style.css loses to the cascade. Structural shims (killing an unwanted core margin, overriding a layout rule for one class) to **theme `style.css`** with a ledger category. **Never edit the content payload to absorb WordPress's CSS** — that dodges the diff and the next editor-created page would look wrong. Setting a block's own `align`/`layout`/spacing is the legitimate width fix (real design intent); free-form payload edits are only valid when the payload itself is wrong (bad media path, missed permalink rewrite).

After frontend captures, the gate logs into wp-admin and opens every imported page in the block editor, collecting `Block validation failed` console messages — the editor recomputes `save()` in the browser and catches drift no Node round trip can see (kses `--` escaping, content-filter mangling of empty inline elements, unslashed comment-JSON escapes). The run fails on ANY such message; counts land under `editorValidation` in `reports/theme-comparison.json`.

Load the `visual-fidelity` skill for the repair loop: inspect `-diff-*.png` even on passing pages (numbers hide localized drift), fix the worst page first, re-run `validate_block_theme` after any re-scaffold, then re-run `playground_render`. Passing thresholds is the only successful end state.

## Install Into Studio

This is the closing step and is mandatory — the deliverable is a working theme in a real site, not a verified directory.

1. Identify the target site with `site_list` (create one with `site_create` if none exists). Start it with `site_start` if it is not running.
2. Copy the verified theme directory from the workspace into the site's `wp-content/themes/<slug>/`. If you are starting from a fresh site and want Studio to own the scaffolding, you may instead use `scaffold_theme` and lay the verified files into the scaffolded directory.
3. Activate it: `wp_cli theme activate <slug>`.
4. If the content plugin is part of the deliverable, activate the plugins and run the import the same way the gate did (activate `<slug>-blocks` and `<slug>-content`, then trigger the import) so the pages exist in the live site. Validate any block content with the `validate_blocks` Studio tool.
5. Verify the live result with `take_screenshot` (`viewport: "all"` for desktop and mobile), in both light and dark color schemes.

Only after the theme is installed, activated, and visually verified in the Studio site — with the validation and comparison gates quoted — is the run complete.
