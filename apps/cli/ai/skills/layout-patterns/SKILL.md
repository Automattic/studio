---
name: layout-patterns
description: Reusable WordPress block-theme layout and motion patterns — fixed sidebar, sticky elements, scrollytelling, magazine grid, landing page, floating chrome, and query-loop layouts, with the CSS gotchas that make them work.
---

# Layout patterns for WordPress block themes

Concrete, copy-pasteable layout and motion patterns for the generated **presentation theme**. Every pattern here lives in the theme package — `theme.json`, `style.css`, `templates/*.html`, `parts/*.html`, and (for motion) a plain-JS file in `assets/` enqueued from `functions.php`. None of it lives in the companion plugin; the plugin handles CPTs, REST, and custom blocks, not layout.

Where you write the files:

- Theme: `<site>/wp-content/themes/<slug>/` — `theme.json`, `style.css`, `templates/`, `parts/`, `assets/`, and a minimal `functions.php` (front-end `style.css` enqueue + `add_editor_style` + any motion-JS enqueue + the `body_class` filters below). NOTHING else in `functions.php`.
- Motion JS: `<site>/wp-content/themes/<slug>/assets/<name>.js`. You write these files yourself (the companion is build-less plain JS too, but these are theme front-end scripts). No bundler, no npm, no Interactivity API — plain DOM APIs only.

Universal rules that apply to every pattern below:

- **Custom classNames go ONLY on the outermost block wrapper** via the block `className` attribute. Never hand-author classNames onto inner DOM. CSS hooks key off the wrapper class plus WordPress's generated structure.
- **Full-bleed sections** = an outer `wp:group` with `"align":"full"`. Do not fake full-bleed with negative margins.
- **Any block that sets `backgroundColor` MUST also set `textColor`** (and `wp:navigation` needs the full color set — see the navigation note). A background without a paired text color is the #1 cause of invisible text.
- **Sticky goes on the `.wp-block-template-part` wrapper, not the inner group.** See "Sticky positioning" — this is the single most common motion bug.
- **Scroll animations are progressive enhancement**: CSS defines the FINAL visible state; JS adds the initial hidden state. If JS never runs, content is visible. Every animation is wrapped in `@media (prefers-reduced-motion: no-preference)` (or guarded in JS).
- **No emojis. No decorative HTML comments** — only block delimiter comments (`<!-- wp:... -->`).

---

## 1. Sticky positioning (read this before any sticky CSS)

### Why the obvious approach fails

The natural impulse — `position: sticky` on the inner `wp:group` of the header part — fails on every block theme. `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->` renders:

```html
<header class="wp-block-template-part">
    <div class="wp-block-group my-header-class">...</div>
</header>
```

The inner group is the only child of `<header>`, so `<header>` is exactly as tall as the group. `position: sticky` un-sticks when the parent's bottom edge passes the offset — and that happens after **zero pixels of scroll**. Technically correct, visibly broken.

### The fix: target the template-part wrapper

`<header>` is a direct child of `.wp-site-blocks` (page-height). Stick the wrapper, not the inner group:

```css
.wp-site-blocks > header.wp-block-template-part {
    position: sticky;
    top: 0;
    z-index: 100;
}
```

Now the containing block is `.wp-site-blocks` (full page height) and the header sticks for the whole scroll.

### Shrink-on-scroll (JS toggles a class on the INNER group)

Sticky lives on the wrapper; visual transitions live on the inner group, where JS toggles `.is-shrunk`:

```css
.my-header-class {
    transition: padding 0.3s ease, box-shadow 0.3s ease;
}
.my-header-class.is-shrunk {
    padding-top: var(--wp--preset--spacing--20) !important;
    padding-bottom: var(--wp--preset--spacing--20) !important;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}
.my-header-class.is-shrunk .wp-block-site-title { font-size: 1.15rem !important; }
```

`assets/header-scroll.js` (write it, enqueue it in footer from `functions.php`):

```js
document.addEventListener('DOMContentLoaded', function () {
    var inner = document.querySelector('.my-header-class');
    if (!inner) return;
    var threshold = 60, shrunk = false;
    function onScroll() {
        var scrolled = window.scrollY > threshold;
        if (scrolled === shrunk) return;
        shrunk = scrolled;
        inner.classList.toggle('is-shrunk', shrunk);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
}); 
```

