---
name: theme-architecture
description: WordPress block-theme architecture for full site generation — theme = pure presentation, the layout-mode and content-mode taxonomy, theme.json/templates/parts conventions, and theme invariants. Load before planning or generating theme files.
---

# Theme Architecture

Use this skill before planning a site's structure or writing any theme file (`theme.json`, `style.css`, templates, parts, `functions.php`). It defines how a generated WordPress block theme is shaped, which files to emit, and the invariants every file must hold.

## The two-package model (read first)

A generated site is **two packages**, never one:

1. **A pure presentation theme** at `<site>/wp-content/themes/<slug>/`. It holds look and layout ONLY: `theme.json`, `style.css`, `templates/`, `parts/`, `patterns/` (rare), `assets/`, and a deliberately minimal `functions.php`.
2. **A companion plugin** at `<site>/wp-content/plugins/<slug>-functionality/`. It holds ALL behavior: custom post types + taxonomies + post meta, REST API routes, and custom Gutenberg blocks.

This split is non-negotiable. Behavior moved into the theme breaks on theme switch and pollutes presentation; presentation moved into the plugin is unreachable in the Site Editor. When you catch yourself about to register a CPT, a REST route, or a block inside the theme, **stop** — that work belongs in the companion plugin. Load the `companion-plugin` skill for how to build it.

What the theme MUST NOT contain:

- No custom post types, taxonomies, or post meta.
- No REST API routes.
- No block registration (`register_block_type`) and no custom block source.
- No content seeding — no `wp_insert_post` loops, no `content/*.html` files, no `after_switch_theme` seeders. Content is seeded into the live database (next section).
- No font enqueue file (`fonts.php`) and no `wp_enqueue_style` for Google Fonts. Fonts are declared in `theme.json` via `settings.typography.fontFamilies[].fontFace` (see "Fonts live in theme.json").

What `functions.php` MAY contain (and nothing more):

```php
<?php
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_style(
        '<slug>-style',
        get_stylesheet_uri(),
        array(),
        wp_get_theme()->get( 'Version' )
    );
} );

add_action( 'after_setup_theme', function () {
    add_editor_style( 'style.css' );
} );
```

That is the whole theme `functions.php`: enqueue `style.css` on the front end, and `add_editor_style` so the editor matches. If a section needs JavaScript (scroll animation, sticky shrink-on-scroll), enqueue a small front-end script here too — but the script is progressive enhancement, not behavior (see invariants). Anything stateful goes to the plugin.

## Content is seeded into the live database

The model writes real files to disk and seeds content into the running WordPress DB via WP-CLI / the `seed_content` tool — content is NEVER baked into the theme.

- Pages (Home, About, Contact, Services, etc.) are inserted as published pages in the database. The home page is set as the static front page by setting `show_on_front` = `page` and `page_on_front` to its ID.
- CPT entries (portfolio items, team members, menu items, testimonials) are inserted as posts of their type — registered by the companion plugin — and seeded into the DB.
- Blog posts, categories, and tags are created in the DB.

There is no `content-loader.php`, no `<!-- meta -->` header convention, no `theme:./assets/...` reference rewriting, no `page-url-rewrite.php` / `post-url-rewrite.php`. Pages link to each other with normal site-root-relative permalinks (`/about/`), which resolve correctly on a real Studio site. Images referenced by seeded content are real media-library attachments or real theme asset URLs, not placeholder tokens.

The theme's templates are thin shells (below); the rich content they display comes from the seeded database, queried by core blocks (`core/post-content`, `core/query`).

## File layout

```
wp-content/themes/<slug>/
  theme.json            design tokens — single source of truth
  style.css             theme header + custom CSS (polish, motion, layout utilities)
  functions.php         minimal: enqueue style.css + add_editor_style (+ optional PE script)
  templates/
    index.html          required — fallback / blog-or-archive landing
    front-page.html     static homepage shell (homepage-and-pages mode)
    page.html           required — single page shell
    single.html         when there are posts or content CPTs
    archive.html        when there are posts or content CPTs
    404.html, search.html  optional but recommended
  parts/
    header.html         required — site-title + navigation
    footer.html         required — credit + nav/meta
    sidebar.html        only in sidebar-left / sidebar-right / dual-sidebar
    right-sidebar.html  only in dual-sidebar
  patterns/             rare — only when explicitly requested
  assets/               fonts (woff2), images, svg
```

Emit visible-first for a good live preview: `theme.json` → `style.css` → `parts/header.html` → `parts/footer.html` → `templates/front-page.html` (or `index.html`) → remaining templates → assets. The homepage's rich content is seeded into the DB, not written as a file.

## layout-mode drives the page frame

`layoutMode` (from the site spec) decides the overall page shape. Every template, part, and the `style.css` grid branch on it. Read the spec's value and pick one branch — do not mix.

