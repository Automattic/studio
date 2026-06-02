You are generating a SINGLE block template for a WordPress block theme. The task line below names which template to produce (one of: `index`, `page`, `single`, `archive`, `404`, or a CPT template such as `archive-<cpt>` / `single-<cpt>`). Output the raw block-markup HTML for that one template file only.

This file lives in the PRESENTATION THEME at `<site>/wp-content/themes/<slug>/templates/<name>.html`. The theme is pure presentation: it carries `theme.json`, `style.css`, `templates/`, `parts/`, `patterns/`, and `assets/`. It has NO custom post types, NO REST routes, NO block registration, and NO seeded content. All behavior (custom post types, taxonomies, post meta, REST routes, custom blocks) lives in the SEPARATE companion plugin at `<site>/wp-content/plugins/<slug>-functionality/`. A template here may QUERY a custom post type that the companion plugin registers, but it never defines one. All real page bodies and posts are seeded into the LIVE WordPress database — never baked into the theme as files. So a template here is a thin presentational SHELL; it does not contain the body content, it provides the frame that wraps `wp:post-content` or a query loop.

The theme's design foundation (theme.json, style.css, header part, footer part) has already been generated and is appended below along with the site spec JSON and the chosen design direction. You MUST match that foundation exactly: the same color slugs, typography slugs, spacing presets, and CSS class conventions. Never invent a color or font value inline — reference the `theme.json` presets (`var:preset|color|*`, `var:preset|font-family|*`, `var:preset|spacing|*`).

## What a template is

A template is the spatial shell that wraps every page or entry of its role. The rich composition (hero, feature bands, body prose) does NOT live in the template — it arrives at render time through `wp:post-content` (for pages and singles) or through a `wp:query` loop (for archives and feed-style homepages). Your job is to emit the correct frame for the named role and the active layout mode, referencing the header and footer as template parts, and choosing the right wrapper and layout types so that full-bleed sections can break out while body text stays at reading width.

## Reading the design direction for layout

Read the chosen design direction for spatial intent, not just color and type. Where does the hero sit — full-bleed, off-center, centered, split? How is navigation positioned? Match the design's section spacing, image-to-text balance, and visual rhythm in the shells you emit. If the spec carries a `layoutMode` field, branch on it (see "Layout mode" below). If the spec carries a `siteBrief.heroComposition` (or similar cinematic-intent field), defer to it for the home / single / archive shell shape. An editorial, generous-whitespace direction yields centered single-column archive shells; a dense magazine direction yields tighter grids and asymmetric editorial rows. Pick the loop shape and single-page hierarchy from the design's vocabulary, not a generic default.

## Width and alignment — the core mechanism

Horizontal gutters and content widths are pinned site-wide in `theme.json` (`settings.layout.contentSize` / `wideSize` and `styles.spacing.padding`). Do NOT re-pad wrapper groups to simulate a max-width — `theme.json` already sets root padding, and the `align` attribute punches through it. Double-padding collapses the layout into a too-narrow column.

Translate width intent into WordPress alignment explicitly:

| Width intent in the design | What the block must do |
|---|---|
| Full-bleed section, edge-to-edge background | Outer `wp:group` MUST set `"align":"full"` |
| Wide section (roughly 1200–1280px) | Outer `wp:group` MUST set `"align":"wide"` |
| Reading-width text column (roughly 640–800px) | An INNER group with `"layout":{"type":"constrained"}` nested inside an aligned or default outer container |
| Featured image, cover hero, archive header | `"align":"wide"` or `"align":"full"` per the design's vocabulary |

Layout-type rule of thumb: **section containers use the default layout; inner content columns use constrained.** The outer `<main>` group on a homepage / page / single stays at `layout.type:"default"` so that full-bleed page sections inside `wp:post-content` can render edge-to-edge; the readable column is enforced by `constrained` on `wp:post-content` itself or on an inner group. Spatial composition primitives, when a section needs them: `wp:cover` for full-bleed heroes, `wp:columns` with non-equal widths for asymmetric splits, `wp:media-text` with `mediaPosition` for image/text splits, `wp:group` with a custom `flex` layout for off-center compositions.

## Block markup rules (apply to everything you emit)

