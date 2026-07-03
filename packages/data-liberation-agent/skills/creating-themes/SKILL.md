---
name: creating-themes
description: Guidelines for creating new WordPress block themes from scratch — load this before generating theme files
disable-model-invocation: true
---

## When to use me

Use this skill when creating a new theme from scratch.
Do not use this skill when modifying an existing theme.

## General Rules

Follow these rules carefully unless the user explicitly requests otherwise:

- **Focus on the home page first**: Create a beautiful, image-rich home page as the centerpiece of the initial theme. The home page should showcase the theme's aesthetic vision with compelling visuals, strong typography, and engaging layout. Put your creative energy here.
- **Minimal template set**: On initial theme creation, only create `index.html`. Avoid creating additional templates like `single.html`, `page.html`, `archive.html`, etc. unless the user specifically requests them. Keep the initial scope focused.
- **Patterns for landing pages**: When creating a theme that includes a landing page or multi-section home page, generate block patterns for each major section (hero, features, testimonials, FAQ, CTA, etc.) and compose them into the `index.html` template. This produces a richer, more polished result. Load the `generating-patterns` skill for detailed guidance.
- **Prefer templates over patterns for simple themes**: For minimal or single-purpose themes without a landing page, default to templates rather than patterns. Only create patterns when they add clear value.
- **Pattern visibility rule**: Every pattern you create must be included in a template so the user can immediately preview it. Patterns that exist only in the `patterns/` directory without being used in any template are hard to discover.
- **Footer credit**: Default to a minimal, neutral credit (or none at all). When rebuilding a user's site as a replica, do not insert third-party branding into the footer. If the user explicitly asks for a credit line, adapt the styling (font size, colors) to match the theme's design. Example:
  `<!-- wp:paragraph --><p>Powered by <a href="https://wordpress.org" target="_blank" rel="noopener noreferrer">WordPress</a></p><!-- /wp:paragraph -->`

## Generating Theme Instructions

- Always use the current working directory — do not create a subdirectory for the theme
- Always include style.css with the required WordPress theme header comment
- Always create a valid theme.json (version 3) as the central configuration
- Always create block templates in templates/ and template parts in parts/
- Never use emojis in any generated content — not in headings, paragraphs, button text, or any text
- Never close the final PHP tag in functions.php
- Guard functions with function_exists() checks
- Use `enqueue_block_assets` hook for fonts (not `wp_enqueue_scripts`) to ensure they load in both front-end and editor
- Define colors, typography, and spacing in theme.json — not in CSS where possible
- Make the theme FSE-compatible (Full Site Editing)
- For landing page themes, generate patterns for each section and compose them into templates
- For simple themes without a landing page, prefer templates over patterns unless the user explicitly requests them
- Keep functions.php minimal — enqueuing assets, registering patterns, and adding theme support

## Theme File Structure

```
style.css              # Required — theme header comment and base styles
theme.json             # Central configuration (colors, typography, spacing, layout)
functions.php          # Minimal — enqueue assets, register patterns, add theme support
templates/             # Block templates
  index.html           # Required — fallback template
  single.html          # Single post
  page.html            # Page
  archive.html         # Archive
  404.html             # Not found
  home.html            # Blog home (optional)
  search.html          # Search results (optional)
parts/                 # Reusable template parts
  header.html          # Site header
  footer.html          # Site footer
patterns/              # Block patterns for reusable sections
assets/                # Static assets (images, local fonts)
```

## style.css Header (required)

```css
/*
Theme Name: Theme Name
Theme URI: https://example.com
Author: Author Name
Description: Theme description
Version: 1.0.0
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 8.0
License: GNU General Public License v2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html
Text Domain: theme-slug
*/
```

## theme.json Essentials

- Use version 3
- Define settings: colors (palette), typography (fontFamilies, fontSizes), spacing (units, spacingSizes), layout (contentSize, wideSize)
- Define styles: global styles and block-specific overrides
- Use appearanceTools: true to enable border, typography, spacing, and color controls
- Register custom template parts with their area (header, footer, uncategorized)
- Use style variations to offer different design options
- Add custom block styles when needed to extend core blocks

## Fonts — self-host the source's real typefaces

When replicating a liberated site, **self-host the source's fonts** rather than substituting a Google Font or leaving a system fallback. The deterministic scaffold (`liberate_theme_scaffold`) already does this: it parses `@font-face` rules from the captured HTML/CSS, downloads the referenced font files into `assets/fonts/`, emits `@font-face` rules in `style.css`, and registers the family in `theme.json` `settings.typography.fontFamilies` with a `fontFace[]` (each entry's `src` is `file:./assets/fonts/<file>`). This is generic — capture whatever the source loads (e.g. Larsseit from a Shopify CDN), not a hardcoded family. Heading (display) and body families bind to the captured fonts; the display family is rebound to the real typeface even when the foundation recorded an open *substitute*. NEVER ship headings/body in a system fallback when the source font is self-hostable. Sanitize bogus captured line-heights (`0` / `0px`) to a sane default (e.g. `1.2`).