### Overflow ancestors silently kill sticky

`position: sticky` fails if ANY ancestor between the sticky element and the viewport has `overflow: hidden | auto | scroll | clip`. Common traps: `body { overflow-x: hidden }` (added to tame full-bleed), `.wp-site-blocks { overflow: clip }`, or a wrapper group with overflow set to clip a pseudo-element. If sticky mysteriously fails after you've targeted the right element, audit ancestor `overflow` in DevTools and force:

```css
:root, body, .wp-site-blocks { overflow: visible; }
```

### Sticky on anything else

Same principle: the element's **containing block must be much taller than the element**. Sidebar TOC → stick the column whose parent is the tall main column. CTA bar at page root → stick its group (parent is `.wp-site-blocks`). In-section heading → stick it inside its tall section. Ask: "is the parent significantly taller than this element?" If not, move the sticky declaration up a level.

---

## 2. Fixed sidebar layouts (one or two pinned columns)

For sidebar-left, sidebar-right, or dual-sidebar shells. The obvious approach (`body { display: flex }`, `position: fixed` sidebar, `margin-left` on main) breaks WordPress's root-padding-aware alignments and detaches sidebar height from content height. Use **CSS Grid on `.wp-site-blocks` + `position: sticky` on the sidebar grid item** instead.

### Single sidebar — style.css

```css
.wp-site-blocks {
    display: grid;
    grid-template-columns: var(--wp--custom--sidebar-width, 280px) 1fr;
    min-height: 100vh;
}
.wp-site-blocks.has-sidebar-right {
    grid-template-columns: 1fr var(--wp--custom--sidebar-width, 280px);
}

.wp-block-template-part.site-sidebar {
    grid-column: 1;
    grid-row: 1;              /* required — see auto-placement gotcha */
    position: sticky;
    top: 0;
    align-self: start;        /* without this the item stretches and sticky never engages */
    height: 100vh;
    overflow-y: auto;
    border-right: 1px solid var(--wp--preset--color--rule);
}
.wp-site-blocks.has-sidebar-right .wp-block-template-part.site-sidebar {
    grid-column: 2;
    border-right: 0;
    border-left: 1px solid var(--wp--preset--color--rule);
}

.main-content-area {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;             /* lets long words/URLs wrap instead of overflowing the grid item */
}
.wp-site-blocks.has-sidebar-right .main-content-area { grid-column: 1; }

/* align:full inside main must clamp to the main column, not punch across the sidebar */
.main-content-area .alignfull {
    margin-left: 0; margin-right: 0; width: 100%; max-width: 100%;
}

@media (max-width: 782px) {
    .wp-site-blocks,
    .wp-site-blocks.has-sidebar-right { grid-template-columns: 1fr; }
    .wp-block-template-part.site-sidebar {
        position: static; height: auto; overflow: visible;
        border-right: 0; border-bottom: 1px solid var(--wp--preset--color--rule);
        grid-column: 1;
    }
    .main-content-area { grid-column: 1; }
    .main-content-area .alignfull {
        margin-left: calc(var(--wp--style--root--padding-left, 0px) * -1);
        margin-right: calc(var(--wp--style--root--padding-right, 0px) * -1);
        width: auto; max-width: none;
    }
}
```

### Auto-placement gotcha — both items need `grid-row: 1`

Without an explicit `grid-row`, CSS Grid auto-places left-to-right. For `sidebar-right` the sidebar lands in (row 1, col 2), the cursor wraps to row 2, and the main column gets pushed down by a full `100vh` — a phantom empty viewport above the header. Setting `grid-row: 1` on **both** items makes placement deterministic in both modes. Do not use `grid-auto-flow: dense` instead — it reorders later items unpredictably.

### theme.json (single sidebar)

```json
{
    "settings": { "custom": { "sidebarWidth": "280px" } },
    "templateParts": [
        { "name": "header",  "title": "Header",  "area": "header" },
        { "name": "sidebar", "title": "Sidebar", "area": "uncategorized" },
        { "name": "footer",  "title": "Footer",  "area": "footer" }
    ]
}
```

Width 240–320px; below 220px nav labels truncate, above 360px main stops feeling like the focus.

### Template shell (single sidebar) — EXACTLY two top-level children

