---
name: theme-development
description: Structure of a WordPress block theme — theme.json depth, FSE templates and template parts, navigation, query loops, patterns, font loading, style variations, and wiring custom blocks into a theme. Load before building or editing a theme's structure.
user-invokable: false
---

# Theme Development

Use this skill before building or editing the **structure** of a WordPress block theme: `theme.json`, templates and template parts, navigation, query loops, patterns, fonts, and wiring custom blocks into the theme.

Stay in your lane — this skill owns theme structure, not the other concerns:

- For the aesthetic **direction** (which palette, typography, and concept, and why), load `visual-design`. Do not decide aesthetics here.
- For editable block **markup** rules (the `core/html` policy, palette slug usage, button targeting, full-bleed vs constrained layout), load `block-content`. Do not restate those rules here.
- For authoring a brand-new custom block type, load `custom-blocks`.

## theme.json (version 3)

`theme.json` is the theme's structural source of truth. Set these deliberately rather than leaving defaults:

- **Layout**: `settings.layout.contentSize` of `800px`–`900px` for comfortable reading (not the ~640px default), and `settings.layout.wideSize` of `1200px`–`1400px` for `wide` blocks.
- **Appearance tools**: `settings.appearanceTools: true` to expose border, spacing, typography, and color controls in the editor.
- **Type scale**: define `settings.typography.fontSizes` as a contained scale, roughly `0.875rem / 1rem / 1.25rem / 1.75rem / 2.25rem` plus one fluid `clamp()` display size capped around `3.5rem`. Do not let display sizes run unbounded.
- **Line height**: set `styles.typography.lineHeight` around `1.5`–`1.65` for body and `styles.elements.heading.typography.lineHeight` around `1.1`–`1.3` for headings. Never below `1.0`.
- **Spacing**: define `settings.spacing.spacingSizes` presets and apply them as `var:preset|spacing|<slug>` tokens rather than ad-hoc values, so spacing stays consistent and editable.
- **Template parts**: register parts in `templateParts` with an `area` of `header`, `footer`, or `uncategorized`.

The color **palette** lives in `settings.color.palette` but is owned by `visual-design` (which decides it) and `block-content` (which explains slug usage) — define it there, reference it by slug, and do not duplicate palette rules in this skill.

## Templates and template parts

A block theme is driven by HTML templates and parts under FSE:

- `templates/` holds page templates. `index.html` is required; add `single.html`, `page.html`, `archive.html`, `search.html`, `404.html`, `home.html`, and `front-page.html` only as the site actually needs them.
- `parts/` holds reusable template parts. `header.html` and `footer.html` are required; add others as needed.
- Design the home page first as the centerpiece; do not pre-build templates the site does not yet need.

Markup conventions:

- Write **WordPress block delimiter comments only** (`<!-- wp:... -->`). No decorative HTML comments — see `block-content` for the full policy.
- **Reset the top margin on section groups.** Add `"style":{"spacing":{"margin":{"top":"0"}}}` to every top-level `core/group` that wraps a landing-page section, or WordPress's default block top margin leaves an unwanted gap above the first section.
- Use `"align":"wide"` or `"align":"full"` on heroes, covers, and feature sections. The full-bleed vs constrained layout rules live in `block-content`'s Layout Cascade — follow them, do not restate them.
- Favor semantic HTML, a shallow DOM, and class-based styling hooks for responsive behavior.
- The header part is a full-width constrained `core/group` containing `core/site-title` and a `core/navigation` block (see Navigation block below).

## functions.php

Keep `functions.php` minimal and safe:

- Never close the final `?>` tag.
- Guard every function declaration with `function_exists()` and use a unique theme prefix.
- Limit its scope to enqueuing assets, registering patterns, and adding theme support.

## Font loading

- Enqueue theme fonts on the **`enqueue_block_assets`** hook so they load in both the front end and the block editor (using `wp_enqueue_scripts` alone leaves the editor unstyled).
- For web fonts, request them with `display=swap`. For local fonts, place the files under `assets/` and enqueue with `wp_enqueue_style()`.

```php
function mytheme_fonts() {
	wp_enqueue_style(
		'mytheme-fonts',
		'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&display=swap',
		array(),
		null
	);
}
add_action( 'enqueue_block_assets', 'mytheme_fonts' );
```

Pick distinctive, characterful fonts per the concept from `visual-design` rather than generic system fonts.

## Style variations

