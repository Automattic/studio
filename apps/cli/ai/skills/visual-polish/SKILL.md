---
name: visual-polish
description: Verify and polish a built or redesigned site by diagnosing rendered-DOM issues against intent and fixing them in a planned, batched screenshot-and-fix loop.
user-invokable: true
---

# Visual Polish

Use this skill to verify a built or redesigned site and fix the design issues that make generated sites feel unpolished. The generated block markup, the editor serialization fixes from `validate_blocks`, and WordPress's own injected layout classes mean the rendered page often differs from what you intended. This skill closes that gap.

The core method is **diagnose from evidence, not from memory**. Do not guess why something looks wrong from the screenshot alone — the rendered DOM usually differs from the markup you wrote. Read the real DOM with `inspect_design`, find the actual cause, then fix it.

## Scope: which pages to polish, and how much

Polish **every page of the site**, not just the home page. This includes all user-created pages (Home, About, Contact, and similar) and any plugin-provided pages. A page the user never sees polished feels unfinished, and plugin pages ship with generic default styling that rarely matches the theme.

For a WooCommerce shop, polish each of these pages: Shop, single-product, Cart, Checkout, and My Account, checking the space around `main` on each.

How much to iterate depends on the page:

- **Home page** — run the full loop below, including Phase 3 (re-diagnose and fix again, up to the pass cap). The home page is the highest-traffic, highest-impact page and is worth iterating until it is right.
- **Every other page** (other user pages AND WooCommerce pages) — run a **single pass**: diagnose (Phase 1), fix the batch (Phase 2), take one verification screenshot, then move on. Do not loop these pages; a single diagnose-and-fix pass is enough.

## Method: diagnose the whole page first, then fix in one batch

The most important rule: **do not fix issues one at a time as you find them.** Fixing reactively makes you miss related issues, introduce regressions, and burn expensive screenshot passes. Split the work into strict phases.

### Phase 1 — Diagnose (read-only — make NO edits in this phase)

1. Enumerate every section and component of the page (from the page markup you wrote, or by inspecting the top-level containers).
2. Take one `take_screenshot` with `viewport: "all"` (desktop + mobile).
3. Go **section by section**. For each, call `inspect_design` on the relevant selectors and compare the rendered DOM and computed styles against your intent and the theme's `style.css` (read it). The screenshot is the symptom; `inspect_design` is the cause — never diagnose from the screenshot alone, because subtle issues like doubled button padding barely show in pixels. Inspect even sections that look roughly right, and always inspect:
   - every section wrapper — for width and centering,
   - every button — BOTH `.wp-block-button` and `.wp-block-button__link`, with `includeHover: true`.
4. List the **complete** set of issues before fixing anything — a concise checklist, one short line per issue: the section, the root cause from the DOM, and the exact fix (file, selector, change). A list, not prose.

Do not make a single edit until you have diagnosed every section and listed every issue. **A complete diagnosis is the gate into Phase 2.**

### Phase 2 — Fix the whole batch

Work through the plan with targeted `Edit` calls (one `Write`/`Edit` per turn, per the system prompt cadence — never batch files into one turn). Do **not** screenshot between edits. If an edit changes block markup (not just CSS), re-run `validate_blocks` on that file and re-check its diff, since the serializer can change classes again.

### Phase 3 — Verify and loop

After the whole batch, take one `viewport: "all"` screenshot. Check each plan item off and look for regressions the fixes introduced.

This looping phase applies to the **home page only** (see "Scope" above). For every other page — including WooCommerce pages — stop after this single verification screenshot; do not loop. For the home page, each pass is expensive, so cap the cycle at **5 passes**. If issues remain and you are within that budget, return to Phase 1 for what's left — re-diagnose the remaining issues with `inspect_design`, don't fix blind.

## Recurring issues and what to inspect

The issues below are common examples, **not an exhaustive list**. Treat them as a starting checklist, not the full scope of what to look for — fix every visual problem the screenshot reveals, including ones not listed here, and apply the same method (inspect the rendered DOM, find the real cause, then fix). For each, the cause lives in the DOM — inspect, don't guess.

### Section width or centering is off

