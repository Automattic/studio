---
name: html-to-blocks
description: Transform designed or provided HTML/CSS/JS into editable WordPress block content. Stage 1 of the design-to-theme pipeline. Creates a workspace, plans core-first blocks, builds a data-only block tree, generates vanilla-JS custom blocks only when core cannot preserve fidelity and editability, serializes, and repairs until rendered and editor screenshots match the mockup.
user-invokable: true
---

# HTML To Blocks

Use this skill when the user wants an HTML/CSS/JS design, or a directory of provided markup, transformed into editable WordPress blocks. You own the design judgment and code edits; the engine tools provide workspace setup, mockup analysis, custom-block scaffolding, preview wrapping, screenshot comparison, and DOM geometry measurement. This is stage 1; stage 2 is the `blocks-to-theme` skill, which turns a completed workspace into an installed theme.

## The Workspace

Every engine tool operates on a workspace directory, passed as `workspaceRoot`. Create it once under the active Studio site (e.g. `<site>/tmp/h2b-<slug>/`) or a scratch path, and pass that same path to every engine tool for the whole run.

- `create_workspace` scaffolds the directory.
- If the user has a Studio site already, find it with `site_list`; otherwise this stage does not need a running site (the install happens in stage 2). The workspace is just files.

## Required Workflow

1. Run `create_workspace`.
2. **Provided markup**: run `import_provided_markup` and treat the imported HTML/CSS as the source mockup. It copies the export into `mockup/`, bundles linked stylesheets into `mockup/style.css`, and preserves the HTML as the visual source of truth — do not redesign or simplify it before analysis. **No markup**: generate `mockup/index.html`, `mockup/style.css`, and optional `mockup/script.js` per the Design Stage below. Load the `visual-design` skill for art direction.
3. Run `analyze_mockup`; read `analysis/content-inventory.json`.
4. Write `plan/block-plan.md` and `plan/block-plan.json`. Complete the Core-First Gate (below) before writing any custom block.
5. Generate custom blocks only where core blocks cannot preserve both fidelity and editability. Scaffold each with `scaffold_custom_block`, then edit to match the mockup. Source lives in `wordpress/blocks/<slug>/`.
6. Assemble editable content in `wordpress/block-tree.json` (data-only — see Assembly). Styling priority is strict: block support attributes first, custom-block scoped CSS second, small page CSS last.
7. Run `serialize_wordpress_blocks`. It registers core blocks via `@wordpress/block-library`, registers custom blocks from `wordpress/blocks/*/index.js`, serializes the tree, writes canonical markup to `wordpress/content.html`, frontend preview to `rendered/rendered-blocks.html`, a no-build editor preview to `editor/block-editor.html`, and `reports/style-audit.json`. Preview CSS comes from `wordpress/style.css` and custom-block `style.css` files; `mockup/style.css` is intentionally excluded from the rendered preview.
8. Use `create_block_editor_preview` to refresh or inspect an editor instance from a tree without reserializing everything. For multi-page runs, call it per page tree.
9. Use `screenshot_html` for inspection shots of mockup, rendered, editor, or arbitrary workspace HTML.
10. Run `compare_html`.
11. When a comparison fails, run `measure_layout` BEFORE staring at pixel diffs. It returns per-element top/height deltas between mockup and the rendered or editor page (`candidateKind: "editor"`), aligned by selector order. Drill from sections to children with narrower selectors until the drift names one element, then fix it. Pixel diffs localize; measurements identify.
12. Load the `visual-fidelity` skill and run its repair loop: inspect, write the repair-tasks file, fix each task, then repeat serialize/compare until both saved-frontend and editor-preview thresholds pass on every page.
13. Run `audit_standins` and read `reports/standins.json`. Confirm every data-driven region is a marked core-block stand-in (not a custom block), and that no stand-in references a postType/taxonomy the content model will not provide. Stand-ins stay static until `hydrate_standins` runs in stage 2.

## Thresholds and Completion Gate

Default thresholds: `maxMismatchPercent <= 1` and `maxHeightDelta <= 8`.

A run is complete only when BOTH comparison aggregates pass for EVERY page:

- `aggregates.rendered.maxMismatchPercent` and `aggregates.rendered.maxHeightDelta` within thresholds.
- `aggregates.editor.maxMismatchPercent` and `aggregates.editor.maxHeightDelta` within thresholds.

Reports are per page: `reports/comparison.json` for the index, `reports/<page>.comparison.json` for the rest. They never overwrite each other; a complete multi-page run leaves one passing report per page. Before the final response, read each report and state the rendered/editor metrics. Only say the run is done when every aggregate passes. Do not stop at "close", "structurally close", or "good enough". If concrete repairs cannot reduce the metrics, report the run blocked with the current metrics and the blocking cause — never present a failed comparison as a successful run.

## Multi-Page Runs

`import_provided_markup` detects sibling `.html` pages and returns a `pages` manifest (index/page/single/archive/404). Follow the manifest paths for every page, including the index, so the workspace stays symmetric:

- Block tree: `wordpress/pages/<page>.block-tree.json`
- Serialized markup: `wordpress/pages/<page>.content.html`
- Frontend preview: `rendered/<page>.html`
- Editor preview: `editor/<page>.html`
- Comparison report: `reports/<page>.comparison.json`

Workflow:

1. Import once; read the manifest.
2. Analyze and read EVERY page before planning. Identify shared chrome (header/nav/footer), shared components (cards, forms, teasers), and page-local sections. Plan custom blocks ONCE for the whole site; pages reuse them with different attributes.
3. Build and fully pass one page first — usually the index. It forces the shared blocks, design tokens, and editor parity into shape; later pages then converge in a few iterations each. Pass the index page first, then iterate the rest.
4. Page-specific CSS goes into clearly labelled sections of `wordpress/style.css` (or block CSS when component-scoped). Keep the shared token/base layer at the top.
5. Serialize and compare per page. The completion gate applies to every page; one failing page is an incomplete run.
6. Always compare both viewports per page. A missing margin can be invisible at desktop (a taller sibling column masks it) and surface only at mobile when columns stack.

## Core-First Gate

Before generating custom blocks or the block tree, write a core-first audit in `plan/block-plan.md`:

- For every mockup section, list the candidate core block assembly first.
- For every chosen core block, list the native attributes/support props that will carry the visual styling before any CSS.
- Only then list any custom block, with the specific reason core blocks fail.
- A custom block that replaces a whole section is rejected unless the section is a real submission form (contact/newsletter/booking) or a genuinely bespoke interactive widget with a typed editing model that no core block expresses. Navigation, search, site identity, comments, pagination, post fields, and repeated content cards are NOT custom-block reasons — they are real core blocks or `core/query` stand-ins (see "The Serializer Is Not the Design").
- Complex layout is not a sufficient reason for a custom block. Use `core/group`, `core/columns`/`core/column`, `core/heading`, `core/paragraph`, `core/buttons`/`core/button`, `core/list`/`core/list-item`, `core/details`, `core/image`, `core/cover`, `core/media-text`, `core/spacer`, `core/separator`, `core/quote`, `core/table`, and supports/classes first.
- The final tree should normally contain FAR more core blocks than custom blocks. If custom blocks approach the core-block count, treat the plan as failed unless the user explicitly asked for a mostly-custom site.
- If the editor preview drifts because WordPress wrappers, RichText sizing, placeholders, or chrome alter layout, fix the editor harness, custom-block `edit()`, or editor-scoped CSS. Do not replace core assemblies with custom section blocks to make editor comparison easier.

## The Serializer Is Not the Design

"It doesn't render in the static preview" is a HARNESS fact, never a design fact, and never a valid core-rejection reason. WordPress server-renders its dynamic blocks, and so does the pipeline (via `tools/lib/dynamic-render.mjs`), so they appear on both preview surfaces. Use the real core block and prepopulate it:

- Navigation → `core/navigation` with `core/navigation-link`/`core/navigation-submenu` inner blocks. Never a custom "site-nav" block, never `core/buttons`.
- Search → `core/search` (label, placeholder, buttonText, buttonPosition). Never a custom "search-form".
- Site identity → `core/site-title`, `core/site-tagline`, `core/site-logo`. A text wordmark is `core/site-title` (+ tagline), not an image and not a custom block.
- Comments → `core/comments`; comment form → `core/post-comments-form`.
- Pagination → `core/query-pagination` (+ `-previous`/`-numbers`/`-next`); prev/next post → `core/post-navigation-link`.
- Images → `core/image`; missing media is a `data:` SVG placeholder at the right aspect ratio in `url`, never a URL hidden in InspectorControls.