Offer alternate looks with global style variations: add JSON files under `styles/` (for example `styles/dark.json`) that override colors, typography, or spacing. Users can switch between them in the editor without changing the base `theme.json`.

## Navigation block

The `core/navigation` block renders its own responsive overlay via the Interactivity API — you do **not** write JavaScript for open/close, focus trapping, or Tab/Escape handling.

- Key attributes: `overlayMenu` (`"mobile"` default, `"always"`, or `"never"`), `overlayBackgroundColor` and `overlayTextColor` (palette slug or custom hex), `textColor`, `backgroundColor`, `showSubmenuIcon`, `maxNestingLevel`, and `layout`.
- **Set both overlay colors together.** If you set `overlayBackgroundColor` without `overlayTextColor` (or vice versa), the open mobile menu renders invisible text. Always provide the pair.
- WordPress toggles state classes automatically: `is-menu-open` on the container, `has-modal-open` on `<html>`, plus `hidden-by-default` / `always-shown`; the overlay sits at `z-index: 100000`.
- Allowed inner blocks: `core/navigation-link`, `core/navigation-submenu`, `core/home-link`, `core/page-list`, `core/search`, `core/social-links`, `core/site-title`, `core/site-logo`, `core/loginout`, `core/buttons`, `core/spacer`, `core/icon`.

## Query loop

Use `core/query` for post listings. Its structure is strict:

- Inside `core/query`, place `core/post-template` (the repeater — it may contain only post blocks such as title, date, featured image, excerpt, terms, author, content), plus optional siblings `core/query-pagination` (containing `core/query-pagination-previous`, `core/query-pagination-numbers`, `core/query-pagination-next`), `core/query-no-results`, and `core/query-title`.
- `inherit: true` uses the main `$wp_query` — use it for archive, search, and category templates, and only once per page. `inherit: false` runs an independent query with explicit parameters — use it for curated sections.
- Non-obvious parameter formats: `taxQuery` is `{"category":[1,5]}` (not a nested `tax_query` array); `sticky` is `""` (include), `"only"`, or `"exclude"`; `perPage: null` falls back to the site's "Blog pages show at most" setting; `enhancedPagination: true` enables AJAX page loads (WP 6.4+).

## Patterns

Block patterns are reusable section markup stored as PHP files under `patterns/`. Each begins with a header comment:

```php
<?php
/**
 * Title: Hero Split
 * Slug: mytheme/hero-split
 * Categories: featured, banner
 * Keywords: hero, split, cta
 */
?>
```

- The `Slug` must be namespaced to the theme text domain (`mytheme/pattern-name`). Useful `Categories`: featured, banner, text, gallery, call-to-action, about, team, testimonials, contact, footer, header.
- **Every pattern must be referenced in a template.** A pattern that lives only in `patterns/` is undiscoverable — compose it into a template (usually the home page) so it actually renders.
- A landing page typically runs: hero → social proof / logo bar → feature grid → content with media → testimonials or case studies → FAQ → final CTA. Adapt the sequence to the site type (portfolio, SaaS, restaurant, agency, blog, e-commerce).
- **CTAs**: include at least two per landing page (one in the hero, one in the closing section). Use `core/buttons` with action-oriented labels ("Get Started", "Book a Demo", "View Portfolio") in the theme accent color with generous padding. Avoid vague labels like "Click here".
- Layout recipes: hero split (55/45 or 60/40 columns, text vertically centered, image with `object-fit: cover`); Z-pattern (alternate text/image side across sections with alternating light/dark backgrounds); feature grid (equal columns via an `equal-cards` class); sticky CTA (fixed bar, `z-index: 50`); logo bar (evenly spaced, grayscale or muted).

## Wiring custom blocks into a theme

When a theme includes a bespoke block (authored per the `custom-blocks` skill), integrate it into the theme rather than leaving it standalone:

- Place each block under `blocks/<block-name>/` at the theme root, with its `block.json`.
- Set the block's `block.json` `name` to the theme namespace: `mytheme/block-name`.
- Verify the `block.json` asset paths (`editorScript`, `editorStyle`, `style`, `script`, `viewScript`, `viewScriptModule`, `render`) resolve from the new location, and that any `render.php` `__DIR__` paths still hold.
- Register the blocks from `functions.php` on `init` with `register_block_type( __DIR__ . '/blocks/<name>' )`; prefer a glob over the `blocks/` directory so new blocks register automatically.
- Remove orphaned standalone files left behind by the move.

Studio compiles block source — author normal `src/` files and let the build run; do not avoid or hand-roll the build step.