Every template (`index.html`, `page.html`, `single.html`, archives, CPT singles) uses this shape:

```html
<!-- wp:template-part {"slug":"sidebar","tagName":"aside","className":"site-sidebar"} /-->

<!-- wp:group {"className":"main-content-area","style":{"spacing":{"margin":{"top":"0"},"padding":{"top":"0","bottom":"0","left":"0","right":"0"},"blockGap":"0"}},"layout":{"type":"default"}} -->
<div class="wp-block-group main-content-area" style="margin-top:0;padding-top:0;padding-right:0;padding-bottom:0;padding-left:0">
    <!-- wp:template-part {"slug":"header","tagName":"header"} /-->
    <!-- wp:post-content {"layout":{"type":"constrained"}} /-->
    <!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
</div>
<!-- /wp:group -->
```

- `className="site-sidebar"` on **every** sidebar reference. Forget it in one template and that page renders the sidebar in-flow while others pin it.
- Header + footer render **inside** `.main-content-area` (they scroll with main, not next to the sidebar).
- For `sidebar-right`, add `has-sidebar-right` to `.wp-site-blocks`/`<body>` via the `body_class` filter in `functions.php`.

### parts/sidebar.html

A single `wp:group` with `layout.type:"flex"`, `orientation:"vertical"`, `justifyContent:"space-between"`: wordmark (`wp:site-title`) at the top, vertical `wp:navigation` (with `wp:page-list`, `orientation:"vertical"`) below, an optional contact strip, and a small footer credit pinned to the bottom. **Vertical padding lives on this inner group, never on the `.site-sidebar` wrapper** — the wrapper is a grid item and padding it clashes with column sizing.

Under sidebar mode the header carries NO primary nav (the sidebar does). Either omit `parts/header.html` entirely (preferred for minimalist designs) or make it a thin utility top-bar (search/account/cart, 36–48px). Never the full site-title + nav strip.

### Dual sidebar (three columns)

Same pattern with a third pinned rail for per-page wayfinding (TOC, metadata, related links):

```css
.wp-site-blocks {
    display: grid;
    grid-template-columns:
        var(--wp--custom--sidebar-width, 260px) 1fr var(--wp--custom--right-sidebar-width, 240px);
    min-height: 100vh;
}
.wp-block-template-part.site-sidebar,
.wp-block-template-part.site-right-sidebar {
    grid-row: 1; position: sticky; top: 0; align-self: start;
    height: 100vh; overflow-y: auto;
}
.wp-block-template-part.site-sidebar       { grid-column: 1; border-right: 1px solid var(--wp--preset--color--rule); }
.wp-block-template-part.site-right-sidebar { grid-column: 3; border-left:  1px solid var(--wp--preset--color--rule); }
.main-content-area { grid-column: 2; grid-row: 1; min-width: 0; }
.main-content-area .alignfull,
.main-content-area .alignwide { margin-left: 0; margin-right: 0; width: 100%; max-width: 100%; }

@media (max-width: 1024px) {                              /* drop the auxiliary right rail first */
    .wp-site-blocks { grid-template-columns: var(--wp--custom--sidebar-width, 260px) 1fr; }
    .wp-block-template-part.site-right-sidebar { display: none; }
}
@media (max-width: 782px) {                               /* then stack everything */
    .wp-site-blocks { grid-template-columns: 1fr; }
    .wp-block-template-part.site-sidebar,
    .wp-block-template-part.site-right-sidebar {
        position: static; height: auto; overflow: visible; border: 0; grid-column: 1;
    }
    .wp-block-template-part.site-right-sidebar { display: block; }
    .main-content-area { grid-column: 1; }
}
```

theme.json adds `rightSidebarWidth` (220–260px, a hair smaller than the left so weight reads left→center→right), a `right-sidebar` template part, and tightens `settings.layout.contentSize` to ~720px (documentation reading columns are narrow). The template emits **exactly three** top-level children: sidebar, `.main-content-area`, right-sidebar — both with their respective `className`. Right-rail typography is chrome-scale (`small` or smaller) throughout.

---

## 3. Landing page (one-pager with anchor nav)

Single scrollable page: sticky header with anchor-linked nav, then 3–6 stacked viewport-height sections. The trap: a sticky header makes anchor jumps land the section's top edge BEHIND the header, hiding its heading. Fix with `scroll-padding-top`.