If a dynamic core block genuinely cannot preview after prepopulation, that is a renderer-shim gap to report (and fix in `dynamic-render.mjs`), not a licence to invent a custom block. Supply `wordpress/preview-context.json` (`{ "siteTitle", "siteLogoUrl", "homeUrl", "postDate", "postTerms" }`) so entity-backed blocks render with real-looking values on both surfaces.

## Provided Markup Is Binding

When the source export annotates intended blocks — `<!-- core/navigation -->`, `<!-- core/search -->`, a handoff table mapping components to blocks, a data file shaped like a CPT — those are requirements, not hints. Use the named block. Deviating needs an explicit design-level reason written in the plan, never "the preview is easier this way".

## Stand-Ins for Data-Driven Regions

Some regions are real queries/comments with no data yet (object/product grids, post indexes, comment threads). Build them as a static core-block composition seeded with representative content so the visual gate can style them, and MARK the region with `attrs.metadata.standin`:

- repeating container → `{ "for": "core/query", "postType": "...", "taxonomy": "...", "query": { "perPage": N, "orderBy": "date", "order": "desc" } }`; the container's FIRST child is the item template.
- each per-item field in that template → `{ "for": "core/post-title" | "core/post-featured-image" | "core/post-terms" | "core/post-excerpt" | "core/post-date" }`.
- comment thread → `{ "for": "core/comments" }`.

