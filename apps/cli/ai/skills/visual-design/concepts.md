# Signature Concepts

Catalog behind the `visual-design` skill's concept shortlist. The Skill tool samples a random, category-spread subset of these entries into the runbook on every load, so the same brief gets a different shortlist each run. Each `##` heading is a category; each `###` heading is one concept with three fixed lines: **Fits**, **Build**, **Fallback**.

Every concept is written to be buildable inside a block theme with the tools Studio Code has: `theme.json`, `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Content stays editable in blocks. Motion respects `prefers-reduced-motion`, and CSS scroll-driven animations (`animation-timeline: scroll()` / `view()`) sit inside `@supports` with a static or IntersectionObserver fallback.

## Hero & cover

### Four-tile cover
A cover made of four squares that together fill the viewport; each tile carries one part of the hero (image, headline, color field, call to action) and enters with a short stagger.
Fits: studios, portfolios, brands with strong imagery or a four-part offer.
Build: full-height group with a 2×2 CSS grid (`height: 100dvh`), each tile a group or cover block; entrance via `@keyframes` with per-tile `animation-delay`.
Fallback: tiles stack into a single column on small screens; no entrance animation under reduced motion.

### Split cover with a moving seam
Two half-screen panels (image and message) share a seam that slides toward the side the visitor hovers or scrolls toward, revealing more of it.
Fits: two-audience businesses, before/after services, duo brands.
Build: grid with `grid-template-columns: var(--seam, 1fr) 1fr`, hover updates `--seam` via CSS on each half, or a 10-line script maps pointer x to the variable.
Fallback: static 50/50 split; panels stack on mobile.

### Typographic wall
The hero is nothing but text: a headline sized to fill the viewport, line-broken deliberately, with the color and one small line of supporting copy doing all the work.
Fits: agencies, writers, manifestos, anything with a strong sentence.
Build: heading with `font-size: clamp(3rem, 12vw, 14rem)`, `line-height: 0.9`, `text-wrap: balance`, tight letter-spacing; palette color as the ground.
Fallback: none needed; the clamp keeps it legible at every size.

### Curtain reveal
Two solid panels in the accent color slide apart on first load to reveal the hero underneath, like stage curtains.
Fits: theaters, events, launches, restaurants with a dramatic tone.
Build: two fixed pseudo-elements on the hero group animated with `translateX` after a short delay, `animation-fill-mode: forwards`; keep it under 900ms.
Fallback: panels are skipped entirely under reduced motion, and only play once per session (`sessionStorage`).

### Keyhole hero
The hero image is seen through a shape (circle, arch, letterform) that expands to full bleed as the visitor scrolls.
Fits: photographers, travel, architecture, wellness.
Build: cover block with `clip-path: circle(20% at 50% 50%)` animated to `circle(100%)` on a `view()` timeline; the shape can be `inset(... round ...)` for an arch.
Fallback: static full-bleed image when scroll timelines are unsupported or motion is reduced.

### Marquee headline
A giant single-line headline scrolls continuously across the full viewport width as the hero, repeating the brand promise.
Fits: shops, festivals, food, streetwear, anything with energy.
Build: a group with `overflow: hidden` containing the paragraph duplicated twice inside a flex track animated with `translateX(-50%)`; pause on hover.
Fallback: marquee stops and shows a single centered line under reduced motion.

### Stacked posters
Three or four rotated, overlapping cards fan out across the hero like posters pinned on a wall, each one a different palette color.
Fits: events, magazines, creative studios, musicians.
Build: absolutely positioned groups with `rotate()` and `translate()` per card, `box-shadow` for depth, top card carries the headline.
Fallback: cards become a straight vertical stack on narrow screens.

### Letterbox cinema
An ultra-wide hero cropped with dark bars top and bottom; the title slides in from the right like a film credit.
Fits: filmmakers, agencies, luxury, storytelling brands.
Build: cover block with `aspect-ratio: 2.39 / 1` inside a dark full-bleed group; heading animated with `translateX` and `letter-spacing` easing in.
Fallback: aspect ratio relaxes to `16 / 9` on mobile; no slide under reduced motion.

### Counter-scrolling columns
A two-column hero where the text column scrolls up normally while the image column drifts upward at a slower rate, so the two feel like separate planes.
Fits: editorial sites, real estate, product pages.
Build: image column translated with a `scroll()` timeline (`translateY(-15%)` over the hero), text column untouched.
Fallback: image column static; columns stack on mobile.

### Diagonal cut
The hero is split by a diagonal line; the two triangles hold image and color, and hovering either side nudges the line toward it.
Fits: sport, tech, bold service brands.
Build: two stacked groups with `clip-path: polygon(...)` and a shared `--cut` variable that hover shifts by a few percent with a transition.
Fallback: on mobile the cut becomes a horizontal split; hover shift disabled on touch.

## Scroll storytelling

### Growing artifact
A single illustrated object (plant, building, product, logo) sits pinned beside the content and grows or unfolds as the visitor scrolls the story.
Fits: gardens, sustainability, product journeys, "how we grew" pages.
Build: sticky column holding an inline SVG; stages toggled by `view()` timelines on paths (`scale`, `stroke-dashoffset`) or an IntersectionObserver that adds `is-stage-2`, `is-stage-3` classes.
Fallback: artifact shown fully grown, static, above the content on mobile.

### Sticky chapter stack
Each section pins to the top as the next one slides over it, like a stack of cards being dealt.
Fits: process pages, case studies, menus with courses.
Build: sections as groups with `position: sticky; top: 0` and increasing `z-index`, each with an opaque palette background and a `border-radius` on the leading edge.
Fallback: normal flow on screens shorter than 600px.

### Drawn path
A line (route, river, thread) drawn in SVG follows the content, its stroke revealing itself as the visitor scrolls past each stop.
Fits: travel, timelines, delivery services, campus tours.
Build: SVG path with `stroke-dasharray` equal to its length and `stroke-dashoffset` animated by a `scroll()` timeline; stops are absolutely positioned groups.
Fallback: fully drawn path, static.

### Horizontal chapter rail
One pinned section scrolls sideways through a row of panels while the page scroll stays vertical.
Fits: galleries, product lineups, team introductions.
Build: tall wrapper (`height: 300vh`) with a sticky track; `translateX` driven by a `scroll()` timeline on the wrapper.
Fallback: track becomes a normal horizontal scroll-snap carousel on mobile or without timeline support.

### Color journey
The page background changes to a different palette color as each section reaches the viewport, so scrolling feels like moving through rooms.
Fits: multi-service businesses, one-page sites, storytelling.
Build: each section sets `--section-bg` on itself; a small IntersectionObserver copies the active section's value onto `body`, with a 600ms `transition: background-color`.
Fallback: sections keep their own backgrounds without the body transition.

### Zoom-through hero
The hero image scales up and blurs slowly as the first content section rises over it, as if the visitor walks into the picture.
Fits: hospitality, destinations, interiors.
Build: sticky hero with `scale(1)` to `scale(1.3)` and `filter: blur(0)` to `blur(6px)` on a `scroll()` timeline; next section has an opaque background and a `margin-top: -10vh` overlap.
Fallback: static hero, no overlap.

### Counting numbers
Key figures tick up from zero when their section enters the viewport.
Fits: charities, agencies, manufacturers, anything with proud numbers.
Build: paragraph blocks with a `data-count` attribute set via a custom class pattern; a 20-line script uses IntersectionObserver plus `requestAnimationFrame` to count, formatting with `Intl.NumberFormat`.
Fallback: final numbers render in the markup, so with no script the values are simply already there.

### Traveling marker
A timeline whose position marker slides down the rail and lights each entry as it passes.
Fits: histories, roadmaps, processes.
Build: a vertical rail with a sticky dot (`position: sticky; top: 50vh`); entries get an `is-past` class from an IntersectionObserver at the same threshold.
Fallback: all entries lit, marker hidden.

### Sentence reveal
A long statement in the middle of the page starts faint and each word brightens to full contrast as it scrolls through the center of the viewport.
Fits: manifestos, about pages, luxury, wellness.
Build: words wrapped in spans by a tiny script (or pre-split in the pattern), each animated from `opacity: .2` to `1` on its own `view()` timeline.
Fallback: full-contrast text.

### Layered landscape
Three or four flat illustrated layers (sky, hills, foreground) move at different speeds behind the hero content.
Fits: outdoors, tourism, children's brands, farms.
Build: absolutely positioned inline SVG layers, each with a `scroll()` timeline translating by a different distance; content sits on the front layer.
Fallback: layers flattened into one static image.

## Backgrounds & atmosphere

### Perspective floor
A grid that recedes toward a horizon, giving the page a 3D room feel without any 3D library.
Fits: tech, games, music, retro-future brands.
Build: a fixed pseudo-element with `background-image: repeating-linear-gradient` lines, `transform: perspective(60vh) rotateX(60deg)`, optional slow `background-position` animation.
Fallback: static grid; animation off under reduced motion.

### Aurora drift
Two or three large soft-edged color blobs drift slowly behind the content, with hues taken from the palette.
Fits: SaaS, wellness, creative services, personal sites.
Build: fixed pseudo-elements with `radial-gradient`, `filter: blur(80px)`, and 30-second `@keyframes` translating each blob along a different path.
Fallback: single static gradient.

### Paper grain
A subtle noise texture over every surface makes flat palette colors feel printed.
Fits: cafés, artisans, publishers, anything analog.
Build: an inline SVG with `feTurbulence` as a `background-image` on a fixed overlay with `mix-blend-mode: multiply` and low opacity.
Fallback: none needed.

### Halftone field
A dot-matrix pattern whose dot size changes across the page or with scroll, like a print screen.
Fits: comics, print shops, retro brands, magazines.
Build: `radial-gradient` dots on a repeating background sized with a `--dot` variable; a `scroll()` timeline or section variable changes `--dot`.
Fallback: fixed dot size.

### Blueprint sheet
A fine grid with coordinate labels along the edges, so the site reads like a technical drawing.
Fits: architects, engineers, makers, hardware.
Build: page background from two `repeating-linear-gradient`s; edge labels are small fixed groups with `writing-mode: vertical-rl`, monospace font.
Fallback: labels hidden on mobile.

### Isometric tiles
A repeating isometric cube pattern in two palette tints as the site's ground.
Fits: logistics, construction, software infrastructure, toys.
Build: an inline SVG tile (three rhombuses) as a repeating `background-image` on `body` or the hero; slow `background-position` drift.
Fallback: static.

### Orbiting shapes
A handful of geometric shapes (circle, ring, triangle) float in slow orbits behind the hero.
Fits: startups, education, kids, playful brands.
Build: absolutely positioned pseudo-elements or small groups with 20 to 40-second `@keyframes` on `transform`, each with a different duration and direction.
Fallback: shapes static; reduced to two on mobile.

### Cursor spotlight background
A soft radial light on the background follows the cursor, revealing a texture or grid only near it.
Fits: portfolios, dark-themed tech, galleries.
Build: `background: radial-gradient(400px at var(--mx) var(--my), ...)` on the hero; a 6-line script writes pointer coordinates to the two variables.
Fallback: light centered and static on touch devices.

### Scanlines
Thin horizontal lines and a faint flicker over dark surfaces evoke a CRT screen.
Fits: retro tech, arcades, music, streetwear.
Build: fixed overlay with `repeating-linear-gradient` at 3px and a very slow opacity keyframe; `pointer-events: none`.
Fallback: flicker off under reduced motion.

### Contour lines
Topographic contour lines wander across the background in a single palette tint, slowly shifting.
Fits: outdoors, cartography, wineries, geology, hiking.
Build: inline SVG of a few nested wobbly paths as a fixed background; a `scroll()` timeline translates it slightly for depth.
Fallback: static.

## Typography

### Kinetic headline
The hero headline enters word by word, each word sliding up from behind a clipped line.
Fits: agencies, launches, consultancies.
Build: heading words wrapped in spans (pattern markup), each inside `overflow: hidden`, `translateY(100%)` to `0` with staggered `animation-delay`.
Fallback: headline visible immediately under reduced motion.

### Weight on scroll
Headings use a variable font whose weight thickens as the section scrolls into the center of the viewport.
Fits: type-driven brands, fashion, editorial.
Build: variable font in `theme.json` `typography.fontFamilies` with `fontFace`, `font-variation-settings: 'wght' var(--w)` driven by a `view()` timeline.
Fallback: fixed weight.

### Outline to fill
Headlines render as outlined letters and fill with color on hover or when they enter the viewport.
Fits: bold brands, sports, streetwear, events.
Build: `-webkit-text-stroke: 1px currentColor; color: transparent` transitioning to filled `color` on `:hover` or an `is-visible` class.
Fallback: filled by default on touch.

### Ticker bands
Thin horizontal marquee strips between sections carry short repeated phrases in the accent color.
Fits: shops, restaurants, festivals, community sites.
Build: pattern with a duplicated paragraph inside an animated flex track; each band alternates direction.
Fallback: static single line under reduced motion.

### Vertical labels
Section titles run vertically along the left edge, like spine labels, leaving the content column clean.
Fits: architecture, galleries, editorial, minimal brands.
Build: heading with `writing-mode: vertical-rl; transform: rotate(180deg)` inside a two-column group with a narrow first column.
Fallback: labels turn horizontal above the content on mobile.

### Oversized numerals
Each section opens with a huge faint index number (01, 02, 03) sitting behind the heading.
Fits: process pages, service lists, menus.
Build: numeral as a paragraph with `font-size: clamp(6rem, 20vw, 18rem)`, low opacity, `position: absolute` behind the heading.
Fallback: numeral shrinks and moves above the heading on mobile.

### Typewriter tagline
The hero's tagline types itself out, cursor blinking, then settles.
Fits: developers, writers, studios, personal sites.
Build: a `steps()` animation on `width` over an `overflow: hidden; white-space: nowrap` span plus a blinking `border-right`.
Fallback: full tagline shown instantly.

### Text around a shape
Body copy flows around a circular or blob-shaped image, magazine style.
Fits: food, biographies, crafts, editorial.
Build: image block floated with `shape-outside: circle()` (or `shape-outside: url()` on the same image) inside a media-text group.
Fallback: image stacks above the text on mobile.

### Highlighter stroke
Key phrases get a hand-drawn highlight that sweeps in when they scroll into view.
Fits: education, coaching, nonprofits, friendly brands.
Build: a registered block style on paragraphs that applies `background: linear-gradient(accent, accent) no-repeat 0 85% / var(--hl, 0%) 40%`, `--hl` animated to `100%` on a `view()` timeline.
Fallback: highlight fully applied.

### Image-filled headline
The hero headline is transparent and the hero image shows through the letterforms.
Fits: travel, photography, food, fashion.
Build: heading with `background-image` from the theme asset, `background-clip: text; color: transparent`, on a solid palette ground.
Fallback: solid-color headline if the image fails to load.

## Motion signatures

### Wipe on load
A solid panel in the accent color wipes off the screen once on first visit, revealing the page.
Fits: agencies, luxury, brands wanting a "curtain up" moment.
Build: fixed full-screen pseudo-element on `body` animated with `translateY(-100%)` after 200ms; `sessionStorage` flag so it plays once.
Fallback: skipped under reduced motion.

### Stagger everything
Every section's children fade and rise into place in a consistent 80ms stagger, so the whole site shares one rhythm.
Fits: any site where consistency is the concept.
Build: `.entry-content > * > *` with a `view()` timeline animating `opacity` and `translateY`, `animation-delay: calc(var(--i) * 80ms)` set by a tiny script.
Fallback: content visible immediately.

### Magnetic buttons
Primary buttons lean a few pixels toward the cursor as it approaches, then snap back.
Fits: agencies, tech, playful brands.
Build: 15-line script on `.wp-element-button` mapping pointer offset to `translate()` with a spring-like `transition`.
Fallback: no effect on touch devices.

### Sheen sweep
A diagonal light sweeps across cards or buttons on hover.
Fits: product sites, premium services.
Build: `::after` with a `linear-gradient` stripe at `translateX(-100%)` transitioning to `100%` on hover, `overflow: hidden` on the parent.
Fallback: none needed.

### Breathing hero element
One element in the hero (logo mark, product, badge) scales very slowly in and out, as if breathing.
Fits: wellness, meditation, skincare, sleep.
Build: 6-second `@keyframes` alternating `scale(1)` and `scale(1.04)` with `ease-in-out`, infinite.
Fallback: static under reduced motion.

### Drawn dividers
Section rules draw themselves from left to right as they enter view.
Fits: editorial, minimal, craft brands.
Build: separator block style with `transform: scaleX(0)` to `scaleX(1)`, `transform-origin: left`, on a `view()` timeline.
Fallback: full-width line.

### Tilt cards
Cards tilt in 3D toward the cursor and lift with a deeper shadow.
Fits: portfolios, product grids, team pages.
Build: `perspective` on the grid, `rotateX`/`rotateY` from a small pointer script writing two variables; `transition: transform .2s`.
Fallback: plain lift on hover; nothing on touch.

### Blinds reveal
Images appear through vertical stripes that open like blinds.
Fits: photography, architecture, fashion.
Build: image block style with a `mask-image: repeating-linear-gradient(90deg, #000 0 10%, transparent 10% 20%)` whose `mask-size` animates on a `view()` timeline.
Fallback: image shown directly.

### Elastic underline
Navigation links have an underline that stretches from the previously hovered link to the current one.
Fits: agencies, portfolios, editorial.
Build: one absolutely positioned bar in the nav container; a small script moves it with `left`/`width` transitions on `mouseenter`.
Fallback: standard underline on the active link.

### Rotating badge
A circular text badge ("est. 2012 · handmade · local") rotates slowly in a corner of the hero.
Fits: bakeries, breweries, artisans, farms.
Build: inline SVG with `textPath` on a circle, `animation: spin 20s linear infinite`.
Fallback: static badge under reduced motion.

## Cursor & hover

### Dot and ring cursor
A small dot replaces the pointer, with a larger ring that lags behind and grows over links.
Fits: agencies, portfolios, fashion.
Build: two fixed elements moved by a pointer script with `requestAnimationFrame`; `cursor: none` on `body` only when `(pointer: fine)`.
Fallback: native cursor on touch and under reduced motion.

### Cursor spotlight reveal
A hidden layer (alternate image, message, or texture) shows only inside a circle around the cursor.
Fits: mystery launches, portfolios, museums.
Build: top layer masked with `mask-image: radial-gradient(160px at var(--mx) var(--my), #000, transparent)`, variables set by a pointer script.
Fallback: hidden layer revealed on tap or fully shown on mobile.

### Hover preview list
A plain list of projects or dishes; hovering an item makes its image float beside the cursor.
Fits: portfolios, restaurants, galleries.
Build: list items with a hidden image, positioned `fixed` and moved to the pointer by a script; `opacity` transition.
Fallback: images shown inline beneath each item on touch.

### Image swap
Hovering an image swaps it for a second frame (alternate angle, color, or a b/w version).
Fits: shops, photographers, product pages.
Build: two images stacked in a group; top one fades out on hover, or `filter: grayscale(1)` to `0` when a single image is used.
Fallback: first image only.

### Pointer-tilted hero
The whole hero composition tilts a few degrees toward the cursor, giving a subtle parallax between layers.
Fits: product launches, games, tech.
Build: `perspective` on the hero, `rotateX`/`rotateY` from pointer variables, inner layers with different `translateZ`.
Fallback: static on touch.

### Sliding panel cells
Grid cells hide their description behind the image; hovering slides a color panel up with the text.
Fits: teams, services, menus.
Build: cover block style with an absolutely positioned inner group at `translateY(100%)` transitioning to `0` on hover.
Fallback: panel always visible on touch.

### Magnifier lens
Hovering a product image shows a round magnified view at the cursor.
Fits: shops, jewelry, prints, watches.
Build: a fixed circle whose `background-image` is the same image at 250% size, positioned from pointer coordinates by a script.
Fallback: tap to open the full image.

### Word flip links
Links show an alternate word on hover, rolling up like a split-flap board.
Fits: playful brands, agencies, personal sites.
Build: link with `data-alt`, `::after` holding the alternate text, `overflow: hidden` and a `translateY` swap on hover.
Fallback: static link text.

### Per-item accent
Each card sets its own accent color; hovering tints its border, shadow, and button with that color.
Fits: multi-product shops, categories, team pages.
Build: cards carry `style="--accent: var(--wp--preset--color--...)"` via block styles; hover rules use `var(--accent)`.
Fallback: none needed.

### Echo hover
Hovering an image briefly stacks two or three scaled copies behind it that settle back, like an echo.
Fits: music, events, streetwear.
Build: image block style with `::before`/`::after` copies of the same `background-image`, scaled and offset on hover with a short transition.
Fallback: no effect on touch.

## Layout & structure

### Broken grid
Elements deliberately overlap and break the column grid: an image tucked under a heading, a caption hanging into the margin.
Fits: creative studios, fashion, editorial.
Build: constrained groups with negative `margin-block-start` and `margin-inline` on selected blocks, `z-index` layering, `alignwide` for the escaping elements.
Fallback: overlaps removed with a `max-width: 782px` rule that resets margins.

### Bento grid
The home page is a set of rounded tiles of varying sizes, each holding one fact, image, or link.
Fits: startups, personal sites, product overviews.
Build: `core/grid` or a group with `grid-template-areas`, tiles as groups with the same radius and a two-tone palette.
Fallback: tiles stack into one column.

### Fixed panel split
A left panel with the brand, intro, and navigation stays fixed while the right column scrolls through the content.
Fits: portfolios, resumes, small studios.
Build: two-column group; left column `position: sticky; top: 0; height: 100dvh`.
Fallback: left panel becomes a normal header on mobile.

### Sticky index
A small table of contents stays beside the content and highlights the current section.
Fits: documentation, long guides, menus, programs.
Build: sticky group of anchor links; an IntersectionObserver toggles `is-current` on the matching link.
Fallback: index rendered above the content on mobile.

### Magazine columns
Long text is set in two columns with a drop cap and pull quotes that span both.
Fits: publications, essays, biographies.
Build: paragraph group with `column-count: 2; column-gap`, `::first-letter` drop cap, pull quote with `column-span: all`.
Fallback: one column below 782px.

### Skewed sections
Every section boundary is a slanted edge, so the page reads as a series of angled bands.
Fits: sports, energy, agencies, events.
Build: section groups with `clip-path: polygon(0 0, 100% 4vw, 100% 100%, 0 calc(100% - 4vw))` and extra block padding to compensate.
Fallback: angles reduced on mobile.

### Single-screen site
The whole site lives inside one viewport; navigation swaps panels in place instead of scrolling.
Fits: restaurants, bars, small portfolios, event pages.
Build: `height: 100dvh` group with panels toggled by `:target` and CSS transitions; nav links point at panel ids.
Fallback: panels stack and scroll normally on short screens.

### Fanned deck
Content cards are arranged as a fanned deck; hovering or tapping a card brings it to the front.
Fits: menus, tour packages, course lists.
Build: cards absolutely positioned with incremental `rotate()` around a low transform origin; `:hover`/`:focus-within` raises `z-index` and straightens.
Fallback: deck becomes a horizontal scroll-snap row on mobile.

### Color bands
Each section is a full-bleed band in a different palette color, with the text color flipping to keep contrast.
Fits: one-page sites, campaigns, community projects.
Build: `alignfull` groups with palette `backgroundColor` and `textColor` set per section; consistent inner padding.
Fallback: none needed.

### Framed viewport
A thick colored frame surrounds the viewport at all times, and the site scrolls inside it.
Fits: galleries, print studios, fashion.
Build: fixed pseudo-elements on `body` (`inset: 0; border: 16px solid accent; pointer-events: none`) plus matching `padding` on the content.
Fallback: frame thins to 6px on mobile.

## Imagery treatments

### Duotone photos
All photos share a two-color treatment from the palette so any image fits the design.
Fits: agencies, music, campaigns, nonprofits.
Build: `theme.json` `color.duotone` presets plus a default duotone on image and cover blocks in `styles.blocks`.
Fallback: none needed.

### Shape-cropped images
Images sit inside arches, circles, or blob shapes rather than rectangles.
Fits: wellness, weddings, cafés, boutiques.
Build: registered image block styles with `clip-path: ellipse()` or `inset(0 round 50% 50% 0 0)` for arches, and `aspect-ratio` to keep them consistent.
Fallback: none needed.

### Scrapbook
Photos are slightly rotated with tape strips, shadows, and hand-written captions.
Fits: family businesses, crafts, travel diaries, schools.
Build: image block style with `rotate()`, `box-shadow`, and `::before` tape strips in a translucent accent; caption in a script font.
Fallback: rotation removed on mobile.

### Color block slide-off
Each image is hidden behind a solid palette block that slides away as the image scrolls into view.
Fits: portfolios, architecture, product stories.
Build: image wrapper `::after` in the accent color translating to `100%` on a `view()` timeline.
Fallback: image visible directly.

### Slow Ken Burns
Cover images zoom and pan very slowly, so a static page feels alive.
Fits: hotels, restaurants, travel, real estate.
Build: cover background with a 20-second `@keyframes` scaling `1` to `1.08` with a slight `translate`, infinite alternate.
Fallback: static under reduced motion.

### Sticker overlays
Small rotated badges ("new", "limited", "since 1994") stick onto images and cards.
Fits: shops, bakeries, streetwear, events.
Build: absolutely positioned paragraph inside a group with `rotate(-8deg)`, pill radius, and accent background.
Fallback: none needed.

### Torn edges
Images and color sections end in a torn-paper edge instead of a straight line.
Fits: zines, crafts, music, food trucks.
Build: `mask-image` with an inline SVG of a jagged path on the bottom edge of sections or images.
Fallback: none needed.

### Zoom and caption grid
Gallery images zoom slightly on hover while a caption slides up from the bottom edge.
Fits: galleries, portfolios, shops.
Build: gallery or grid of image groups with `overflow: hidden`, `scale(1.05)` on hover, caption at `translateY(100%)` to `0`.
Fallback: captions always visible on touch.

### Depth stack
A single image is layered with two offset copies in palette tints behind it, and the layers separate slightly on hover.
Fits: design studios, print, music.
Build: image block style with `::before`/`::after` in palette colors offset by 8px and 16px; hover increases the offsets.
Fallback: static stack.

### Portal frames
Images are shown through arched window frames with an inner border, like looking through a doorway.
Fits: interiors, boutiques, travel, weddings.
Build: image group with `border-radius: 50% 50% 0 0 / 30% 30% 0 0`, inner `outline` offset inward, generous padding in a palette tint.
Fallback: none needed.

## Navigation & transitions

### Full-screen menu
The menu opens as a full viewport overlay with giant links and a secondary column of contact details.
Fits: agencies, restaurants, studios.
Build: navigation block overlay styled with `min-height: 100dvh`, links at `clamp(2rem, 8vw, 6rem)`, staggered fade-in.
Fallback: none needed; the block already handles small screens.

### Bottom dock
Navigation lives in a floating pill at the bottom of the viewport, app style.
Fits: personal sites, mobile-first businesses, apps.
Build: navigation inside a fixed group centered with `inset-inline: 0; bottom: 1rem`, pill radius, `backdrop-filter: blur(12px)`.
Fallback: none needed.

### Side rail
A narrow vertical rail on the left holds the logo and rotated links, leaving the full width for content.
Fits: architecture, galleries, editorial.
Build: header template part as a fixed 64px column; links with `writing-mode: vertical-rl`.
Fallback: rail becomes a top bar on mobile.

### Shrinking header
The header hides while scrolling down and returns, shorter, when scrolling up.
Fits: shops, blogs, long pages.
Build: header part `position: sticky` with a class toggled by a 12-line scroll-direction script; `transition` on `transform` and `padding`.
Fallback: plain sticky header without the script.

### Section dots
A column of dots on the right edge marks each section; the current one fills.
Fits: one-page sites, presentations, product tours.
Build: fixed list of anchor links; IntersectionObserver toggles `is-current`; `scroll-behavior: smooth`.
Fallback: hidden below 782px.

### Menu with page previews
Hovering a menu link shows a preview image of that page beside the list.
Fits: agencies, magazines, restaurants.
Build: overlay menu with a preview column; each link sets `--preview` via `data-` attribute and a tiny script swaps the image.
Fallback: preview column hidden on mobile.

### Floating pill nav
A compact rounded navigation floats over the hero, detached from the page edges.
Fits: startups, personal sites, product pages.
Build: header group with `position: sticky; top: 1rem`, pill radius, translucent palette background and `backdrop-filter`.
Fallback: none needed.

### Blurred backdrop menu
Opening the menu blurs and dims the page behind a compact panel.
Fits: shops, blogs, services.
Build: navigation overlay background `rgb(... / .6)` with `backdrop-filter: blur(16px)`; panel slides in from the right.
Fallback: solid background where `backdrop-filter` is unsupported.

### Page transitions
Navigating between pages crossfades or slides instead of flashing white.
Fits: any multi-page site with a refined tone.
Build: `@view-transition { navigation: auto; }` in `style.css` plus `::view-transition-old/new(root)` keyframes; `view-transition-name` on the header so it stays put.
Fallback: instant navigation where unsupported or under reduced motion.

### Index landing
The home page is a numbered index of the site's pages, like a book's table of contents, each entry with a one-line summary.
Fits: writers, studios, consultancies, archives.
Build: home template listing pages as a numbered group with large numerals, titles, and summaries; hover reveals an arrow.
Fallback: none needed.

## Time, context & living site

### Changing seasons
A hero scene (tree, landscape, storefront) shifts through spring, summer, autumn, and winter as the visitor scrolls, or matches the current month on load.
Fits: farms, gardens, tourism, schools, seasonal shops.
Build: inline SVG scene with four CSS states toggled by a `season-*` class on the hero; a `scroll()` timeline or a 5-line script picks the class from the month.
Fallback: single season matching the current month, static.

### Time-of-day palette
The palette shifts between morning, day, evening, and night variants based on the visitor's clock.
Fits: cafés, hotels, wellness, personal sites.
Build: four sets of palette overrides as `body.is-morning` etc. in `style.css` mapped from `theme.json` slugs; a 6-line script sets the class from `Date().getHours()`.
Fallback: the day palette as default.

### Open now
A live status pill shows whether the business is currently open, with today's hours highlighted.
Fits: restaurants, shops, clinics, gyms.
Build: hours in a table block with `data-day` attributes via a block style; a 20-line script compares with the current time and toggles `is-open`.
Fallback: hours table shown without the status pill.

### Countdown
A hero countdown to an opening, launch, or event, in large numerals.
Fits: events, launches, festivals, seasonal campaigns.
Build: four paragraph blocks with `data-unit`, a 15-line script updates them from a `data-date` on the group each second.
Fallback: the date as text when the script has not run.

### Days since
A counter shows how long the business has existed or how many days since a milestone, ticking daily.
Fits: heritage brands, breweries, studios, projects.
Build: paragraph with `data-since`; a script computes the difference and formats it with `Intl.NumberFormat`.
Fallback: founding year as static text.

### Rotating tagline
Each visit shows a different tagline or hero color from a small set, so returning visitors see a new face.
Fits: agencies, personal sites, restaurants with rotating menus.
Build: taglines as sibling paragraphs hidden by default; a 5-line script shows one at random and sets a matching `--accent`.
Fallback: the first tagline is visible without the script.

### Hourly sky
The hero background gradient mirrors the sky for the visitor's hour: dawn pink, noon blue, dusk orange, night navy.
Fits: travel, outdoors, hospitality, weather-related services.
Build: gradient stops as CSS variables switched by a `sky-*` class from the hour; 2-second `transition` on the hero background.
Fallback: a fixed daytime gradient.

### Ambient weather
Light CSS particles (falling leaves, snow, rain streaks, pollen) drift over the hero, chosen by the current month.
Fits: outdoor brands, cafés, seasonal shops, tourism.
Build: a dozen absolutely positioned spans with randomized `animation-delay` and `left` values, keyframes per particle type; a class from the month picks the type.
Fallback: particles off under reduced motion and on mobile.

### Dated note
A hand-written style note in the hero shows today's date and a short message, like a daily specials board.
Fits: cafés, bakeries, markets, small shops.
Build: a paragraph in a script font inside a tilted "paper" group; a 3-line script fills the date with `Intl.DateTimeFormat`.
Fallback: the message without the date.

### Hourly greeting
The hero greets visitors by time of day ("Good morning" / "Good evening") with a matching accent.
Fits: personal sites, consultants, hospitality.
Build: heading with `data-greetings` JSON on the block; a 6-line script swaps the text and a `--accent` value by hour.
Fallback: a neutral greeting written in the markup.