```css
.wp-site-blocks > header.wp-block-template-part {
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(8px);
    background: var(--wp--preset--color--background);
}
html {
    scroll-behavior: smooth;
    scroll-padding-top: var(--wp--custom--scroll-padding-top, 80px);
}
.wp-site-blocks .alignfull[id] {
    min-height: 100vh; display: flex; flex-direction: column; justify-content: center;
}
.wp-site-blocks .alignfull[id="signup"] {            /* short final form shouldn't force empty scroll */
    min-height: auto;
    padding-top: var(--wp--preset--spacing--80);
    padding-bottom: var(--wp--preset--spacing--80);
}
.wp-site-blocks .alignfull[id]:target {
    box-shadow: inset 4px 0 0 var(--wp--preset--color--accent);
    transition: box-shadow 200ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .wp-site-blocks .alignfull[id]:target { box-shadow: none; transition: none; }
}
```

theme.json: `settings.custom.scrollPaddingTop` (64–96px, matches rendered header height), `contentSize` ~800px.

Section ids belong on the page-body section groups, via the `anchor` block attribute (which becomes the rendered `id`) — NEVER a raw `<div id="...">`, the editor strips it:

```html
<!-- wp:group {"align":"full","anchor":"features","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" id="features" style="padding-top:var(--wp--preset--spacing--80);padding-bottom:var(--wp--preset--spacing--80)">
    ...
</div>
<!-- /wp:group -->
```

Navigation uses hand-authored `wp:navigation-link` with `kind:"custom"` and hash URLs (this is the one place hand-authored links are correct, vs the usual `wp:page-list`):

```html
<!-- wp:navigation-link {"label":"Features","url":"#features","kind":"custom"} /-->
<!-- wp:navigation-link {"label":"Pricing","url":"#pricing","kind":"custom"} /-->
```

Section ids MUST match the nav hashes exactly (case-sensitive) — a typo breaks the click silently. Final nav item is usually a CTA `wp:button` anchored to `#signup`.

---

## 4. Magazine grid (the homepage IS the archive)

Editorial themes: thin masthead, a lead story at high weight, then a uniform 3-column card grid. A single query loop can't make "the first item bigger," so use **two `wp:query` blocks**: first `perPage:1` (lead), second `perPage:6` with `offset:1` (grid). CSS keys off two class hooks: `is-style-lead-story` and `is-style-loop-magazine`.

```css
.wp-site-blocks > header.wp-block-template-part { border-bottom: 1px solid var(--wp--preset--color--rule); }
.wp-site-blocks > header.wp-block-template-part > .wp-block-group {
    display: flex; align-items: center; justify-content: space-between;
    padding-top: var(--wp--preset--spacing--30); padding-bottom: var(--wp--preset--spacing--30);
}

.wp-block-query.is-style-lead-story .wp-block-post-template { display: block; }
.wp-block-query.is-style-lead-story .wp-block-post-featured-image { aspect-ratio: 16 / 9; margin-bottom: var(--wp--preset--spacing--40); }
.wp-block-query.is-style-lead-story .wp-block-post-featured-image img { width: 100%; height: 100%; object-fit: cover; }
.wp-block-query.is-style-lead-story .wp-block-post-title { font-size: clamp(2rem, 4vw, 3rem); line-height: 1.1; }

.wp-block-query.is-style-loop-magazine .wp-block-post-template {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--wp--preset--spacing--50);
}
.wp-block-query.is-style-loop-magazine .wp-block-post-template > li { display: flex; flex-direction: column; }
.wp-block-query.is-style-loop-magazine .wp-block-post-featured-image { aspect-ratio: 4 / 3; margin-bottom: var(--wp--preset--spacing--30); }
.wp-block-query.is-style-loop-magazine .wp-block-post-date { margin-top: auto; }   /* pins byline to card bottom */

@media (max-width: 960px) { .wp-block-query.is-style-loop-magazine .wp-block-post-template { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .wp-block-query.is-style-loop-magazine .wp-block-post-template { grid-template-columns: 1fr; } }

.wp-block-query.is-style-lead-story + .wp-block-query.is-style-loop-magazine {
    margin-top: var(--wp--preset--spacing--80);
    padding-top: var(--wp--preset--spacing--60);
    border-top: 1px solid var(--wp--preset--color--rule);
}
```