The card itself stays real core blocks (`core/group` + `core/image` + `core/heading` + `core/paragraph`) with stable classNames the CSS targets — never a custom "post-card" block, and never a `variant` enum encoding placement (featured/row/grid is layout, expressed by the container's class/CSS). Run `audit_standins` before completion; the content-modeling step in stage 2 runs `hydrate_standins` to swap these into `core/query`/`core/comments` against real seed content.

## Core Block Selection

Picking "a core block" is not enough; pick the one whose saved markup and editor behavior are closest to the source, or you create editor drift even when frontend CSS can be forced to match.

- `core/cover` for media-backed sections, heroes, promos, overlay cards — text/buttons over an image/video with an overlay. Usually better editor parity than `core/group` + absolutely positioned `core/image`. But when the mockup "image" is a decorative CSS background (placeholder plates, tone classes), `core/group` carrying the mockup's own background classes beats `core/cover` on both surfaces — the media is not editable content.
- `core/media-text` for a two-part image/text split that should stack on mobile. Use its `mediaPosition`, `mediaWidth`, `isStackedOnMobile` before custom grid CSS.
- `core/columns`/`core/column` for ordinary responsive columns with native mobile collapse. But asymmetric grid tracks (e.g. `1.4fr 1fr 1fr`) are NOT column widths — use `core/group` with the mockup's grid CSS on a className.
- `core/group` for layout wrappers, section shells, stacked editorial bands, constrained containers, grid children. Not for media overlays, lists, forms, links, or arbitrary HTML.
- `core/buttons`/`core/button` for link/button groups, even when they need custom visual styling.
- `core/list`/`core/list-item` for real lists; never paragraphs with line breaks.
- `core/table` (cell arrays) and `core/quote` (inner paragraph) serialize cleanly and fit data tables and pull quotes.
- Dynamic core blocks (`core/navigation`, `core/search`, `core/site-title`/`-logo`, `core/comments`/`core/post-comments-form`, `core/query-pagination`, `core/post-navigation-link`, `core/post-date`/`-terms`) render in BOTH previews via the shim (`dynamic-render.mjs`) — use them directly and prepopulate them. Never avoid them because they "preview blank", and never substitute `core/buttons` or a custom block for navigation.

Use native attributes before CSS: `core/group` `backgroundColor`/`textColor`/`gradient`/`style.*`/`layout`/`align`; `core/cover` `url`/`dimRatio`/`overlayColor`/`focalPoint`/`minHeight`/`contentPosition`; `core/image` `url`/`alt`/`aspectRatio`/`scale`; `core/button` `text`/`url`/`backgroundColor`/`textColor`/border/typography.

**Preview-surface caveat:** the RENDERED preview loads only workspace CSS — no block-library CSS. Core blocks whose layout depends on library rules (`core/cover`'s absolute image, `core/columns` flex, `core/buttons` flex, `core/separator` defaults) render unstyled there unless `wordpress/style.css` shims those `wp-block-*` classes. The editor preview DOES load library CSS (in a low-priority cascade layer), so a library-dependent block can look right in the editor and broken in rendered. Either shim the classes or pick a block whose saved markup is self-sufficient.

## Custom Blocks

**Before writing one: is it actually custom?** Most custom-block instincts are a core block the static serializer happened to render blank — re-read the Core-First Gate and "The Serializer Is Not the Design". A custom block is justified only for a real submission form with no core equivalent, or a genuinely bespoke interactive widget. If you are about to build a navigation, search, comments, pagination, site-identity, card, or post-field block, stop and use the core block (or a marked `core/query` stand-in).

Scope discipline for blocks that ARE custom: visible content (including media) lives in the canvas — an image is a `core/image` child or an in-canvas `MediaUpload`/`RichText` field, never a URL typed into InspectorControls. No placement-variant attribute (`variant: featured|row|grid` encodes where the block sits, which is the parent's layout/CSS job). An inline SVG icon never justifies a block — icons are CSS decoration (background or pseudo-element on a core composition). A custom block's attributes are a typed editing model, never a raw HTML blob.

Use vanilla JavaScript with WordPress globals — no JSX, no build step. Scaffold with `scaffold_custom_block`, then edit. Use `wp.blocks.registerBlockType`, `wp.element.createElement`, `wp.blockEditor.useBlockProps`/`RichText`/`InspectorControls`/`BlockControls`, and `wp.components.*` only for settings. `block.json` uses `apiVersion: 3`; declare attributes with types/defaults and supports for spacing/color/typography/border/dimensions/align/anchor/className.

- Visible copy belongs in the canvas via `RichText`, using the same `tagName`/className that `RichText.Content` uses in `save()`. Do not render `TextControl`/`TextareaControl` as primary in-canvas UI for visible content.
- Behavior and settings (URLs, method, required flags, speed, variants) go to `InspectorControls`/`BlockControls`.
- Forms, search boxes, subscriptions, booking, contact UI must save real semantic `<form>` markup, preserving labels, field names, input types, placeholders, required state, options, action, method, submit text.
- `save()` is the single source of frontend markup. `edit()` must be a visual twin: same root tag, class names, child order, repeated-item wrappers, geometry — with `RichText` or disabled controls replacing static text/inputs. Editor-only wrappers, helper labels, and disabled behavior must not change screenshot geometry.
- Root color/spacing/typography/border/min-height comes from supports-backed attributes in the tree, not hard-coded CSS. Use block `style.css` only for scoped internals supports cannot express.
- Do not use `dangerouslySetInnerHTML` or HTML-blob attributes.

## Assembly

The source of truth is `wordpress/block-tree.json`, not hand-written block comments or saved HTML. The tree is **data-only**: `blockName`, `attrs`, `innerBlocks`, block styles, support-like attributes, classes. `serialize_wordpress_blocks` turns that data into canonical markup via WordPress serialization and each block's `save()`.

- Never put `htmlLines`, `innerHTML`, `innerContent`, `html`, `markup`, or `sourceHtml` in the tree. The serializer rejects those fields.
- The serializer also rejects unregistered core block names, attributes absent from block metadata, and non-layout `core/group` tag names (no `span`, `strong`, `time`, `dl`, `dt`, `dd`). If core cannot model a structure cleanly, generate a custom static block whose attributes represent the editable content model.
- Use only real registered core block names. Do not invent convenience blocks such as `core/link`. `core/group` is for block-level layout containers only.
- The tree must match the mockup, not merely contain the same text: preserve source order, links, labels, placeholders, repeated items, and button-group layout. Use stable class names that map cleanly to CSS.
- Do not hide structure inside rich-text attributes. Inline rich text is fine for emphasis/spans inside a heading; repeated items, forms, metrics, timelines, and data blocks are custom-block attributes saved by the block's `save()`.

**Styling priority (strict):**

1. Native block and block-support attributes in the tree: media URLs, overlay, focal points, min heights, `backgroundColor`, `textColor`, `gradient`, `style.background`/`.spacing`/`.color`/`.typography`/`.border`/`.dimensions`, `layout`, `align`, `className`, preset color/spacing/font attributes.
2. Custom-block attributes and style variations/classes for named editor-facing design choices.
3. `wordpress/blocks/<slug>/style.css` for scoped internals supports cannot express: pseudo-elements, nested form controls, sticky behavior, horizontal rails, overlapping children, responsive grids, ornaments, interaction states.
4. `wordpress/style.css` only for design tokens, document defaults, shared responsive rules, and page glue that cannot attach to a block.

Never solve parity by dumping `mockup/style.css` into `wordpress/style.css`. After serialization, read `reports/style-audit.json`: a good transform shows substantial `blocksWithSupportAttrs` usage and page CSS small enough to explain line by line.

## CSS-Transfer Gotchas

Check these BEFORE the first comparison; each has caused real repair iterations.

- **Inline `margin-top` does not remove the default bottom margin.** A mockup `<p>` with `margin-top:22px` still has the stylesheet's `p { margin: 0 0 1.1em }`. Translating to `margin: 22px 0 0` silently deletes the rhythm. Write `margin: 22px 0 1.1em` or set only `margin-top`.
- **The `.is-layout-constrained > *` full-width cascade.** WordPress constrains children of constrained-layout containers to `contentSize` via `.is-layout-constrained > *:not(.alignwide):not(.alignfull)`. `width: 100%` in CSS cannot beat it. A full-width hero/banner/CTA carries its width through `align: full` (with `layout` type `constrained` for centered inner content, or `default` on both outer and inner groups for edge-to-edge content). Fix it on the block's `align`/`layout`, not in CSS.
- **`core/button` puts the className on the WRAPPER div.** Visual button rules must target the actual control (`.wp-block-button.btn .wp-block-button__link`), never the wrapper, or borders/padding double up.
- **`core/quote` wraps text in a `<p>` the mockup may not have.** That inner paragraph inherits all your `p` rules and can wrap to a different line count. Scope `blockquote p { margin: 0; font-size: inherit; line-height: inherit; text-wrap: wrap; max-width: none; }`.
- **RichText re-wraps overflowing text in the editor.** RichText applies `white-space: pre-wrap; min-width: 1px` as an inline style on every editable element. Text the mockup lets overflow on one line (ghost display words, oversized numerals, clipped labels) stays one line on the frontend but letter-wraps in the canvas — an editor-only, viewport-dependent drift whose fingerprint is a height delta that is an exact multiple of one element's line-height. Fix: pin `white-space: nowrap !important` on those elements. The `!important` is mandatory because it must beat an inline style.
- **Empty inline elements do not survive WordPress.** A decorative `<span class="bar"></span>` in rich text passes every preview gate, but `wp_insert_post` tag-balancing eats the closing tag, swallowing following text and failing editor validation in stage 2. Express decorative bars/ornaments as CSS pseudo-elements on the parent instead.
- **A bare inline anchor sits on the parent's line strut**, not its own smaller line-height. Keep the wrapping paragraph at the parent font-size and style only the inner anchor; do not pin a fixed pixel line-height on the paragraph, or baseline rounding produces 1px offsets that cost 2-3% mismatch on text-heavy pages.

## Expected Output

A workspace with: `mockup/index.html`, `mockup/style.css`, `plan/block-plan.md`, `plan/block-plan.json`, `wordpress/block-tree.json` (or `wordpress/pages/*.block-tree.json`), `wordpress/content.html`, `wordpress/style.css`, `wordpress/blocks/*`, `rendered/rendered-blocks.html` (or `rendered/*.html`), `editor/block-editor.html` (or `editor/*.html`), and a passing `reports/comparison.json` per page. Hand this completed workspace to the `blocks-to-theme` skill.
