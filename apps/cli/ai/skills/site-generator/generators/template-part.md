You are generating ONE template part for a WordPress block theme. The task line below names exactly which part to produce — `header`, `footer`, `sidebar`, or `right-sidebar`. Produce the raw block-markup HTML for that single part and nothing else.

The file you write is `<site>/wp-content/themes/<slug>/parts/<part>.html`. The theme is PURE PRESENTATION: it holds `theme.json`, `style.css`, templates, parts, patterns, and assets. It holds NO behavior. Custom post types, taxonomies, post meta, REST routes, and custom blocks all live in the COMPANION PLUGIN at `<site>/wp-content/plugins/<slug>-functionality/`, not here. Content (pages, posts, menus, options) is seeded into the live WordPress database with WP-CLI / the seed_content tool — never baked into the theme. A template part contains presentation block markup only; it never registers anything, never seeds content, and never embeds copy that belongs in the database.

The theme's `theme.json` has already been generated and is appended below along with the site spec and the chosen design direction. You MUST match its color slugs, font-family slugs, font-size slugs, and spacing slugs exactly — never invent a new token and never hardcode a hex color or a raw pixel/rem size where a `var:preset|...` token exists.

## Output discipline

`parts/<part>.html` is a block template part. It must be VALID block markup ONLY:

- No `<?php`, no PHP of any kind.
- No raw HTML outside of block delimiter comments. The only HTML allowed is the auto-generated markup WordPress writes inside a block (the `<div class="wp-block-group">...`, `<nav>`, `<ul>` etc.) that pairs with its `<!-- wp:... -->` / `<!-- /wp:... -->` comments.
- No decorative or explanatory HTML comments. The ONLY comments permitted are block delimiters (`<!-- wp:... -->`).
- No emojis anywhere.
- Start directly with the first `<!-- wp:` comment.

## Block markup rules (apply to every block you emit)

- Prefer CORE blocks for content and chrome. Reach for the companion plugin's custom blocks only when the design needs behavior no core block provides — and even then a template part rarely contains them; chrome is core blocks.
- Put custom CSS class names ONLY on the OUTERMOST block of a logical section, via that block's `"className"` attribute. Never sprinkle classNames onto inner DOM. `style.css` hooks these outer classNames.
- A full-bleed, edge-to-edge section is an outer `wp:group` with `"align":"full"`. Inner content keeps the normal content width unless the design explicitly wants it wide.
- COLOR PAIRING IS MANDATORY: whenever a block sets `backgroundColor`, it MUST also set `textColor` (use palette slugs, paired so the text clears 4.5:1 contrast against that background). A background without a paired text color is the canonical invisible-text bug. `wp:navigation` needs its full color set — see the navigation color contract below.
- STICKY / PINNED positioning is configured in `style.css` keyed on the `.wp-block-template-part` wrapper (or its stable className), NOT on the inner `wp:group`. The block markup's only job is to give the inner group a stable `className` so the CSS can hook it. Never declare sticky attributes inside the part markup.
- SCROLL ANIMATIONS use progressive enhancement: `style.css` defines the FINAL, visible state so the part is fully usable with JS disabled; a build-less plain-JS asset adds the initial hidden state and drives the transition. Every animation MUST respect `@media (prefers-reduced-motion: reduce)`. The part markup only carries the stable className hook; the CSS and JS live elsewhere.
- CHROME (borders, dividers, visible boxes) is an aesthetic choice, NOT a default. Do NOT add `style.border.width` to `wp:group` blocks habitually — the reflexive `1px solid currentColor` on every section renders as washed-out beige/cream rules and is a bug. Add borders only when the chosen design clearly uses bordered chrome as a primary visual element, and when you do, name the border color with an explicit palette slug (`{"borderColor":"primary"}`) — never let it inherit `currentColor`.

## Layout mode decides what each part IS

Read `siteSpec.layoutMode` before composing anything. It radically changes the role of the part you are asked to generate.

- `vertical-stack` (default): conventional top-down page. The header is the top strip (wordmark + primary nav); the footer is a full-bleed band at the bottom; there are no sidebars (you will not be asked for one).
- `sidebar-left` / `sidebar-right`: the LEFT sidebar carries the PRIMARY chrome (wordmark + primary navigation). The header collapses to a thin utility top-bar or an empty wrapper, and the footer renders inside the main content column.
- `dual-sidebar`: three columns — a left sidebar with the primary chrome, a scrolling main column, and a right rail with per-page wayfinding.
- `landing-page`: single scrolling page; the header nav is in-page anchor links, not site pages.
- `magazine-grid`: the header is a thin masthead (wordmark + category links).
- `canvas-floating-chrome`: the header is floating utility chrome, not a band.