theme.json must set `core/post-template.spacing.blockGap` (without it the grid items collapse) and tighten `contentSize` to ~720px:

```json
{
    "settings": { "layout": { "contentSize": "720px", "wideSize": "1280px" } },
    "styles": { "blocks": {
        "core/post-template": { "spacing": { "blockGap": "var:preset|spacing|50" } },
        "core/query":         { "spacing": { "blockGap": "var:preset|spacing|60" } }
    } }
}
```

The home template opens with the two query blocks — NEVER `wp:post-content`. Bylines render in a mono font, uppercase, letter-spaced. Homepage usually doesn't paginate ("see all" links to category archives); if needed add `wp:query-pagination` inside the second query, styled small/uppercase/mono — never large pill buttons.

---

## 5. Floating chrome / canvas (imagery owns the viewport)

Photography portfolios, galleries, lookbooks: every image reaches all four viewport edges; chrome is just a floating wordmark + menu via `position: fixed`. Wrong shape for text-heavy sites.

Root padding must be zero here (and only here) so full-bleed means literally the viewport edge, not edge-minus-gutter:

```json
{
    "styles": { "spacing": { "padding": { "top": "0", "bottom": "0", "left": "0", "right": "0" } } },
    "settings": { "useRootPaddingAwareAlignments": true, "layout": { "contentSize": "760px", "wideSize": "1280px" } }
}
```

Keep `useRootPaddingAwareAlignments: true` so text pages can still constrain to `contentSize`.

```css
.wp-site-blocks > header.wp-block-template-part {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    pointer-events: none;                         /* let clicks pass through the band */
    padding: var(--wp--preset--spacing--40) var(--wp--preset--spacing--50);
}
.wp-site-blocks > header.wp-block-template-part > .wp-block-group {
    pointer-events: auto;                         /* restore on actual chrome */
    display: flex; justify-content: space-between; align-items: flex-start;
    mix-blend-mode: difference;                   /* legible against any image */
    color: white;                                 /* difference flips this per backdrop — do NOT use literal #000/#fff */
}
.canvas-hero .wp-block-image, .canvas-hero .wp-block-cover { width: 100vw; height: 100vh; margin: 0; }
.canvas-hero .wp-block-image img, .canvas-hero .wp-block-cover img { width: 100%; height: 100%; object-fit: cover; }
.canvas-caption {                                 /* captions BETWEEN images, never overlaid */
    padding: var(--wp--preset--spacing--40) var(--wp--preset--spacing--50);
    max-width: var(--wp--style--global--content-size);
    font-family: var(--wp--preset--font-family--mono);
    font-size: var(--wp--preset--font-size--x-small);
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--wp--preset--color--muted);
}
.wp-block-navigation__responsive-container {      /* hamburger overlay reads cleanly */
    background: var(--wp--preset--color--background);
    color: var(--wp--preset--color--foreground);
    mix-blend-mode: normal;
}
```

The `mix-blend-mode: difference` + `color: white` combo keeps the wordmark/menu legible over any photo (white over black = white, white over white = black). The `pointer-events` flip is mandatory — without `auto` on children the fixed band swallows every click. Homepage `<main>` uses `layout.type:"default"` with zero padding so the hero reaches the edges; text pages (about/contact) restore `constrained` layout with comfortable padding. The nav uses `overlayMenu:"always"` (the hamburger IS the menu on every viewport). Register a `has-floating-chrome` body class via `body_class`.

---

## 6. Scroll motion catalog (progressive enhancement only)

Use one or two effects, tastefully. NO libraries (GSAP, Lenis, ScrollMagic, AOS), NO scroll-jacking (`wheel` + `preventDefault`, scroll-snap on the body), NO `position: fixed` headers (use sticky), NO `background-attachment: fixed` parallax. Animate only `opacity`, `transform`, `filter`, `background-color` (never `width`/`height`/`top`/`padding` — they trigger layout).

Every effect respects reduced motion. CSS-only effects wrap in `@media (prefers-reduced-motion: no-preference)`; JS effects early-return on `matchMedia('(prefers-reduced-motion: reduce)').matches`. **CSS defines the final visible state; JS adds the initial hidden state** so a JS failure leaves content visible.

