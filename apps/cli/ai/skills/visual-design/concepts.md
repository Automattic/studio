# Signature Concepts

Catalog behind the `visual-design` skill's concept shortlist. The Skill tool samples a random subset of these entries into the runbook on every load, so the same brief gets a different shortlist each run. Each `##` heading is one concept: a description, then two fixed lines, **Build** and **Fallback**.

These concepts are about layout only: the spatial structure of the page, how sections relate to the viewport and to each other. Color, typography, and scroll motion are decided separately in the design direction. The bar for an entry: a template would never ship it, and a visitor would describe it to a friend. Every concept is buildable inside a block theme with the tools Studio Code has: `theme.json`, `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Content stays editable in blocks.

## Four-tile cover
The viewport is divided into four equal squares that together form the cover: one holds the headline, one an image, one a solid field with a single line, one the call to action. Nothing scrolls until the visitor moves past the tiles, and the same 2×2 grid reappears as a motif for section openers.
Build: full-height group with a 2×2 CSS grid (`height: 100dvh; grid-template: 1fr 1fr / 1fr 1fr`), each tile a group or cover block; every tile carries its own opaque background (a palette color, a gradient, or an image) — a tile that inherits the page background reads as empty space and the cover bleeds into the header; `gap: 0` on the grid and zero the theme block gap inside it (`--wp--style--block-gap: 0` on the grid group), or a stripe of page background opens between the rows; section openers reuse a half-height 2×2 pattern, never in two consecutive sections, or the page turns into a checkerboard; image tiles may respond to hover with a slow scale of the image inside its clipped cell (`overflow: hidden` on the cell, `transform: scale(1.04)` on the image over 600ms), never a change of the cell's own size.
Fallback: tiles stack into a single column on small screens.

## Horizontal site
The site is laid out left to right instead of top to bottom: sections stand side by side like rooms in a row, the wheel scrolls sideways, and a thin progress line along the bottom shows how far along the row the visitor is.
Build: a flex row of full-viewport sections (`width: 100vw; height: 100dvh`) inside a container with `overflow-x: auto; scroll-snap-type: x mandatory` and NO `scroll-behavior: smooth` on the container (smooth scrolling plus per-tick `scrollLeft` updates cancel each other, and mandatory snapping pulls small moves back); the ordinary up-and-down wheel and trackpad scrolling drives the track as a pager: a 15-line `wheel` listener with `preventDefault` accumulates `deltaY`, and once a gesture passes a threshold (about 50px) it calls `track.scrollTo({ left: nextPanel.offsetLeft, behavior: 'smooth' })` to the next or previous section, with a 600ms cooldown so a trackpad burst counts as one gesture; navigation links use the same `scrollTo` call; the progress line's width tracks `scrollLeft`.
Fallback: sections stack vertically on mobile.

## Broadsheet
The page is laid out as a newspaper front page: a masthead across the top, a dateline rule, a lead story spanning three columns with a large image, two narrower side columns with shorter items, and "continued on" links at the foot of each column.
Build: a CSS grid with named areas (`masthead`, `lead`, `side-a`, `side-b`, `foot`), `column-count: 3` on the lead story, hairline rules between columns via `column-rule` and borders, a masthead heading at `clamp(3rem, 10vw, 8rem)`.
Fallback: columns collapse to one below 782px; the masthead stays.

## Radial hub
The hero is the center of a wheel: sections are arranged in a ring around it at equal angles, connected to the hub by spokes, and each section is a card that faces the center. The visitor reads by moving around the ring.
Build: a square stage with the hero centered; section cards absolutely positioned with `rotate(n*60deg) translate(38vmin) rotate(-n*60deg)`, spokes as an inline SVG of lines; card width from `--card` so the ring scales with the viewport.
Fallback: the ring unrolls into a vertical stack on screens narrower than 900px.

## Checkerboard
The whole page is a strict full-width checkerboard: square cells alternating between image and text, no gutters, no margins, the pattern running edge to edge from the top of the page to the footer. Headlines sit inside cells like everything else.
Build: a `core/grid` or group with `grid-template-columns: repeat(4, 1fr); gap: 0` and the theme block gap zeroed inside it (`--wp--style--block-gap: 0` on the grid group, or a stripe of page background opens between the rows), every cell `aspect-ratio: 1`, image cells as cover blocks with `object-fit: cover`, text cells as groups with palette backgrounds alternating by `:nth-child` rules; the header is a slim fixed bar (`position: sticky; top: 0`) with its own opaque or translucent background so it never merges with the cell or row behind it. image tiles may respond to hover with a slow scale of the image inside its clipped cell (`overflow: hidden` on the cell, `transform: scale(1.04)` on the image over 600ms), never a change of the cell's own size.
Fallback: two columns on mobile, still gutterless.

## Mondrian
The page is a full-bleed composition of a few rectangles of very different sizes, separated by thick dark rules: one dominant cell holds the hero, and each other cell is either an image, a flat color field, or a single line of text. There is no repeating pattern and no gutters; the same composition, rotated, opens each section.
Build: a CSS grid with `grid-template-areas` describing the composition (for example a 4×3 grid where the hero spans 3×2), `gap: 12px` with the page background as the dark rule color, every cell a group or cover block with `min-height: 0` so images crop; section openers reuse the grid with the areas rotated; the header is a slim fixed bar (`position: sticky; top: 0`) with its own opaque or translucent background so it never merges with the cell or row behind it. image tiles may respond to hover with a slow scale of the image inside its clipped cell (`overflow: hidden` on the cell, `transform: scale(1.04)` on the image over 600ms), never a change of the cell's own size.
Fallback: cells stack in source order on mobile with the rules kept as 12px bands.

## Collage
Sections deliberately overlap and break the column grid: an image tucked under a headline, a caption hanging into the margin, a quote laid across two sections, a small photo pinned over the corner of a large one. Nothing lines up on purpose, and the page reads like a pinboard.
Build: constrained groups with negative `margin-block-start` and `margin-inline` on selected blocks, `z-index` layering, `alignwide` and `alignfull` for the elements that escape the column, a few `rotate(-2deg)` accents; a pattern per section keeps the overlaps repeatable.
Fallback: overlaps and rotations removed with a `max-width: 782px` rule that resets margins.

## Sticky split
The page is two half-width panes. The left pane is pinned to the viewport and holds one large image that changes as each section passes; the right pane scrolls the content. Every section owns an image, so the left pane is never blank and the split is visible from the first pixel to the footer.
Build: a two-column group (`grid-template-columns: 1fr 1fr; align-items: start`); the left column `position: sticky; top: 0; height: 100dvh` holding one absolutely positioned image per section stacked with `opacity: 0`; an IntersectionObserver on each right-hand section toggles `is-active` on its image; the header floats over the split.
Fallback: single column on mobile, each section's image shown above its text.

## Poster pages
Every section is a full-viewport poster: one full-bleed image, one headline, one line of text, one link, nothing else, and the page snaps from poster to poster. The site reads like a campaign rather than a document.
Build: `scroll-snap-type: y mandatory` on the page, each section a cover block with `height: 100dvh; scroll-snap-align: start`, content bottom-left with a gradient scrim; the footer is the last poster; the header is fixed over the posters (`position: fixed; top: 0` with a transparent or translucent background) rather than a block above the first one — with mandatory snapping, an in-flow header shorter than a viewport can never be scrolled into view; if it must stay in flow, give it `scroll-snap-align: start` too.
Fallback: snap disabled and heights relaxed to `min-height: 70dvh` on screens shorter than 640px.

## Interrupted column
A narrow reading column runs down the page and is interrupted, at regular intervals, by full-bleed bands that run edge to edge: an image, a wide quote, a row of products. The rhythm of narrow, wide, narrow is the layout.
Build: `settings.layout.contentSize` set narrow (`640px`) in `theme.json`; text sections as constrained groups; every second or third section an `alignfull` group or cover block with its own background; no `alignwide` anywhere, so only the two widths exist; the header is a slim fixed bar (`position: sticky; top: 0`) with its own opaque or translucent background so it never merges with the band scrolling under it.
Fallback: none needed; both widths already work on mobile.

## Book spreads
The site is a sequence of open two-page spreads: a left page and a right page side by side with a visible gutter, page numbers in the outer corners, and each section filling one spread. Scrolling moves to the next spread.
Build: each section a two-column group with `gap: 0`, a gutter via `border-inline-start` on the right page plus an inner shadow gradient toward the center, page numbers as small paragraphs positioned bottom-left and bottom-right, `min-height: 100dvh` per spread with `scroll-snap-align: start`; zero the theme block gap between spreads (`margin-block-start: 0` on the spread groups, or `--wp--style--block-gap: 0` on their parent), or a stripe of page background opens between consecutive spreads and the book reads as separate cards.
Fallback: pages stack in reading order on mobile, page numbers kept.

## Sidebar site
A fixed column one-third wide holds the brand, the navigation, and one live detail such as opening hours or a short note; everything else lives in the remaining two-thirds and scrolls past it. The proportion never changes, so the site is recognizably asymmetric on every screen.
Build: a two-column group (`grid-template-columns: 1fr 2fr`); the sidebar column `position: sticky; top: 0; height: 100dvh` with its own background, so the page scrolls while the sidebar stays put — do not make the content column its own scroll container (`overflow-y: auto`), which breaks anchor links, scroll restoration, and mobile; header and footer parts live inside the sidebar, not above or below the content; sidebar links to sections scroll smoothly (`html { scroll-behavior: smooth }`, off under reduced motion) rather than jumping, and the link for the section in view is marked current via a small IntersectionObserver.
Fallback: sidebar becomes a top bar on mobile, the live detail moves to the footer.

## Diptych rows
The page is a strict rhythm of image rows: a pair of images side by side edge to edge, then one full-width image, then a pair, then one, all the way down. Each pair is a deliberate juxtaposition — a portrait beside a detail, a wide shot beside a close-up — and the few text sections sit inside the rhythm as a full-width row of type, never beside an image.
Build: alternate two-column groups (`gap: 0`, each column a cover or image block with `aspect-ratio: 4 / 5`) and single full-width cover or image blocks (`aspect-ratio: 21 / 9`), all `alignfull`; text rows as constrained groups with generous block padding; zero the theme block gap between rows (`margin-block-start: 0` on the row groups) so images touch; the header is a slim fixed bar with its own background.
Fallback: pairs stack into single images on mobile, keeping the order.

## Four corners
The hero pins one small element to each corner of the viewport — an eyebrow top-left, the navigation top-right, a key figure or date bottom-left, the call to action bottom-right — and puts the headline off-center in the open space between them. Every section repeats the corner-anchored composition with its own four items, so the page is a sequence of framed voids rather than a column.
Build: each section a `min-height: 100dvh` `alignfull` group with `position: relative`; four corner groups absolutely positioned with `inset` offsets of one spacing unit; the headline as a group positioned with `top`/`left` percentages (never centered) by ONE shared rule for every section (for example `.corner-section .headline { position: absolute; top: 32%; left: 14%; max-width: 60% }`), never per-section coordinates — a section that misses its rule drops the headline to the top-left corner on top of the corner element; short sections such as the footer keep the four corners but use `min-height: 40dvh`, not a full viewport; generous empty space is the point, so no filler between corners.
Fallback: corners stack in reading order (top-left, top-right, headline, bottom-left, bottom-right) on screens narrower than 782px.

## Ruled grid
The page is a visible grid: hairline rules run the full height and width of the site, every piece of content sits inside a cell, and nothing carries a background, so all structure comes from lines. Large cells hold the hero and images, small cells hold labels and short facts, and empty cells stay empty and ruled.
Build: one `core/grid` or group per section with `grid-template-columns: repeat(6, 1fr)` and `gap: 0`, every cell a group with `border-right` and `border-bottom` in the text color at 1px, spans via `grid-column`/`grid-row` for the hero and images, the outer wrapper with a matching `border-left`/`border-top`; the header is the first ruled row; no `background` on any cell.
Fallback: two columns on mobile with the rules kept.

## Tilted reel
Images run across sections in full-width strips rotated a few degrees, like a film reel laid diagonally across the page, and the text sits in the wedges of space the strips leave open. The reel is the page's spine: every image on the site belongs to a strip, none sit alone.
Build: each strip a flex row of image blocks with a fixed height and a small gap, wider than the viewport (`width: 120vw; margin-inline-start: -10vw`), `transform: rotate(-4deg)`, inside a section with `overflow: hidden` and enough block padding that the rotation never clips; text groups positioned in the open wedge above or below the strip, never overlapping it; strips alternate rotation direction down the page.
Fallback: strips lose the rotation and become horizontal scroll-snap rows on mobile.