If the task asks for a part that the active layout mode does not use, still emit a minimal valid empty wrapper so the part file resolves.

---

## If the task is: header

The header is part of the selected design, not a thin convention strip bolted above it. Read the chosen design direction for every visible header layer: contact topbar, white/nav band, logo or site-title lockup, CTA button, utility row, decorative stripe, transparency, and nav position. Translate those decisions into the block grammar below. If the selected design has two header bands plus a patterned divider, emit those bands; do not collapse them to a single generic site-title + page-list strip.

Branch on `layoutMode` first:

- `vertical-stack` (default): the full header — `wp:site-title` wordmark + a primary `wp:navigation` containing `wp:page-list`, with all the navigation color/spacing properties, and the mobile overlay hamburger.
- `sidebar-left` / `sidebar-right` / `dual-sidebar`: do NOT duplicate the sidebar's chrome. Emit EITHER a thin utility top-bar (a single right-justified flex `wp:group` with 2–5 small utility items — search, category links, social icons; NO site title, NO `wp:page-list`, NO hamburger overlay) OR an empty wrapper (`wp:group` with zero padding and a stable className) when the design shows no header band. NEVER emit a horizontal site-title + `wp:page-list` strip in a sidebar mode — it fights the sidebar for the now-narrower main column.
- `landing-page`: the header IS the in-page navigation. Use `wp:navigation` with hand-authored `wp:navigation-link` entries whose `url` is an in-page anchor (`#features`, `#pricing`, `#signup`). Include the wordmark as `wp:site-title`. End the nav with a primary CTA via `wp:buttons` / `wp:button` anchored to the signup section. Mobile overlay hamburger still required.
- `magazine-grid`: a thin masthead — wordmark left, category links right, separated from content by a hairline rule, flex layout with `justifyContent:"space-between"`, no oversized vertical padding. Category links via `wp:categories` (`displayAsDropdown:false`, explicit small `fontSize`) OR hand-authored `wp:navigation-link` entries pointing at `/category/<slug>/`.
- `canvas-floating-chrome`: floating utility chrome, not a band. A `wp:group` holding the wordmark (`wp:site-title`, small uppercase, letter-spaced) in one corner and a single `wp:navigation` with `overlayMenu:"always"` in another. Position and blend-mode live in `style.css`.

### Wordmark (always a block, never hand-written text)

Use `<!-- wp:site-title {"isLink":true} /-->` so the WordPress site-name setting (seeded into the DB) drives both the visible wordmark and the homepage link. NEVER hand-write the site name as a heading or paragraph. The wordmark IS the design — tune its typography to match the chosen direction via block attributes: `fontFamily` (any family declared in `theme.json` — display, serif, mono, not just the body family), `fontSize` (a size slug or a custom `style.typography.fontSize` like `"clamp(2rem, 5vw, 3.5rem)"`), `style.typography.fontWeight` / `textTransform` / `letterSpacing` / `lineHeight`, and `level` (1–6, or `0` for `<p>` semantics). Use `<!-- wp:site-logo {"isLink":true} /-->` (with an explicit `width`) instead only when the design calls for an image-only mark; if the design pairs a logo with the name, include both. Do not assume a logo image exists — size its spatial slot via `width` and leave the upload to the site owner.

### Primary navigation (page links MUST come from wp:page-list)

Inside `<!-- wp:navigation -->`, render site pages with `<!-- wp:page-list /-->`. `page-list` resolves each entry through `get_permalink()` so URLs are correct on subdirectory installs, multisite, and production alike, and stays in sync with the pages seeded into the database. NEVER hand-author `<!-- wp:navigation-link -->` entries with hardcoded site-page `url` fields — those URLs are written verbatim into the anchor and break navigation from inner pages. The ONLY allowed hand-authored `wp:navigation-link` uses are: in-page anchors on `landing-page` mode (`url:"#features"`), category/tag archive URLs (`url:"/category/<slug>/"`, `url:"/tag/<slug>/"`), and known external links. Accept `wp:page-list`'s default `menu_order` ordering — the site owner reorders in Appearance → Menus; do not trade Playground/inner-page reliability for a baked order. If the nav needs a non-page CTA (e.g. "Book now"), nest a `wp:buttons` block alongside `wp:page-list` inside `wp:navigation`.

### Navigation color and spacing contract (FIVE properties — ALL required)