Motion CSS that sets `opacity: 0` must NOT load in the editor iframe (`add_editor_style` would blank the canvas). Keep reveal/hidden-state CSS in a separate `assets/motion.css` enqueued front-end-only via `wp_enqueue_scripts`, NOT in `style.css`. Frontend-only body-class effects (e.g. `body.is-scrolled`) are safe in `style.css` since the class only toggles on the front end.

### A. Section reveal on enter (IntersectionObserver) — the always-on default

```css
@media (prefers-reduced-motion: no-preference) {
    .reveal-on-scroll { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease, transform 0.7s ease; }
    .reveal-on-scroll.is-visible { opacity: 1; transform: translateY(0); }
}
```

Add `className:"reveal-on-scroll"` to each top-level section group (NOT the hero — it's visible on load). `assets/reveal-on-scroll.js` (write + enqueue):

```js
(function () {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var els = document.querySelectorAll('.reveal-on-scroll');
    if (!('IntersectionObserver' in window) || !els.length) return;
    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
        });
    }, { rootMargin: '0px 0px -10% 0px' });
    els.forEach(function (el) { io.observe(el); });
})();
```

### B. Hero scroll-fade (CSS scroll-driven, no JS)

```css
@media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: scroll()) {
        .hero-content {
            opacity: 1; transform: translateY(0);
            animation: hero-fade linear both;
            animation-timeline: scroll(root);
            animation-range: 0px 60vh;
        }
        @keyframes hero-fade { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-40px); } }
    }
}
```

Apply `hero-content` to the inner content group of the hero `wp:cover` (not the cover itself). First hero only. Browsers without the API get a static hero (acceptable).

### C. Scroll progress bar (CSS scroll-driven) — longform/editorial only

```css
@media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: scroll()) {
        .scroll-progress {
            position: fixed; top: 0; left: 0; right: 0; height: 3px;
            background: var(--wp--preset--color--accent, currentColor);
            transform-origin: left center; transform: scaleX(0); z-index: 1000;
            animation: scroll-progress-grow linear; animation-timeline: scroll(root);
        }
        @keyframes scroll-progress-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
    }
}
```

Emit `<div class="scroll-progress" aria-hidden="true"></div>` at the top of the page body (it's decorative — screen readers must ignore it).

### D. Sticky narrative + scrolling visuals (NYT-style) — case studies only

```css
@media (prefers-reduced-motion: no-preference) {
    .narrative-pin > .wp-block-column:first-child {
        position: sticky; top: var(--wp--custom--scroll-padding-top, 96px); align-self: flex-start;
    }
}
```

`wp:columns {"className":"narrative-pin"}`: first column = short pinned text (must fit one viewport, else nothing to pin), second column = the long scrolling stack.

### E. Counter on enter (IntersectionObserver) — only with 2–4 real stat numbers

Markup: `<h2 class="counter" data-counter-target="600000" data-counter-suffix="+">0</h2>`. Write `assets/counter.js`: early-return on reduced motion (render final value immediately), IntersectionObserver to a cubic ease-out count-up, `toLocaleString()` for separators.

### Header on-scroll variants (pick AT MOST one)

`assets/header-scroll.js` toggles `body.is-scrolled` past a 60px threshold and (under no-preference) `body.header-hidden` while scrolling down. Variants:

1. **Shrink** — section 1's `.is-shrunk` pattern.
2. **Invert** — transparent over hero, solid past fold (needs the picked palette tokens, so this CSS goes in `style.css` keyed off `body.is-scrolled`):
   ```css
   @media (prefers-reduced-motion: no-preference) {
       .wp-site-blocks > header.wp-block-template-part > .wp-block-group { transition: background-color 0.3s ease, color 0.3s ease, backdrop-filter 0.3s ease; }
       body.is-scrolled .wp-site-blocks > header.wp-block-template-part > .wp-block-group {
           background-color: var(--wp--preset--color--background); color: var(--wp--preset--color--primary); backdrop-filter: blur(8px);
       }
   }
   ```
3. **Hide on scroll-down, show on scroll-up** (longform):
   ```css
   @media (prefers-reduced-motion: no-preference) {
       .wp-site-blocks > header.wp-block-template-part { transition: transform 0.3s ease; }
       body.header-hidden .wp-site-blocks > header.wp-block-template-part { transform: translateY(-100%); }
   }
   ```
4. **Active-anchor underline** (landing-page only) — `assets/active-anchor.js` watches each `<section id>` and toggles `.is-active` on the matching `<a href="#...">` (use `rootMargin: -40% 0px -40% 0px` to track the viewport's middle band):
   ```css
   @media (prefers-reduced-motion: no-preference) {
       .wp-block-navigation a { position: relative; }
       .wp-block-navigation a::after { content: ''; position: absolute; left: 0; right: 0; bottom: -4px; height: 2px; background: currentColor; transform: scaleX(0); transform-origin: left center; transition: transform 0.3s ease; }
       .wp-block-navigation a.is-active::after { transform: scaleX(1); }
   }
   ```

### Per-page budget

- **Homepage**: section reveal (A) is mandatory and free; pick 1–2 of B/C/D/E and at most ONE header variant. Zero rich effects is also valid for minimal themes.
- **Other pages**: section reveal (A) only.
- **CPT single entries**: none.

Enqueue each motion JS in the footer from `functions.php`:

```php
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_script(
        'myprefix-reveal-on-scroll',
        get_theme_file_uri( 'assets/reveal-on-scroll.js' ),
        array(), wp_get_theme()->get( 'Version' ), true
    );
} );
```

---

## 7. Query-loop layouts (front-end archives and listings)

Content is seeded into the live DB (via WP-CLI / the seed_content tool), and CPTs/meta come from the companion plugin. The theme's job is the **loop layout** in templates. Every `wp:query` loop is three decisions: (1) per-item data composition, (2) loop shape, (3) page composition around it. Don't stamp one shape on every CPT.

### The single hard rule

**Never put `wp:post-content` inside an archive's `wp:post-template`.** It renders the full single-page body for every entry — a wall of full posts. Compose from post-* primitives: `wp:post-featured-image`, `wp:post-title`, `wp:post-excerpt`, `wp:post-date`, `wp:post-author-name`. `wp:post-content` is correct only in `single-<cpt>.html` (one detail page, not a loop).

### Rendering structured meta (price, role, year, date)

There is NO `wp:post-meta` block — emitting it renders nothing. Use **block bindings** on a paragraph or heading (the companion plugin registers each meta key with `show_in_rest => true`, which bindings require):

```html
<!-- wp:paragraph {"metadata":{"bindings":{"content":{"source":"core/post-meta","args":{"key":"price"}}}},"fontSize":"small"} -->
<p></p>
<!-- /wp:paragraph -->
```

For a labelled value ("Maker: …"), pair a static paragraph and a bound paragraph in a flex `wp:group`. The empty `<p></p>` is a placeholder replaced at render time.

### Picking a shape (decide in this order)

1. **Page role** is decisive.
   - Homepage preview (archive lives elsewhere) → horizontal rail or compact 3-col grid, capped 4–6. NOT editorial list / zigzag / cover-hero — giant single-column rows look broken on a homepage.
   - Hero archive (the loop IS the page) → richest shapes: editorial list, zigzag, magazine, featured+rest.
   - Secondary listing → grid or list. Mid-page band → rail, compact list, simple grid.
2. **Entry count** (dedicated archives): 3–6 → editorial list / zigzag / cover-hero; 6–12 → grid (2–3 col) / featured+rest; 12–30 → dense grid / compact list; 30+ → compact list / pagination / sibling loops.
3. **Visual weight per entry**: portraits → grid; long detail → editorial list / zigzag; single value (price) → compact list; photographic → cover-hero; prose → magazine / featured+rest.
4. **Brand voice**: editorial → list/magazine; minimal → consistent-chrome grid; lookbook → cover-hero/magazine; brutalist → hairline-border grid/compact list.
5. **Natural data axis**: chronological → timeline / date-ordered; tiered → featured+rest; two slices → sibling loops; geographic → compact list with location meta.

Pick by **domain purpose, not slug** — a CPT listing dentists is People (portrait + name + role), not "Default."

### Shape: Card grid (equal-weight uniform grid)

```html
<!-- wp:query {"query":{"postType":"<cpt-slug>","perPage":12,"order":"asc","orderBy":"menu_order"},"align":"wide"} -->
<div class="wp-block-query"><!-- wp:post-template {"layout":{"type":"grid","columnCount":3},"style":{"spacing":{"blockGap":"var:preset|spacing|40"}}} -->
<!-- wp:group {"tagName":"article","style":{"spacing":{"padding":"var:preset|spacing|30","blockGap":"var:preset|spacing|20"},"border":{"radius":"12px"}},"layout":{"type":"constrained"}} -->
<article class="wp-block-group">
    <!-- wp:post-featured-image {"isLink":true,"aspectRatio":"4/3","style":{"border":{"radius":"8px"}}} /-->
    <!-- wp:post-title {"isLink":true,"level":3,"fontSize":"medium"} /-->
    <!-- wp:paragraph {"metadata":{"bindings":{"content":{"source":"core/post-meta","args":{"key":"price"}}}},"fontSize":"small"} -->
    <p></p>
    <!-- /wp:paragraph -->
    <!-- wp:post-excerpt {"excerptLength":18} /-->
</article>
<!-- /wp:group -->
<!-- /wp:post-template --></div>
<!-- /wp:query -->
```

### Shape: Editorial list / vertical stack (image-side rows, detail-heavy)

Two-column rows (image 40% / text 60%), `align:"wide"`, `className:"is-style-loop-list"` (CSS adds row dividers). Use `wp:columns` with `verticalAlignment:"center"`; surface an overline meta paragraph, a large `wp:post-title`, and a longer `wp:post-excerpt`.

### Shape: Horizontal rail (scrollable strip, "more elsewhere")

`className:"is-style-loop-rail"`, `align:"full"`, `post-template` layout `flex`/`flexWrap:"nowrap"`. CSS adds `overflow-x: auto` + scroll-snap; cards get a fixed width. Cap 4–8 entries.

### Shape: Cover-hero (featured image as background, title overlaid)

`wp:cover {"useFeaturedImage":true,"dimRatio":40,"minHeight":420,"isLink":true}` inside a grid `post-template`. Title + meta go in `wp-block-cover__inner-container` with `textColor:"background"` (text over the dimmed image). Image-dominant — galleries, photo menus.

### Shape: Featured + rest (one promoted, the rest in a grid)

Needs **two queries**: first `perPage:1` rendered as a large cover-hero; second `perPage:6,"offset":1` as a 3-col grid (offset skips the featured entry). No labelling comment between them.

### Shape: Compact list, zigzag, timeline, magazine

- **Compact list** (`is-style-loop-list`): one flex row per entry, title + meta, no images. Long indexes (press, episodes, jobs).
- **Zigzag** (`is-style-loop-zigzag`): full-width image-text rows; CSS flips column order on `:nth-child(even)`. Portfolio walks, recipes.
- **Timeline** (`is-style-loop-timeline`): `orderBy:"meta_value"` on a date key; CSS adds a vertical line + node dots via `::before`. Events, milestones.
- **Magazine** (`is-style-loop-magazine`): grid where CSS makes the first child span 2 columns. Editorial homepages.

When a shape needs a hook, add `className:"is-style-loop-<shape>"` to the `wp:query` and ship the matching rule in `style.css`. The shapes are starting points — invent new ones with the post-* primitives + standard layout blocks when the data calls for it (e.g. a status board, a comparison rail).

### Page composition around the loop

Surround the loop with the page's voice: intro + loop + CTA (most pages); manifesto + loop (about/team); hero feature + archive (editorial homepages); loop as one band among full-bleed bands; or loop + sibling loop (two queries slicing the same CPT — "upcoming / past" via `metaQuery` on a date key, "featured / recent" via `offset`). Each sibling loop can pick its own shape.

---

## Cross-cutting checklist

1. Custom classNames only on outer block wrappers; full-bleed via `align:full` outer group.
2. `backgroundColor` always paired with `textColor`; nav gets the full color set.
3. Sticky on the `.wp-block-template-part` wrapper; audit ancestor `overflow` if it fails.
4. Grid layouts: `min-width: 0` on text grid items; explicit `grid-row: 1` on sidebar shells.
5. Motion: final state in CSS, initial hidden state added by JS; every effect respects reduced motion; reveal CSS stays out of `style.css` (out of the editor iframe).
6. Never `wp:post-content` in a loop's `post-template`; render meta via block bindings (no `wp:post-meta`).
7. No emojis, no decorative HTML comments. Plain-JS motion files in `assets/`, enqueued front-end-only — no bundler, no Interactivity API.
