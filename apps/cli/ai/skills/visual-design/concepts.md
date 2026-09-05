# Signature Concepts

Catalog behind the `visual-design` skill's concept shortlist. The Skill tool samples a random subset of these entries into the runbook on every load, so the same brief gets a different shortlist each run. Each `##` heading is one concept: a description, then two fixed lines, **Build** and **Fallback**.

These concepts are about layout only: the spatial structure of the page, how sections relate to the viewport and to each other. Color, typography, and scroll motion are decided separately in the design direction. The bar for an entry: a template would never ship it, and a visitor would describe it to a friend. Every concept is buildable inside a block theme with the tools Studio Code has: `theme.json`, `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Content stays editable in blocks.

## Four-tile cover
The viewport is divided into four equal squares that together form the cover: one holds the headline, one an image, one a solid field with a single line, one the call to action. Nothing scrolls until the visitor moves past the tiles, and the same 2×2 grid reappears as a motif for section openers.
Build: full-height group with a 2×2 CSS grid (`height: 100dvh; grid-template: 1fr 1fr / 1fr 1fr`), each tile a group or cover block with its own palette color; section openers reuse a half-height 2×2 pattern.
Fallback: tiles stack into a single column on small screens.

## Staircase
Each section is narrower than the viewport and sits further to the right than the one before it, so the sections step down the page diagonally like a staircase. The empty space to the left of each step holds only the section's number or a one-word label, and the last step lands flush against the right edge above the footer.
Build: sections as groups with `width: 62vw` and `margin-inline-start: calc(var(--step) * 7vw)` where `--step` is set per section via a block style class (`is-step-1` … `is-step-5`); the label is an absolutely positioned paragraph at `left: calc(-1 * var(--step) * 7vw)`; the footer resets to full width.
Fallback: sections go full width and stack flat below 782px, labels move above each section.

## Single-screen site
The whole site fits in one viewport and never scrolls. Navigation swaps panels in place: the hero, the offer, the story, and the contact each occupy the same stage, and the current panel's name is written large along one edge.
Build: `height: 100dvh; overflow: hidden` group with panels as absolutely positioned groups toggled by `:target` (nav links point at panel ids) and CSS transitions; the current panel name via `writing-mode: vertical-rl` along the left edge.
Fallback: panels stack and scroll normally on screens shorter than 640px.

## Horizontal site
The site is laid out left to right instead of top to bottom: sections stand side by side like rooms in a row, the wheel scrolls sideways, and a thin progress line along the bottom shows how far along the row the visitor is.
Build: a flex row of full-viewport sections (`width: 100vw; height: 100dvh`) inside a container with `overflow-x: auto; scroll-snap-type: x mandatory`; a 10-line script maps vertical wheel events to horizontal scroll; the progress line's width tracks `scrollLeft`.
Fallback: sections stack vertically on mobile.

## Desktop windows
Sections are overlapping windows on a desktop, each with a title bar, close and zoom buttons, and a drop shadow; clicking a window brings it to the front, and a dock along the bottom reopens closed ones. The hero is the largest window sitting slightly askew over the others.
Build: absolutely positioned groups with a title-bar group and a content group, `z-index` raised by a 25-line script on click, drag via pointer events on the title bar; the dock is a fixed flex row of buttons.
Fallback: windows become a vertical stack of cards with their title bars on mobile.

## Infinite canvas
Sections are scattered across a large two-dimensional canvas, like notes on a board, and the visitor pans around by dragging; a small minimap in a corner shows where they are, and the hero sits in the middle with paths of dots leading to each section.
Build: a `overflow: auto` stage twice the viewport in both directions with absolutely positioned section groups, drag-to-pan via a 20-line pointer script, dotted SVG paths between the hero and sections; the minimap is a scaled copy of the section positions with a viewport rectangle updated on scroll.
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
Build: a `core/grid` or group with `grid-template-columns: repeat(4, 1fr); gap: 0`, every cell `aspect-ratio: 1`, image cells as cover blocks with `object-fit: cover`, text cells as groups with palette backgrounds alternating by `:nth-child` rules.
Fallback: two columns on mobile, still gutterless.

## Mondrian
The page is a full-bleed composition of a few rectangles of very different sizes, separated by thick dark rules: one dominant cell holds the hero, and each other cell is either an image, a flat color field, or a single line of text. There is no repeating pattern and no gutters; the same composition, rotated, opens each section.
Build: a CSS grid with `grid-template-areas` describing the composition (for example a 4×3 grid where the hero spans 3×2), `gap: 12px` with the page background as the dark rule color, every cell a group or cover block with `min-height: 0` so images crop; section openers reuse the grid with the areas rotated.
Fallback: cells stack in source order on mobile with the rules kept as 12px bands.

## Collage
Sections deliberately overlap and break the column grid: an image tucked under a headline, a caption hanging into the margin, a quote laid across two sections, a small photo pinned over the corner of a large one. Nothing lines up on purpose, and the page reads like a pinboard.
Build: constrained groups with negative `margin-block-start` and `margin-inline` on selected blocks, `z-index` layering, `alignwide` and `alignfull` for the elements that escape the column, a few `rotate(-2deg)` accents; a pattern per section keeps the overlaps repeatable.
Fallback: overlaps and rotations removed with a `max-width: 782px` rule that resets margins.