- **`vertical-stack`** (default): header band on top, main in the middle, footer at the bottom. Primary nav in the header. theme.json declares `header` + `footer` template parts only.
- **`sidebar-left` / `sidebar-right`**: a fixed sidebar flanking a scrolling main column. The sidebar holds the site title + primary nav (and optional footer credit). The header is omitted or reduced to a thin utility top-bar inside `.main-content-area`. theme.json adds a `sidebar` part (`area: uncategorized`) and a `settings.custom.sidebarWidth` token (240–320px, 280px default). The CSS grid lives at `.wp-site-blocks` level. Never duplicate the sidebar inside the page body — the template grid pins it.
- **`dual-sidebar`**: three-column documentation chrome. Left sidebar = site title + nav tree; right rail = per-page TOC / metadata. Main scrolls between. theme.json declares `header`, `sidebar`, `right-sidebar`, `footer`; tokens `sidebarWidth` (240–280px) and `rightSidebarWidth` (220–260px); tighten `contentSize` to 680–760px.
- **`landing-page`**: single-viewport one-pager. Every route renders the same composition: hero + 3–6 anchor-linked sections (`#features`, `#pricing`, `#faq`, `#signup`). Nav uses anchor links, not page links. theme.json declares `header` + `footer` and a `settings.custom.scrollPaddingTop` token (e.g. `"80px"`) applied as `html { scroll-padding-top: var(--wp--custom--scroll-padding-top); }`.
- **`magazine-grid`**: the homepage IS the post archive — a tiled grid of latest posts, no marketing hero above it. Thin masthead band (wordmark + category nav). theme.json: `contentSize` 700–760px, `wideSize` 1280–1440px, generous `core/post-template.spacing.blockGap` (`var:preset|spacing|50`+).
- **`canvas-floating-chrome`**: full-bleed gallery / portfolio. Imagery reaches all four viewport edges; the only chrome is a small `position:fixed` floating module (wordmark + menu link) overlaid on content. theme.json sets `styles.spacing.padding.left` AND `.right` to `"0"` (NO clamp), keeps `useRootPaddingAwareAlignments: true`, and sets a mid-gray `core/site-title.color.text` so the wordmark survives any `mix-blend-mode: difference` filter.

When the prompt gives no explicit cue for a non-default mode, pick `vertical-stack`.

## content-mode drives which templates and the homepage shape

`contentMode` decides whether the site is marketing-first, blog-first, or has no front page.

- **`homepage-and-pages`** (default): a static front page plus interior pages. Seed a Home page into the DB and set it as the front page. `templates/front-page.html` (or `index.html`) is a **thin shell**:

  ```html
  <!-- wp:template-part {"slug":"header","tagName":"header"} /-->
  <!-- wp:group {"tagName":"main","style":{"spacing":{"margin":{"top":"0"}}}} -->
  <main class="wp-block-group">
      <!-- wp:post-content {"layout":{"type":"constrained"}} /-->
  </main>
  <!-- /wp:group -->
  <!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
  ```

  The outer `<main>` carries no layout (default) so a full-bleed hero in the seeded home page renders edge-to-edge; `core/post-content` carries the constrained layout for readable body width. The rich homepage composition lives in the seeded page's content, NOT in the template.

- **`blog-first`**: the post stream is the experience. A small intro home page is optional (ship one only when the user wants a marketing intro alongside the blog). Otherwise drop `front-page.html` and let `index.html` show the post stream at `/`.

- **`index-only-no-homepage`**: the user opted out of a marketing landing. Do NOT seed a Home page and do NOT emit `front-page.html`. `templates/index.html` becomes the landing — a composed masthead (heading + one-line tagline) above a `core/query` loop of recent posts, with `postType: "post"` and `inherit: true` so category/tag archives reuse the same template. NO `core/post-content` shell in this mode.

In sidebar modes, wrap whichever shell applies in the sidebar grid: sidebar part(s) flanking a `.main-content-area` group that holds the optional top-bar + `<main>` + footer.

Template coverage: always emit `page.html`. Emit `single.html` and `archive.html` when there are posts or content CPTs (registered by the companion plugin). Content-CPT archives/singles display entries via `core/post-content` (or `core/post-featured-image` where the design calls for it), reading from the seeded DB.

## header-behavior

The spec carries a `headerBehavior` object — `position`, `overlayHero`, `scrolledBackground`, `shrinkOnScroll`. The header part, `style.css`, and any PE script must agree on these.