`wp:navigation` renders in three modes (desktop default, link state, mobile overlay) plus an item-spacing dimension; each reads from a different attribute. Set all five or at least one mode renders broken (most often the mobile overlay rendering invisible-on-invisible):

1. `"textColor":"<slug>"` — desktop default link color; must contrast the header's outer-group background.
2. `"style":{"elements":{"link":{"color":{"text":"var:preset|color|<slug>"},":hover":{"color":{"text":"var:preset|color|<slug>"}}}}}` — link state and visible hover color.
3. `"overlayBackgroundColor":"<slug>"` — mobile overlay surface.
4. `"overlayTextColor":"<slug>"` — mobile overlay text; MUST be a high-contrast pair with the overlay background (never the same slug).
5. `"style":{"spacing":{"blockGap":"var:preset|spacing|<token>"}}` — desktop flex item spacing (mandatory; without it items butt together as "AboutMenuContact").

A canonical complete declaration:

```
<!-- wp:navigation {"overlayMenu":"mobile","hasIcon":true,"textColor":"ink","overlayBackgroundColor":"ink","overlayTextColor":"cream","style":{"spacing":{"blockGap":"var:preset|spacing|40"},"elements":{"link":{"color":{"text":"var:preset|color|ink"},":hover":{"color":{"text":"var:preset|color|accent"}}}}},"layout":{"type":"flex","justifyContent":"right"}} -->
<!-- wp:page-list /-->
<!-- /wp:navigation -->
```

The right-aligned strip above is ONE composition, not the only correct one — match what the chosen design actually shows (centered, split, off-center, vertical).

### Mobile menu (REQUIRED on every non-sidebar header)

The nav MUST collapse into WordPress's built-in full-screen hamburger overlay on mobile: `"overlayMenu":"mobile"` (never `"never"`; use `"always"` only when the design wants a hamburger at all widths) and `"hasIcon":true`. Do NOT hand-roll a custom hamburger, drawer, or `<details>` element — the built-in overlay handles focus trapping, ESC dismissal, and aria. Keep `wp:page-list` as the source so the overlay shows the same pages as desktop. Overlay padding, item gap, and item type-scale are CSS rules in `style.css` keyed on `.wp-block-navigation__responsive-container.is-menu-open` — the part markup only sets the overlay's color attributes.

### Sticky / overlay-hero / scroll behavior

Read `siteSpec.headerBehavior`. If `overlayHero` is true, the outer `wp:group` MUST NOT declare a `backgroundColor` (it sits transparent over a full-bleed hero), and the wordmark + nav `textColor` must contrast the hero, not the page background. If `overlayHero` is false, the outer group SHOULD declare a paired `backgroundColor` + `textColor`. If `position` is `sticky` or `shrinkOnScroll` is true, give the outer `wp:group` a stable `className="site-header"` so `style.css` can hook it — sticky and shrink behavior live in the CSS at the template-part wrapper level, never as attributes here. Restrained designs leave the header pure-sticky with no extra scroll behavior. In sidebar modes, ignore the overlay/sticky branches entirely — the sidebar is the chrome.

### Sidebar-mode utility top-bar shape

A single `wp:group` with right-justified `flex` layout (`"flexWrap":"nowrap"`), 2–5 small utility items, optional hairline `0.5px` `border-bottom` (named color slug), no tall padding. Allowed utility items are endpoints WordPress actually exposes after activation: `wp:search`, category/tag archive links (`/category/<slug>/`), `wp:social-links` to external profiles, `wp:loginout`, or a `wp:button` to a seeded page. Do NOT fabricate `/account/`, `/cart/`, `/checkout/`, `/wishlist/` links — they 404. If a surface is tinted, declare `backgroundColor` AND `textColor` together. Empty-wrapper variant: a single `wp:group` with zero padding and a stable className.

---

## If the task is: footer

The footer carries the design's voice; it is NOT a 3-column boilerplate of logo / nav / social / copyright. Read the chosen design (or infer from its overall vocabulary if the preview is hero-only) and pick a composition that fits:

- Typographic statement (oversized wordmark / display sentence taking most of the footer height, compact credit below).
- Inverted hero (full-bleed band with a palette inversion, one oversized statement, one CTA).
- Magazine column grid (3–5 text-led columns, no chrome — masthead, nav, contact, hours, social).
- Minimal one-line credit (site name left, social row center, credit right).
- Editorial sign-off (italic serif colophon paragraph plus credit and a thin nav row).
- Dense logistics (hours, location, contact, social — for hospitality/retail/services).
- Photographic band, or Manifesto (short essay about the brand's values, credit at the end).

DO NOT default to "3-column grid with logo + nav + social + copyright" — that is the canonical AI-default footer to escape. If the site genuinely needs masthead + nav + social, compose them as a single typographic block (oversized masthead, then nav as a horizontal pill row, then social on its own line), not as three side-by-side chromed columns.

Layout-mode note: in `sidebar-left` / `sidebar-right` the footer renders INSIDE the main content column (a grid column), not as a direct child of the page root. Compose it normally with `align:full` / `align:wide` if the design wants them — `style.css` clamps `.alignfull` to fill the main column. Do NOT hand-roll negative margins to extend the footer under the sidebar.

Add optional ingredients (secondary nav, hours, location, contact, social icons, newsletter, closing CTA) ONLY when the design and the site's domain call for them — a restaurant footer wants hours and address; a portfolio footer wants minimal credit + social. Do not include all of them "just to be safe."

If you include a secondary navigation, use `<!-- wp:page-list /-->` inside `<!-- wp:navigation -->` — same hard rule as the header. The only hand-authored `wp:navigation-link` shapes allowed are category/tag archives and external links. `wp:social-links` with `wp:social-link` children pointing at full `https://` external URLs are fine.

Reference theme.json tokens by slug for every color and size; pair `backgroundColor` with `textColor` on every band that declares one.

---

## If the task is: sidebar (left sidebar)

This part is generated ONLY in `sidebar-left`, `sidebar-right`, and `dual-sidebar` modes. In those modes the left sidebar carries the PRIMARY CHROME of the site — the wordmark AND the primary navigation. The header is reduced to a thin utility strip (or omitted). The sidebar pins to the viewport via `style.css` (targeting `.wp-block-template-part.site-sidebar`); your job is to compose what lives inside it.

Read the chosen design and pick a sidebar archetype: Library card (tall narrow column, stacked display wordmark, hairline, vertical nav list, credit pinned at the foot), Studio masthead (oversized wordmark, tagline, compact vertical nav), Index column (a "Categories" label then a long vertical link list), Inverted brand panel (saturated/dark surface with light-on-dark wordmark and nav), or Editorial colophon (serif-italic wordmark, a sentence of brand voice, thin sans nav, colophon credit).

### Outer wrapper (required shape)

A single `wp:group` with VERTICAL flex layout so the wordmark + nav cluster pin to the top and the credit pins to the bottom:

```
<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|50","bottom":"var:preset|spacing|50","left":"var:preset|spacing|40","right":"var:preset|spacing|40"},"blockGap":"var:preset|spacing|50"}},"layout":{"type":"flex","orientation":"vertical","justifyContent":"space-between","flexWrap":"nowrap"}} -->
<div class="wp-block-group">
    ...wordmark + primary navigation cluster...
    ...footer credit cluster...
</div>
<!-- /wp:group -->
```

`"orientation":"vertical"` is mandatory — without it the children lay out as a horizontal row and the sidebar's identity collapses into a strip. `"justifyContent":"space-between"` is required when there is a bottom cluster; use `"flex-start"` if the design wants nothing pinned to the bottom. Padding lives on THIS inner group, never on the `.site-sidebar` template-part wrapper (that wrapper is a grid item — padding it clashes with the grid column sizing).

### Wordmark (required)

`<!-- wp:site-title /-->`, never hand-written text. Tune typography for a VERTICAL column — usually multi-line, stacked, tight `lineHeight`. Avoid the wide single-line letter-spaced lockup of a top-strip header; that reads as chrome, not as the page's primary identity. Use `<!-- wp:site-logo -->` with an explicit `width` when the design's mark is graphic.

### Primary navigation (required — vertical)

The sidebar IS where the primary nav lives. `<!-- wp:navigation -->` MUST use vertical flex (`"layout":{"type":"flex","orientation":"vertical","justifyContent":"left"}`) so links stack one per row. Item content MUST come from `<!-- wp:page-list /-->`, never hand-authored links. Set `"overlayMenu":"never"` — the responsive collapse in `style.css` restacks the sidebar above main content on mobile, so the hamburger is redundant. The nav color contract still applies: `textColor` + `elements.link.color.text` + `elements.link.:hover.color.text`, plus a `blockGap` (typically `spacing|20`–`spacing|30`).

### Typography scale (sidebar items are wayfinding, not headlines)

The wordmark is the ONLY display-scale element. Everything below it — nav links, section labels, category lists, contact strips, credit — is chrome-scale: at most `small` for nav/lists, `x-small`/`2x-small` mono uppercase for labels, `tiny` mono for the credit. NEVER pair weight ≥ 700 with `fontSize` `large` or above — a ~280px column clips display type. Any `wp:categories` / `wp:tag-cloud` / `wp:latest-posts` you include MUST carry an explicit `style.typography.fontSize` of `small` or smaller or it inherits a 1.5rem+ default.

### Category navigation when there is no home page

If the site spec has no `home` page seeded AND `siteSpec.blog.categories` is non-empty, the index becomes the post-stream landing and the sidebar MUST carry category navigation. Use `<!-- wp:categories -->` (`displayAsDropdown:false`, explicit small `fontSize`) or a `<!-- wp:navigation -->` of hand-authored `<!-- wp:navigation-link -->` entries, one per category, `url:"/category/<slug>/"` (leading and trailing slash both matter; no `?cat=` query-string fallbacks). Pair with a small uppercase section label when it helps hierarchy. When a home page exists, category nav is optional and design-driven.

### Footer credit (required, at the bottom)

Include a small attribution credit in the bottom cluster, styled to match the sidebar's typographic register (compact `tiny` mono, uppercase, letter-spaced is a good default). Optional ingredients (section label, contact strip, social row, search/CTA) only when the design preview shows them.

### Color and contrast

The sidebar usually has a distinct surface — the page neutral, a tinted panel, or an inverted brand surface. Whichever the design uses, every block declaring `backgroundColor` MUST declare a paired `textColor`, and the wordmark / nav / credit must each clear 4.5:1 against the sidebar background.

---

## If the task is: right-sidebar

This part is generated ONLY in `dual-sidebar` mode. The theme renders as three columns: a left sidebar with the primary chrome, a scrolling main column, and THIS right rail carrying per-page wayfinding. The right rail is NOT a second copy of the primary nav — it is the per-page metadata strip that documentation, wiki, knowledge-base, and reference sites need. It pins to the viewport via `style.css` (targeting `.wp-block-template-part.site-right-sidebar`).

Read the chosen design and pick ONE archetype (do not stack three): Table of contents (a label then 4–6 in-page anchor links seeded as static placeholders — the live TOC is generated client-side), Metadata sheet (key/value rows in small mono type — version, updated, license), Related rail (`wp:latest-posts` with a small `postsToShow`), Colophon (author paragraph + social links), or Quick actions (a small button/link cluster).

### Outer wrapper (required shape)

A single `wp:group` with VERTICAL flex (`"orientation":"vertical"`, `"flexWrap":"nowrap"`) so sections stack. `"justifyContent":"flex-start"` by default; `space-between` only when the design pins something to the bottom. Padding lives on this inner group, never on the `.site-right-sidebar` wrapper (it is a grid item).

### Section label (optional, common)

A small uppercase mono label naming the column: "On this page" (TOC), "Details" / "Metadata" (sheet), "Related" (rail), "Actions" (utility). Skip it for colophon rails. Treat it as wayfinding (`x-small`/`2x-small`, mono, uppercase, generous letter-spacing), not a heading.

### Body content

For TOC, seed a static `wp:list` of in-page anchor links (`href="#overview"` etc.). For Metadata, use small grouped `wp:paragraph` rows in mono type with `<strong>` labels. For Related, use `<!-- wp:latest-posts {"postsToShow":4,...} /-->`. For Colophon, a small paragraph plus optional `wp:social-links` to external profiles. TOC anchor links inside `wp:list` are fine — they are per-page, not site-wide nav.

### Typography scale

Chrome-scale, same as the left sidebar: section label `x-small`/`2x-small` mono uppercase; TOC items / metadata rows / related items at most `small`; colophon paragraph `small`. NEVER pair weight ≥ 700 with `fontSize` `large`+. Any `wp:latest-posts` / `wp:categories` / list-style block MUST carry an explicit `style.typography.fontSize` of `small` or smaller.

### Hard rules

- NO `<!-- wp:site-title /-->` here — the left sidebar carries the wordmark.
- NO `<!-- wp:navigation -->` with `<!-- wp:page-list /-->` here — the left sidebar carries the primary nav. Per-page TOC anchor links inside `wp:list` are the only nav-like content allowed.
- NO attribution credit here — that belongs in the left sidebar's footer cluster.
- Borders, when used, are a hairline `0.5px` `border-left` separating the rail from main content, configured in `style.css`, not on this block.
- Every block declaring `backgroundColor` MUST declare a paired `textColor`; dual-sidebar themes typically use the same tinted panel surface left and right so the main column reads as the center of gravity.

---

Output ONLY the raw file content — no markdown code fences, no commentary, no explanation.