**Uncapturable fonts → free substitution (self-hosted).** Some source fonts can't be self-hosted: Adobe Typekit (`use.typekit.net` serves CSS only, no reachable woff), Monotype, or hashed builder family names. For these the scaffold AUTO-SUBSTITUTES to the closest FREE web font, downloads *that* font's woff2 into `assets/fonts/`, and binds the body/display family to it — so body copy renders in a real web font, never a bare `sans-serif`. The mapping table + gstatic URLs live in `src/lib/replicate/font-substitution.ts`; the human-readable starter table is in `skills/design-foundations/references/theme-tokens.md` (e.g. `quasimoda → Hanken Grotesk`, `Proxima Nova → Montserrat`, `Avenir → Inter`). Only genuinely uncapturable families are swapped — a self-hostable source font (e.g. Larsseit on a CDN) is always preferred. Verify the substitute computes live (body paragraphs report the substituted family).

## Header (replica) — source logo + primary nav, NEVER page-list

Build the site header from the SOURCE header, not WordPress's page list:

- **Logo:** the source's real logo image (a `core/image` / site-logo of the header `<img>`/SVG), not `wp:site-title` text and not a product image. **Localize it** — download the CDN logo into the theme `assets/` (or WP media) and reference it locally (`/wp-content/themes/<slug>/assets/<file>`); never hot-link the source CDN. The scaffold does this via `localLogoPath`.
- **Nav:** explicit `wp:navigation-link`s for the source's **top-level primary menu only**. NEVER use `wp:page-list` — it auto-lists every published WP page (Sample Page, Checkout, account, etc.) as junk. Drop mega-menu sub-links and the mobile-drawer duplicate from the menu.
- **Utility icons:** re-add the source header's search / account / cart icon cluster on the right (dropped from the *primary nav* but part of the chrome). Ship each glyph as a theme SVG asset (`assets/icon-*.svg`, explicit stroke color) referenced from a `core/image` link — NOT `wp:html` (banned). cart→`/cart`, account→`/account`, search→`/?s=`. The scaffold emits this.
- **Announcement bar:** preserve the source's top announcement/utility bar when present.

## Google Fonts (fallback only — prefer self-hosting source fonts above)

When a font is genuinely not self-hostable, use `enqueue_block_assets` hook (not `wp_enqueue_scripts`) to ensure fonts load in BOTH the front-end AND block editor:

```php
function theme_fonts() {
    wp_enqueue_style(
        'theme-fonts',
        'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
        array(),
        null
    );
}
add_action( 'enqueue_block_assets', 'theme_fonts' );
```

## Generating a landing page

- **YOU DECIDE** which sections/blocks best serve this specific site. Do not follow a rigid template.
  Consider the user site type and audience to determine the optimal page structure.
  Examples:
  - A portfolio might need a full-bleed project gallery
  - A SaaS might need feature grids
  - A restaurant might need a reservations widget
  - An agency might need case study cards
- **Always include a header and footer**, but the sections in between are your creative choice.
- Treat every block as a **self-contained section** (one dominant semantic wrapper) whose markup will live inside its own file.
- Keep copy **realistic but placeholder-friendly**; never reference real clients or brands.
- Favor **semantic HTML**, class-based styling hooks, and **shallow DOM trees** that respond well on mobile.
- **Section margin reset**: Add `"style":{"spacing":{"margin":{"top":"0"}}}` to every top-level Group block that wraps a landing page section. This overrides WordPress's default top margin on direct children of `.wp-site-blocks` and can be easily adjusted by users in the editor.
- **Section layout widths**: Hero sections, header groups, cover blocks, and feature grids should use `"align":"wide"` or `"align":"full"` rather than defaulting to narrow content width. Only use default (content) alignment for text-heavy reading sections.
- Do **not** use `<inner-blocks>`; output the full expanded markup inside each block.
- **No decorative HTML comments**: Never insert section-labeling comments like `<!-- Hero Section -->` or `<!-- Services Section -->` in templates, template parts, or patterns. Only WordPress block comments (`<!-- wp:block-name -->`) are allowed.
- Each site payload includes `<typography>` instructions.
  Apply those font stacks via **inline `style` attributes** (e.g.,
  `style="font-family: 'Space Grotesk', 'Helvetica Neue', sans-serif;"`) on the root wrapper and any hero/headline elements —
  **do NOT output `<style>` tags** (the build strips them).
- Prefer a **sticky nav** (`sticky top-0 z-50`) when appropriate, but ensure it degrades gracefully on mobile.
- Use **Tailwind motion utilities** (`transition`, `duration-300`, `motion-safe:animate-fade`, `scroll-mt-24`, etc.) to add gentle entry animations and interactive feedback without custom JavaScript.
- Be **bold with layout choices**. Use asymmetric grids, overlapping elements, creative whitespace, and distinctive visual treatments.

## Reference Files

Before generating theme files, read the relevant references from the `references/` directory next to this skill file.

- **`references/block-html.md`** — REQUIRED: read this FIRST. Block HTML validity rules, block comment ↔ HTML matching, image/cover/button block structure. Violating these causes "unexpected or invalid content" errors.
- **`references/design-direction.md`** — REQUIRED: read this before generating any theme files. Contains guidelines and good design directions.
- **`references/navigation.md`** — read this before generating any header template part, covers `wp:navigation` block markup, overlay (hamburger menu)
- **`references/query-loop.md`** — read this if the theme must display dynamic content (blog posts, archives, search results) in templates or patterns