Symptom: a section meant to be full-width renders in the narrow content column; a section is wider/narrower than intended; or a section's content sits off-center instead of centered.

Inspect the section wrapper. Check `boundingBox` (`x` and `width`) against `viewportWidth`, and read the `ancestors` chain plus the `margin-left`/`margin-right` computed values. WordPress constrains children of constrained-layout containers via `.is-layout-constrained > *:not(.alignfull):not(.alignwide)`, which custom CSS like `width: 100%` cannot override — and a constrained layout is also what centers inner content (via auto inline margins). For a full-width section with centered content, the outer group needs `{"align":"full","layout":{"type":"constrained"}}`. When width or centering is wrong, the cause is the `align`/`layout` on the block markup (or custom margins/widths fighting the layout) — fix it in the markup, not by forcing width or margins in CSS.

That markup fix only works if the theme declares a content width. If a constrained section still spans the full container after you set it, check the theme's `theme.json` for `settings.layout.contentSize` — with no `contentSize` and no `wideSize`, WordPress emits no `max-width` at all for constrained layouts and the block markup cannot fix it. Declare the widths in `theme.json`, not per-section `max-width` in CSS.

### Button styling is doubled or on the wrong element

Symptom: a button looks too big (doubled padding), its background/border/radius is wrong, or it has two conflicting hover effects.

The button block is **two nested elements**: the `.wp-block-button` wrapper and, inside it, the `.wp-block-button__link` — the actual `<a>`/`<button>`, also carrying `.wp-element-button`. WordPress core applies the button's padding, background, border, and radius to the inner `.wp-block-button__link` / `.wp-element-button`, NOT the wrapper. Your CSS must target that same inner element so it **overrides** the default instead of stacking a second padded box on the wrapper.

The common trap: a custom `className` on a button block lands on the **wrapper** (`.wp-block-button.your-class`), not the link. So `.your-class { padding … }` styles the wrapper, on top of WP's default padding on the inner link — doubled box. Descend to the inner element instead: `.your-class .wp-element-button`.

For **global** button styling (consistent buttons site-wide), target `.wp-element-button` in `style.css`. WordPress puts that class on the inner styled element of every button — the button block and buttons from other blocks (search, file, etc.) — so one rule covers them all and overrides cleanly.

Inspect BOTH selectors with `includeHover: true` and compare their computed styles:

- If padding/background/border is set on BOTH the wrapper and the link, the button renders with **doubled padding and looks too big** — remove that styling from the wrapper (or its custom class) and put it on `.wp-element-button` / `.wp-block-button__link`.
- There must be exactly ONE hover rule, on the inner element (`.wp-element-button:hover` or `.wp-block-button__link:hover`), never the `.wp-block-button` wrapper. If both have hover styles you get **two conflicting hover effects** — delete the wrapper hover. Use the `hover` block in the inspect output to confirm only the inner element changes.

### Spacing between blocks differs from intent

Symptom: gaps between paragraphs, headings, or sections are larger or smaller than the CSS suggests.

Vertical rhythm is owned by WordPress layout CSS, not your margins: `:where(.is-layout-flow) > * + *` applies `margin-block-start: var(--wp--style--block-gap)`. Inspect the container and the adjacent blocks — read `customProperties["--wp--style--block-gap"]` and the `margin-top`/`margin-bottom` computed values. If block-gap is fighting your margins, set spacing through `theme.json` `spacing.blockGap` or the block's own spacing, or override knowing that exact selector.

### Backgrounds inside grids/columns are wrong

Symptom: a column or grid cell background doesn't appear, doesn't fill the cell, or sits on the wrong element.

Inspect `.wp-block-column` (or the grid cell) and any inner `core/group` you put the background on. Check which node's `background-color`/`background-image` is set and whether its `boundingBox` actually fills the cell. A background on an inner group only covers its content height; to fill the cell, the color belongs on the column/cell node. Columns are flex items — confirm `align-items`/stretch behavior matches intent.

## Notes

- Fix in markup or `style.css` per the `block-content` skill rules — no inline styles, no custom stylesheets, no custom classes on inner DOM elements.
- The site must be running for `take_screenshot` and `inspect_design`.