- Prefer core blocks for all content and chrome.
- Put custom CSS classes ONLY on the OUTERMOST block wrapper, via that block's `className` attribute — never on inner DOM nodes. Inner blocks stay clean so the theme's CSS can target the section wrapper.
- Full-bleed sections are an outer `wp:group` with `align:full`.
- Whenever a block sets a `backgroundColor`, it MUST also set a `textColor` (and a nav block needs its full color set). A background without a paired text color produces invisible text on the front end.
- Sticky positioning belongs on the `.wp-block-template-part` wrapper (handled by the foundation CSS), NOT on an inner group inside the template. The template just emits the standard `wp:template-part` reference; the CSS pins it.
- Scroll / entrance animations use progressive enhancement: the CSS defines the FINAL visible state, and a plain-JS layer adds the initial hidden state. Every animation must respect `@media (prefers-reduced-motion: reduce)`. Templates themselves rarely carry animation — keep that in the CSS/JS layer — but never emit markup that hides content with no JS-enabled fallback.
- Reset top margin on every top-level group with `"style":{"spacing":{"margin":{"top":"0"}}}` so the first section sits flush under the header.
- NO emojis anywhere. No decorative HTML comments — the only comments allowed are WordPress block-delimiter comments (`<!-- wp:... -->` / `<!-- /wp:... -->`).

## Template parts

Reference the header and footer as template parts; never inline their markup:

```
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
```

## Layout mode

If the spec exposes a `layoutMode`, branch on it before composing. If it does not, use `vertical-stack` (the default).

- **`vertical-stack`** (default): header → main → footer. Use the vertical-stack shells below.
- **`sidebar-left` / `sidebar-right`**: the template root has EXACTLY TWO top-level children — the sidebar template-part first (always `className="site-sidebar"`, even for `sidebar-right`; the CSS handles the visual swap), then one `.main-content-area` group (`className="main-content-area"`, `layout.type:"default"`, all paddings/margins zeroed) wrapping the optional thin top-bar header, the body, and the footer. The footer lives INSIDE `.main-content-area`. Use slightly tighter grids than vertical-stack (a 4-column grid may need to drop to 3) because the main column is the viewport minus the sidebar.
- **`dual-sidebar`**: EXACTLY THREE top-level children in this order — left sidebar (`className="site-sidebar"`), the `.main-content-area` wrapper, right sidebar (`className="site-right-sidebar"`). Header and footer live inside `.main-content-area`. Tighten grids further (a 4-column grid may need to drop to 2).
- **`landing-page`**: every template is a thin alias of the front-page one-pager shell — a constrained `<main>` carrying `wp:post-content`. Section anchors (`#features`, `#pricing`) belong on the section groups inside the seeded page body, not on the template `<main>`. EXCEPTION: `single` and `archive` ARE reachable by direct URL, so render those with the standard vertical-stack shells (a one-pager shell is wrong for a normal post-detail page).
- **`magazine-grid`**: the homepage (`index` / front-page) IS the post archive — it opens with explicit `wp:query` loops (a lead story, then a card grid) instead of `wp:post-content`. `single`, `page`, and section archives use the standard vertical-stack shells.
- **`canvas-floating-chrome`**: the header template-part is still REFERENCED (so WordPress emits its DOM) but renders as a fixed-position floating utility via the CSS — the `<main>` uses `layout.type:"default"` with zero top padding so the hero reaches the viewport edges; text pages restore `layout.type:"constrained"` with vertical padding. Footer is optional on the homepage (include only for a quiet credit row).

## Vertical-stack shells

### `index` (homepage)

The homepage body is a seeded page; the template is a minimal shell. The outer `<main>` uses the default layout so full-bleed sections inside the page body render edge-to-edge, and it has zero top margin so the hero sits flush under the header. The reading width comes from `constrained` on `wp:post-content`:

```
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
<!-- wp:group {"tagName":"main","style":{"spacing":{"margin":{"top":"0"}}}} -->
<main class="wp-block-group">
    <!-- wp:post-content {"layout":{"type":"constrained"}} /-->
</main>
<!-- /wp:group -->
<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
```

If the site has NO static homepage page (a blog-first site where `show_on_front` is `posts`) AND posts are being seeded, `index` IS the landing template — the thin `wp:post-content` shell would only render the latest post body alone, with no way to reach the stream. Instead emit a composed landing-archive: a short masthead (heading + one tagline paragraph, no marketing) inside an inner constrained group, followed immediately by the post-stream `wp:query`:

```
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
<!-- wp:group {"tagName":"main","style":{"spacing":{"margin":{"top":"0"},"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}}} -->
<main class="wp-block-group">

    <!-- wp:group {"layout":{"type":"constrained","contentSize":"720px"},"style":{"spacing":{"margin":{"bottom":"var:preset|spacing|50"}}}} -->
    <div class="wp-block-group" style="margin-bottom:var(--wp--preset--spacing--50)">
        <!-- wp:heading {"level":1} --><h1>Site name or one-line intro</h1><!-- /wp:heading -->
        <!-- wp:paragraph --><p>One-sentence tagline framing what the reader will find.</p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:group -->

    <!-- wp:query {"query":{"perPage":10,"postType":"post","order":"desc","orderBy":"date","inherit":true},"layout":{"type":"constrained"}} -->
    <div class="wp-block-query">
        <!-- wp:post-template -->
            <!-- wp:post-date /-->
            <!-- wp:post-title {"level":2,"isLink":true} /-->
            <!-- wp:post-excerpt /-->
        <!-- /wp:post-template -->
        <!-- wp:query-pagination -->
            <!-- wp:query-pagination-previous /-->
            <!-- wp:query-pagination-numbers /-->
            <!-- wp:query-pagination-next /-->
        <!-- /wp:query-pagination -->
    </div>
    <!-- /wp:query -->

</main>
<!-- /wp:group -->
<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
```

The post-template loop may be styled per the design (editorial list, magazine grid, card grid) — the vertical list above is the minimal form. Keep the masthead to a heading plus one paragraph; the reader is here to read posts.

### `page` (generic page)

Same shape as the homepage shell — outer `<main>` default so sections can use `align:wide` / `align:full`, reading width enforced inside `wp:post-content`.

### `single` (single blog post)

Outer `<main>` stays default in case the post embeds full-bleed media; wrap the readable post chrome and body in an INNER constrained group:

```
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
<!-- wp:group {"tagName":"main","style":{"spacing":{"margin":{"top":"0"}}}} -->
<main class="wp-block-group">
    <!-- wp:group {"layout":{"type":"constrained"}} -->
    <div class="wp-block-group">
        <!-- wp:post-title {"level":1} /-->
        <!-- wp:post-date /-->
        <!-- wp:post-author-name /-->
        <!-- wp:post-content {"layout":{"type":"constrained"}} /-->
    </div>
    <!-- /wp:group -->
</main>
<!-- /wp:group -->
<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
```

### `archive` (generic blog archive)

The content is a repeatable list, so the body is a `wp:query` loop — NEVER `wp:post-content`. Compose the page: an opening heading plus a one-line intro in an inner constrained group, then the query loop, optionally a CTA below. Use an editorial recipe inside the post-template: featured image + date + linked title + excerpt. Pick the loop shape from the design (featured-plus-rest, magazine, card grid) — match shape to count and voice, not to a generic default. The outer `<main>` stays default so a `wide`/`full` query loop can flow edge-to-edge. Add `wp:query-pagination` for archives that exceed `perPage`.

```
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
<!-- wp:group {"tagName":"main","style":{"spacing":{"margin":{"top":"0"},"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}}} -->
<main class="wp-block-group">

    <!-- wp:group {"layout":{"type":"constrained","contentSize":"720px"},"style":{"spacing":{"margin":{"bottom":"var:preset|spacing|50"}}}} -->
    <div class="wp-block-group" style="margin-bottom:var(--wp--preset--spacing--50)">
        <!-- wp:heading {"level":1} --><h1>Heading for this archive</h1><!-- /wp:heading -->
        <!-- wp:paragraph --><p>One-sentence intro that frames the collection.</p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:group -->

    <!-- wp:query {"query":{"perPage":10,"postType":"post","order":"desc","orderBy":"date","inherit":true},"layout":{"type":"constrained"}} -->
    <div class="wp-block-query">
        <!-- wp:post-template -->
            <!-- wp:post-featured-image {"isLink":true,"aspectRatio":"16/9"} /-->
            <!-- wp:post-date /-->
            <!-- wp:post-title {"level":2,"isLink":true} /-->
            <!-- wp:post-excerpt /-->
        <!-- /wp:post-template -->
        <!-- wp:query-pagination -->
            <!-- wp:query-pagination-previous /-->
            <!-- wp:query-pagination-numbers /-->
            <!-- wp:query-pagination-next /-->
        <!-- /wp:query-pagination -->
    </div>
    <!-- /wp:query -->

</main>
<!-- /wp:group -->
<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
```

### `404`

A short, on-brand "page not found" shell — header part, then a constrained `<main>` with an `<h1>`, a one-line apology paragraph, and a `wp:search` block or a link home, then the footer part. Keep the outer `<main>` constrained with comfortable vertical padding; no query loop.

```
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
<!-- wp:group {"tagName":"main","style":{"spacing":{"margin":{"top":"0"},"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<main class="wp-block-group">
    <!-- wp:heading {"level":1} --><h1>Page not found</h1><!-- /wp:heading -->
    <!-- wp:paragraph --><p>One-line, on-brand note that this page does not exist, then a way forward.</p><!-- /wp:paragraph -->
    <!-- wp:search {"label":"","buttonText":"Search"} /-->
</main>
<!-- /wp:group -->
<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
```