- **`position`**: `"sticky"` only when the design shows persistent top nav across the scroll range; else `"static"`. Sticky goes on the template-part wrapper, not the inner group (see sticky invariant).
- **`overlayHero`**: `true` only when the header sits visually ON TOP OF a full-bleed hero (transparent header over imagery/color reaching the very top). A tall light-on-light header is NOT overlay. When `true`, the header part has no background until scrolled, and the hero sits flush against it (zero gap — no top margin/padding on the hero, no bottom margin/padding on the header).
- **`scrolledBackground`**: required when sticky. `"opaque-surface"` (crisp) or `"translucent-blur"` (glassmorphic backdrop-blur). `"none"` only when static or already-solid.
- **`shrinkOnScroll`**: `true` only when the design shows a reduced scrolled header. The PE script toggles `.is-shrunk` on the inner group; `style.css` defines the shrunk state.

When `layoutMode` starts with `sidebar-`, force `{ "position": "static", "overlayHero": false, "scrolledBackground": "none", "shrinkOnScroll": false }` — the sidebar is the chrome, the header can't overlay or stick.

## theme.json token discipline

`theme.json` is the single source of truth. Every color, font, size, and spacing value used in block markup and `style.css` references a token declared here. No hardcoded hex, px, or font names in block attributes; CSS reads tokens as `var(--wp--preset--color--<slug>)`, `var(--wp--preset--font-family--<slug>)`, `var(--wp--preset--spacing--<n>)`.

**Color palette** — declare a complete, self-contained palette and verify WCAG AA before finalizing:

- Body text vs page background ≥ 4.5:1 (aim 7:1).
- Any heading / muted slug ≥ 4.5:1 against every background AND surface/card slug it could render on.
- Button label vs button surface ≥ 4.5:1 (check both light-on-light and dark-on-dark).
- Reserve saturated accents for borders, icons, button surfaces, large display headings — not body copy.
- No two slugs within ~25 lightness steps for normal-weight text. Catch contrast failures here, not in `style.css` — downstream files trust the palette to be readable and there is no recovery later.

**Typography** — pick distinctive, characterful fonts (avoid Inter / Roboto / Arial / system defaults). Pair a display font with a refined body font.

- Font size scale stays grounded: body 1rem, headings scale modestly, cap display at ~3.5rem via `clamp(2.5rem, 4vw, 3.5rem)`. Avoid sizes above 4rem. A good 6-step scale: `0.875 / 1 / 1.25 / 1.75 / 2.25 / clamp(2.5rem, 4vw, 3.5rem)`.
- Line height: body 1.5–1.65, headings 1.1–1.3, never below 1.0. Set via `styles.typography.lineHeight` and `styles.elements.heading.typography.lineHeight`.

**Spacing scale** — declare a `spacingScale` (or explicit `spacingSizes`) and set:

- `styles.spacing.blockGap` (REQUIRED) — site-wide vertical rhythm between sibling blocks (`var:preset|spacing|40` cozy, `50` editorial, `60` magazine). This is the single most-leveraged setting for prose rhythm.
- `styles.blocks.core/navigation.spacing.blockGap`, `core/buttons.spacing.blockGap`, `core/post-template.spacing.blockGap` (all REQUIRED) — WP flex/grid layouts have no default gap; without these, nav items, buttons, and cards touch.

**Layout** (REQUIRED — wires alignments):

- `settings.layout.contentSize` 800–960px (prose width); `wideSize` 1200–1400px (hero/grid clamp). Tighten `contentSize` for dual-sidebar (680–760) and magazine-grid (700–760).
- `settings.useRootPaddingAwareAlignments: true` — without it, `align:wide`/`align:full` inherit body padding and never reach the edge.
- `styles.spacing.padding`: set horizontal only via fluid clamp (`"left"/"right": "clamp(1.5rem, 5vw, 4rem)"`), `top`/`bottom` to `"0"`. Exception: `canvas-floating-chrome` sets left/right to `"0"`. Never add horizontal padding to `<main>`, page groups, or template shells — that double-pads. Sections break out via `align`, never via wrapper padding.

**Block-level defaults** (REQUIRED — defends against inheritance):

- `styles.blocks.core/button.color.{background,text}` declared TOGETHER, plus a distinct `:hover.color.{background,text}` pair, plus `spacing.padding`.
- `styles.elements.link.color.text` AND `.:hover.color.text` together.
- Paired-contrast rule: every `styles.blocks.<block>.color` sets BOTH background and text — never one alone.

## Fonts live in theme.json

Declare every font in `theme.json` under `settings.typography.fontFamilies`, each with a `fontFace` array pointing at bundled woff2 files in `assets/`. Do NOT enqueue Google Fonts and do NOT ship a `fonts.php`.

```json
{
  "settings": {
    "typography": {
      "fontFamilies": [
        {
          "fontFamily": "\"Fraunces\", serif",
          "name": "Fraunces",
          "slug": "display",
          "fontFace": [
            {
              "fontFamily": "Fraunces",
              "fontWeight": "400 700",
              "fontStyle": "normal",
              "src": [ "file:./assets/fonts/fraunces.woff2" ]
            }
          ]
        }
      ]
    }
  }
}
```

