You are generating the `style.css` file for a WordPress block theme that is part of a generated site. The site is split into two packages: a pure-presentation THEME (where this file lives) and a separate companion plugin that holds all behavior (custom post types, REST routes, custom blocks). This `style.css` is THEME-side presentation only — design CSS, never behavior.

Write the file to disk at `<site>/wp-content/themes/<slug>/style.css`. The site spec JSON and the chosen design direction are appended after these instructions, plus the specific task line for this call. The theme's `theme.json` has already been generated and is the single source of truth for design tokens: use its color slugs, font-family slugs, font-size slugs, and spacing slugs. Do NOT introduce new design tokens or pick colors/sizes/fonts that aren't defined there. Do NOT redefine in CSS what `theme.json` already exposes.

Fonts are declared in `theme.json` via `settings.typography.fontFamilies` with `fontFace` entries — they are NOT enqueued from PHP and NOT `@import`ed here. Reference them only through the generated custom properties (e.g. `var(--wp--preset--font-family--body)`). Do not add `@font-face` rules or font CDN imports in this file.

## File header

`style.css` MUST start with the standard WordPress theme header comment block, in this order: Theme Name, Theme URI, Author, Author URI, Description, Version, Requires at least, Tested up to, Requires PHP, License, License URI, Text Domain, Tags. The tool injects the real Theme Name / Text Domain / slug values, but you must emit the full header structure with sensible defaults filled from the site spec (Description from the site's purpose; Tags such as `full-site-editing, block-styles, blog` chosen to match the site type; `Requires at least: 6.5`, `Tested up to: 6.7`, `Requires PHP: 7.4`, `License: GNU General Public License v2 or later`, `License URI: http://www.gnu.org/licenses/gpl-2.0.html`). Start the file literally with `/*`.

## What this file is for

After the header, emit focused design CSS that the block editor cannot express through `theme.json` alone. Reference tokens via CSS custom properties — `var(--wp--preset--color--primary)`, `var(--wp--preset--font-family--heading)`, `var(--wp--preset--font-size--large)`, `var(--wp--preset--spacing--40)` — never hardcoded hex/px values where a token exists. Scope:

- A small `:root` block that maps the design's own semantic CSS variables onto theme.json preset variables, so the rest of the stylesheet reads cleanly (e.g. `--accent: var(--wp--preset--color--accent);`, `--rhythm: var(--wp--preset--spacing--40);`). Define only variables you actually use below.
- Typography polish that goes beyond theme.json: heading letter-spacing and line-height refinements, balanced/pretty text-wrap on headings, optical margin tweaks, link underline styling and hover transitions.
- Button variants and link styles tuned to the design's aesthetic.
- Image treatments (object-fit, aspect ratios on figures, subtle border-radius if the design calls for it, duotone-free hover scale).
- The loop/layout utility classes (below) that templates and patterns rely on.
- Animation helpers using progressive enhancement (below).
- Header scroll-state CSS (below).
- A `@media (prefers-reduced-motion: reduce)` block (below).

Let the design direction drive the polish: a warm/editorial direction gets generous spacing, serif-forward refinement, and slow transitions; an industrial/brutalist direction gets tight tokens, hard edges, and snappy transitions. Anchor every choice in the picked design's palette and rhythm. No emojis anywhere. No decorative comments — only short section-label comments are acceptable; never narrate.

## Block-markup CSS conventions (the templates and patterns follow these — match them)

Custom classNames live ONLY on the outermost block wrapper (set via the block `className` attribute), never on inner DOM. So your selectors hook the WordPress-generated outer class, e.g. `.wp-block-group.site-header`, `.wp-block-query.is-style-loop-rail`, not invented inner-element classes. Full-bleed sections are an outer `wp:group` with `align: full` (`.alignfull`). Never style by tag-stripping the structure; target the block's wrapper class plus standard `.wp-block-*` descendants.

## Loop layout utilities (mandatory — emit exactly these classes)

The page templates and patterns compose `wp:query` blocks in several layout shapes (rail, list, zigzag, timeline, magazine) and reference the named utility classes below. You MUST include this block in every `style.css` you generate, exactly as shown — the templates are generated in parallel and you cannot see their markup, so these hooks must always exist. Tune colors and spacing to theme.json tokens where indicated, but keep the selectors and the structural CSS as-is. Do not rename anything.

```css
/* ---------- Loop layout utilities ---------- */
/* Wired to the wp:query blocks emitted by pages and templates. Do not rename.
   Tune colours and spacing to theme.json tokens. */

/* Horizontal scrollable rail */
.wp-block-query.is-style-loop-rail .wp-block-post-template {
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: thin;
    padding-bottom: var(--wp--preset--spacing--20);
}
.wp-block-query.is-style-loop-rail .wp-block-post-template > * {
    flex: 0 0 320px;
    scroll-snap-align: start;
}

/* Compact list with hairline row dividers */
.wp-block-query.is-style-loop-list .wp-block-post-template > * {
    border-bottom: 1px solid var(--wp--preset--color--border, currentColor);
    padding-block: var(--wp--preset--spacing--30);
}
.wp-block-query.is-style-loop-list .wp-block-post-template > *:last-child {
    border-bottom: 0;
}

/* Zigzag — flip the columns inside every even entry */
.wp-block-query.is-style-loop-zigzag .wp-block-post-template > *:nth-child(even) .wp-block-columns {
    flex-direction: row-reverse;
}

/* Timeline — vertical line with node markers per entry */
.wp-block-query.is-style-loop-timeline .wp-block-post-template {
    position: relative;
    padding-inline-start: 2.5rem;
}
.wp-block-query.is-style-loop-timeline .wp-block-post-template::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0.5rem;
    width: 2px;
    background: currentColor;
    opacity: 0.15;
}
.wp-block-query.is-style-loop-timeline .wp-block-post-template > * {
    position: relative;
}
.wp-block-query.is-style-loop-timeline .wp-block-post-template > *::before {
    content: '';
    position: absolute;
    inset-inline-start: -2.25rem;
    inset-block-start: 0.6rem;
    width: 1rem;
    height: 1rem;
    border: 2px solid currentColor;
    border-radius: 50%;
    background: var(--wp--preset--color--background, #fff);
}

/* Magazine — first child spans 2 columns of the grid */
.wp-block-query.is-style-loop-magazine .wp-block-post-template > *:first-child {
    grid-column: span 2;
}
@media (max-width: 600px) {
    .wp-block-query.is-style-loop-magazine .wp-block-post-template > *:first-child {
        grid-column: auto;
    }
}
```

Keep this block intact. If `--wp--preset--color--border` does not exist in this theme's palette, the `currentColor` fallback already handles it — do not delete the rule.

## Background/text-color pairing (invisible-text guard)

Wherever this stylesheet sets a `background` or `background-color`, it MUST also set a matching `color` so text never becomes invisible against the new surface. This mirrors the block-markup rule (any block that sets `backgroundColor` also sets `textColor`); apply it in CSS too — every surface rule pairs background and color from the same palette family, with sufficient contrast.

## Animation helpers (progressive enhancement — CSS defines the FINAL visible state)

Scroll and entrance animations follow progressive enhancement so the page is fully legible with JavaScript disabled and inside the block editor: CSS defines the FINAL, visible resting state, and the companion plugin's plain-JS enhancement script adds the INITIAL hidden state at runtime (e.g. by toggling a `js-anim-ready` class on `<html>` or adding per-element initial styles) and then transitions elements to the CSS-defined visible state as they enter the viewport via `IntersectionObserver`.

Therefore in this file:

- Define reveal targets in their VISIBLE end state: `opacity: 1`, `transform: none`, full visibility. NEVER ship `opacity: 0` as the base rule for content — that would leave sections blank if JS never runs and blank inside the editor.
- Gate the hidden start state behind the JS-added readiness class, e.g. `.js-anim-ready .reveal-on-scroll { opacity: 0; transform: translateY(1.5rem); }` and `.js-anim-ready .reveal-on-scroll.is-visible { opacity: 1; transform: none; }`, with a `transition` on the element. Use stable hook class names (`reveal-on-scroll`, `is-visible`) that the companion plugin's enhancement script can target; these classes are applied via the block `className` attribute on outer wrappers.
- Keep transitions tasteful and tuned to the design (duration, easing). The JS lives in the companion plugin (plain JS, standard DOM APIs, IntersectionObserver), not in the theme — do not write or reference any JS here.

## Header scroll-state

The header is rendered by a header template part as `<header class="wp-block-template-part">`, a direct child of `.wp-site-blocks`. Sticky/fixed positioning goes on that `.wp-block-template-part` wrapper, never on the inner group (the wrapper's height equals the inner group's height, so sticky on the inner group is visible for 0px of scroll). Choose positioning from the site spec's header behavior:

- Overlay hero (header floats over a full-viewport hero): `position: fixed; top: 0; left: 0; right: 0; z-index: 100;` on `.wp-site-blocks > header.wp-block-template-part`. Do not add `padding-top` to main — the hero is intentionally full height beneath it.
- Sticky, non-overlay: `position: sticky; top: 0; z-index: 100;` on the same wrapper.
- Static: no positioning rule.

Scrolled-state chrome: the companion plugin's enhancement script toggles `body.is-scrolled` on the frontend (it never toggles in the editor, so editor-canvas legibility is preserved). Paint the scrolled background on a `::before` pseudo-element of the header — NEVER on the header element itself — so the header does not become a containing block that would trap the mobile navigation overlay's `position: fixed; inset: 0`:

```css
.wp-site-blocks > header.wp-block-template-part::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    transition: background 0.4s ease, backdrop-filter 0.4s ease, -webkit-backdrop-filter 0.4s ease;
}
body.is-scrolled .wp-site-blocks > header.wp-block-template-part::before {
    background: var(--wp--preset--color--<contrast-slug>);
    box-shadow: 0 1px 0 var(--wp--preset--color--<rule-slug-or-rgba>);
}
```

Pick `<contrast-slug>` as a palette slug that separates the header from the body content scrolling beneath it — do NOT use `--wp--preset--color--background`, since that equals the body color and yields zero contrast (an invisible header). For dark-chrome/light-body designs pick the design's dominant dark surface slug; for light-chrome/dark-body designs pick the lightest near-white slug. If the header's load-time text color does not also contrast with the scrolled background, add `body.is-scrolled .site-header { color: var(--wp--preset--color--<legible-slug>); }` and a matching navigation-link color rule so the wordmark and nav stay legible. For a translucent/blur variant, use `background: color-mix(in srgb, var(--wp--preset--color--<contrast-slug>) 80%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);` on the pseudo-element. If the design specifies no scrolled background, omit both pseudo-element rules.

Shrink-on-scroll (only if the spec asks for it): put the transition and the shrunk padding on the inner group's class (e.g. `.site-header`), keyed off `body.is-scrolled` — the sticky/fixed behavior stays on the `.wp-block-template-part` wrapper.

Overflow ancestors break sticky: if a sticky header or element fails, ensure no ancestor (`body`, `.wp-site-blocks`, intermediate groups) has a non-`visible` overflow.

## Mobile navigation overlay

The mobile navigation overlay surface (`.wp-block-navigation__responsive-container.is-menu-open`) renders with raw WordPress defaults unless styled — items butted against the viewport edge. Style it to match the design: pad the open container, set the menu container gap and `align-items: flex-start`, and bump the item font size. Use spacing slugs that match the design's rhythm (tight tokens like `spacing--20`/`spacing--30` for industrial; generous like `spacing--50`/`spacing--60` for editorial):

```css
.wp-block-navigation__responsive-container.is-menu-open {
    padding: var(--wp--preset--spacing--<container-spacing>) var(--wp--preset--spacing--<gutter-spacing>);
}
.wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation__container {
    gap: var(--wp--preset--spacing--<item-gap>);
    align-items: flex-start;
}
.wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation-item__content {
    font-size: var(--wp--preset--font-size--large);
}
```

## Reduced motion (mandatory)

End the design CSS with a `@media (prefers-reduced-motion: reduce)` block that neutralizes every animation, transition, and scroll-driven transform you introduced: set `animation: none`, `transition: none`, and force reveal targets to their visible resting state (`opacity: 1; transform: none;`). This is non-negotiable — every animation you write above must be answered here.

```css
@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
    .js-anim-ready .reveal-on-scroll {
        opacity: 1;
        transform: none;
    }
}
```

## Out of scope (do not emit)

- No `@font-face` / font imports (fonts come from theme.json).
- No JavaScript, and no rules that depend on JS-toggled classes existing at page load other than the documented `body.is-scrolled` and `.js-anim-ready` hooks (everything has a JS-off visible fallback).
- No custom post type, REST, or block CSS that belongs to the companion plugin's own assets — keep this to theme presentation.
- No base reset/normalize or wholesale re-skinning of core blocks that theme.json already controls.

Output ONLY the raw file content — no markdown code fences, no commentary, no explanation.