### `archive-<cpt>` (custom post type archive)

The companion plugin registers this CPT; the template only queries it. Infer the CPT slug from the named template (`archive-acme_team` → `postType:"acme_team"`) and match it exactly to a slug the spec / plugin defines — never invent or rename it. The body is a designed `wp:query` loop, NOT `wp:post-content`. Compose the loop by domain purpose, not by slug name: a CPT listing people is a People shape (card grid or editorial rows of portrait images plus name and role); a CPT listing things or works is a Things shape (image grid); an events CPT surfaces date and location. Match shape to count and voice — four people in an editorial voice want full-row image-beside-text rows, twelve people in a minimal voice want a card grid. Compose the page around the loop: opening heading + one-line intro in an inner constrained group, then the query, optionally a CTA. Outer `<main>` stays default so a `wide`/`full` loop can flow edge-to-edge. Replace the human-readable heading with the CPT's display name inferred from its slug ("Team", "Menu", "Projects"). Pick the featured-image `aspectRatio` from the CPT's domain: `3/4` for people, `1/1` for things, `4/3` for works/properties/events, `16/9` for editorial. Add `wp:query-pagination` when the collection exceeds `perPage`.

### `single-<cpt>` (custom post type detail)

One entry's full detail page. Outer `<main>` stays default so a wide featured image renders edge-to-edge; the readable chrome and body sit in an inner constrained group. `wp:post-content` IS correct here — single pages render the full body. If the entry exposes structured meta the reader wants prominently (price for a menu item, role for a team member, date and location for an event), add one or two bound `wp:paragraph` blocks between the title and the content. Pick the featured-image `aspectRatio` from the CPT domain (`3/4` people, `1/1` things, `4/3` works/properties/events, `16/9` editorial):

```
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
<!-- wp:group {"tagName":"main","style":{"spacing":{"margin":{"top":"0"},"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}}} -->
<main class="wp-block-group">
    <!-- wp:post-featured-image {"align":"wide","aspectRatio":"4/3","style":{"border":{"radius":"8px"}}} /-->
    <!-- wp:group {"layout":{"type":"constrained"}} -->
    <div class="wp-block-group">
        <!-- wp:post-title {"level":1} /-->
        <!-- wp:post-content {"layout":{"type":"constrained"}} /-->
    </div>
    <!-- /wp:group -->
</main>
<!-- /wp:group -->
<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
```

## Sidebar / dual-sidebar shells

When `layoutMode` is a sidebar variant, wrap the SAME body composition (the inner `<main>` contents shown above for each role) inside the layout-mode chrome. The sidebar template-part comes first; the header (when the design keeps a thin top-bar) and footer go INSIDE `.main-content-area`. When the design has no header band, omit the inner header template-part reference. Never exceed the exact child count the grid expects (two for single-sidebar, three for dual-sidebar) — extra bands go inside `.main-content-area`, never as another grid child.

Single-sidebar body wrapper:

```
<!-- wp:template-part {"slug":"sidebar","tagName":"aside","className":"site-sidebar"} /-->

<!-- wp:group {"className":"main-content-area","style":{"spacing":{"margin":{"top":"0"},"padding":{"top":"0","bottom":"0","left":"0","right":"0"},"blockGap":"0"}},"layout":{"type":"default"}} -->
<div class="wp-block-group main-content-area" style="margin-top:0;padding-top:0;padding-right:0;padding-bottom:0;padding-left:0">
    <!-- wp:template-part {"slug":"header","tagName":"header"} /-->
    <!-- ...the role-appropriate main/body from the vertical-stack shells above... -->
    <!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
</div>
<!-- /wp:group -->
```

For `dual-sidebar`, append a third child after the wrapper: `<!-- wp:template-part {"slug":"right-sidebar","tagName":"aside","className":"site-right-sidebar"} /-->`.

## Task

Generate ONLY the one template named in the task line, choosing its shape from the role AND the active `layoutMode`. For a CPT template, infer the slug from the name and set the query `postType` to match. Apply every block-markup rule above: top-margin reset on each top-level group, `align:wide`/`align:full` for hero-level and full-bleed content, theme.json preset tokens for all styling, paired text/background colors, custom classes only on outer wrappers. Start directly with the first `<!-- wp:` comment.

Output ONLY the raw file content — no markdown code fences, no commentary, no explanation.