This loads the font in both front end and editor with no enqueue code, and keeps the theme self-contained and offline-capable.

## Theme invariants (apply to every file)

These are absolute unless the user's original request explicitly overrides one.

**Block markup**

- Prefer core blocks for content (`core/group`, `core/columns`, `core/cover`, `core/media-text`, `core/heading`, `core/paragraph`, `core/buttons`, `core/query`, `core/gallery`, `core/details`). Custom blocks (in the companion plugin) are for named interactive features only.
- Custom classNames go ONLY on the outermost block wrapper via the block `className` attribute — never on inner DOM elements. Section identity lives in `className`, not in decorative HTML comments.
- Full-bleed sections use an outer `core/group` with `"align":"full"`. Every top-level section MUST declare an `align` (`"full"` for edge-to-edge bands, `"wide"` for most sections); default alignment is reserved for inner content holders only. A section with no `align` renders as a narrow column — that's the symptom of forgetting it.
- Section containers use `"layout":{"type":"default"}` (or omit layout); only inner content holders that wrap readable prose use `"layout":{"type":"constrained"}`. Never put constrained on the section container or page root.
- Every top-level group resets top margin: `"style":{"spacing":{"margin":{"top":"0"}}}`.
- No `core/html` for content sections — only for exotic decoration (an embed core blocks can't express). No `<inner-blocks>` placeholders; emit full expanded markup.
- No decorative HTML comments — only WordPress block delimiter comments. No emojis anywhere (and no `:)` / `<3` auto-emoji glyphs). Use custom SVG for icons.

**Color pairing (the invisible-text rule)** — WordPress inheritance is unreliable; a child whose text color falls through to the body default renders invisible on any non-default surface. Defend block-level:

- When a block declares `backgroundColor` (or `style.color.background`), it MUST also declare `textColor` (or `style.color.text`). No exceptions, at every level.
- When a block declares `style.border.width`, it MUST also declare `borderColor` (a palette slug).
- `core/button` MUST declare both background and text colors; `is-style-outline` buttons MUST declare `textColor` AND `borderColor` together.
- `core/navigation` MUST declare ALL FIVE: `textColor`, `style.elements.link.color.text`, `overlayBackgroundColor`, `overlayTextColor`, and `style.spacing.blockGap`. Missing any one breaks at least one render mode — the mobile overlay defaulting to invisible is the canonical nav bug.
- Any block with `layout.type:"grid"` or `"flex"` MUST declare `style.spacing.blockGap`.

**Sticky positioning** — apply `position: sticky` to the template-part wrapper, never the inner group. The inner group is the only child of `<header class="wp-block-template-part">`, so making it sticky gives it ~0px of scroll room (looks broken). Target the wrapper, whose containing block is the page-height `.wp-site-blocks`:

```css
.wp-site-blocks > header.wp-block-template-part {
    position: sticky;
    top: 0;
    z-index: 100;
}
```

Keep visual transitions and any JS-toggled `.is-shrunk` class on the inner group. Ensure no ancestor between the sticky element and the viewport has `overflow` other than `visible` (a common `body { overflow-x: hidden }` or `.wp-site-blocks { overflow: clip }` silently kills sticky — override to `overflow: visible` if so).

**Scroll animations (progressive enhancement)** — CSS defines the FINAL visible state; JS adds the initial hidden state (so the content is visible with JS disabled). Every animation respects `@media (prefers-reduced-motion: reduce)`. The optional PE script enqueued from theme `functions.php` adds initial classes and toggles reveal on scroll with a passive, null-checked listener. This is presentation enhancement, not behavior — never use the Interactivity API; behavior goes to the companion plugin.

**Design tokens** — all colors, sizes, fonts, spacing referenced by slug/variable, never hardcoded. `style.css` custom CSS is reserved for polish (typography detail, link/button variants, image effects, motion) and named layout utilities — not for re-implementing layout that the editor handles.

**Footer credit** — include a credit line in the footer, styled to match the theme (font size, color). Compose its position freely; presence is the constraint.

## Cross-references

- Behavior (CPTs, taxonomies, post meta, REST routes, custom blocks): load the `companion-plugin` skill. Custom blocks there are build-less plain JS (`block.json` + plain `view.js`/`editor.js` calling `wp.blocks.registerBlockType` with `wp.element.createElement`, registered via `register_block_type`) — never JSX, never `@wordpress/scripts`, never the Interactivity API.
- Writing block markup for pages/templates/parts: load `block-content`.
- Determining `layoutMode` / `contentMode` / `headerBehavior` from the user prompt: load `site-spec`.
- Aesthetic direction (palette, type, motion): load `visual-design`.
