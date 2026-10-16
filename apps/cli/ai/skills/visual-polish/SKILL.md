---
name: visual-polish
description: Verify and polish a built or redesigned site by diagnosing rendered-DOM defects against intent, fixing them in one planned batch, and re-checking what changed.
---

# Visual Polish

Use this skill to verify a built or redesigned site and fix the design issues that make generated sites feel unpolished. The generated block markup, the editor serialization fixes from `validate_blocks`, and WordPress's own injected layout classes mean the rendered page often differs from what you intended. This skill closes that gap.

The core method is **diagnose from evidence, not from memory**. Do not guess why something looks wrong from the screenshot alone — the rendered DOM usually differs from the markup you wrote. Read the real DOM with `inspect_design`, find the actual cause, then fix it.

## Scope: which pages to polish, and what to fix

Polish **every page of the site**, not just the home page. This includes all user-created pages (Home, About, Contact, and similar) and any plugin-provided pages. A page the user never sees polished feels unfinished, and plugin pages ship with generic default styling that rarely matches the theme.

For a WooCommerce shop, polish each of these pages: Shop, single-product, Cart, Checkout, and My Account, checking the space around `main` on each.

Polish fixes **defects**, where the rendered page departs from what was intended (`DESIGN.md`, the layout map): broken layout, overflow, unreadable text, misaligned or doubled spacing, broken images or hover states. Fix each with the smallest change that removes it. Polish does not add motion, scripts, or sections, and does not redesign a section: those belong to the build.

## Method: one diagnosis, one batch of fixes, one re-check

The most important rule: **do not fix issues one at a time as you find them.** Fixing reactively makes you miss related issues, introduce regressions, and burn expensive screenshot passes. Take each page through these phases once.

### Phase 1 — Diagnose (read-only — make NO edits in this phase)

1. Enumerate every section and component of the page (from the page markup you wrote, or by inspecting the top-level containers).
2. If you can view images, take one `take_screenshot` with `viewport: "all"` (desktop + mobile). A model that cannot view images skips this step: `inspect_design` is then the whole diagnosis, so the sweep below must be complete rather than guided by what looks wrong.
3. Go **section by section**. For each, call `inspect_design` on the relevant selectors and compare the rendered DOM and computed styles against your intent and the theme's `style.css` (read it). The screenshot is the symptom; `inspect_design` is the cause — never diagnose from the screenshot alone, because subtle issues like doubled button padding barely show in pixels. Inspect even sections that look roughly right, and always inspect:
   - the header and footer template parts and every section wrapper — width, centering, and horizontal padding,
   - every button, with `includeHover: true`,
   - every box that paints its own background or border — text must not touch its edges,
   - every image — that it renders, fills its slot, and keeps overlaid text legible.
4. List the **complete** set of issues before fixing anything — a concise checklist, one short line per issue: the section, the root cause from the DOM, and the exact fix (file, selector, change). A list, not prose.

Do not make a single edit until you have diagnosed every section and listed every issue. **A complete diagnosis is the gate into Phase 2.**

### Phase 2 — Fix the whole batch

Work through the plan with targeted `Edit` calls: one file per turn, with all of that file's fixes as separate entries of one `Edit` call, per the system prompt cadence — never batch files into one turn. Do **not** screenshot or inspect between edits. If an edit changes block markup (not just CSS), re-run `validate_blocks` on that file and re-check its diff, since the serializer can change classes again.

### Phase 3 — Re-check what changed

After the whole batch, take one `viewport: "all"` screenshot — or, when you cannot view images, re-run `inspect_design` on the selectors you changed, and only those. Check each plan item off and look for regressions the fixes introduced; this is not a new diagnosis.

On the home page only, if an item is still broken or the batch broke something, make one follow-up batch for exactly those items and do not check it again. The page is then done: no further edits, no further captures, and never a return to Phase 1.

The home page's last capture is the theme screenshot, even when a follow-up batch came after it. When you cannot view images, that is the only capture you take: one desktop capture of the home page after its last edit.

## Finding the cause

When the rendered DOM differs from intent, the cause is in code on disk: your markup, the theme's `theme.json` and `style.css`, or the CSS WordPress generates. Find the selector that wins in the `inspect_design` output, then grep for it — in the theme, in `wp-includes/block-supports/` (layout, spacing, alignment), in `wp-includes/class-wp-theme-json.php`, and in the block's `wp-includes/blocks/<block>/` files — and read why it applies. Fix at that source with the structured channel that owns it (block markup, `theme.json`, a registered block style), not with a CSS override that fights it.

## Notes

- Fix in markup, `theme.json`, or the theme's `style.css` — no custom stylesheets.
- The site must be running for `take_screenshot` and `inspect_design`.
