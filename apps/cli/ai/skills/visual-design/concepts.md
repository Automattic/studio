# Signature Concepts

Catalog behind the `visual-design` skill's concept shortlist. The Skill tool samples a random subset of these entries into the runbook on every load, so the same brief gets a different shortlist each run. Each `##` heading is one concept: a description, then two fixed lines, **Build** and **Fallback**.

These concepts are about layout only: the spatial structure of the page, how sections relate to the viewport and to each other. Color, typography, and scroll motion are decided separately in the design direction. The bar for an entry: a template would never ship it, and a visitor would describe it to a friend. Every concept is buildable inside a block theme with the tools Studio Code has: `theme.json`, `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Content stays editable in blocks.

## Four-tile cover
The viewport is divided into four equal squares that together form the cover: one holds the headline, one an image, one a solid field with a single line, one the call to action. Nothing scrolls until the visitor moves past the tiles, and the same 2×2 grid reappears as a motif for section openers.
Build: full-height group with a 2×2 CSS grid (`height: 100dvh; grid-template: 1fr 1fr / 1fr 1fr`), each tile a group or cover block; every tile carries its own opaque background (a palette color, a gradient, or an image) — a tile that inherits the page background reads as empty space and the cover bleeds into the header; `gap: 0` on the grid and zero the theme block gap inside it (`--wp--style--block-gap: 0` on the grid group), or a stripe of page background opens between the rows; section openers reuse a half-height 2×2 pattern, never in two consecutive sections, or the page turns into a checkerboard.
Fallback: tiles stack into a single column on small screens.

## Horizontal site
The site is laid out left to right instead of top to bottom: sections stand side by side like rooms in a row, the wheel scrolls sideways, and a thin progress line along the bottom shows how far along the row the visitor is.
Build: a flex row of full-viewport sections (`width: 100vw; height: 100dvh`) inside a container with `overflow-x: auto; scroll-snap-type: x mandatory; scroll-behavior: smooth`; a 10-line script turns the ordinary up-and-down wheel and trackpad scrolling into horizontal movement of the track (`deltaY` added to `scrollLeft`, with `preventDefault`), so the visitor never has to scroll sideways themselves; navigation links scroll the track to the section smoothly rather than jumping; the progress line's width tracks `scrollLeft`.
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
Build: a `core/grid` or group with `grid-template-columns: repeat(4, 1fr); gap: 0` and the theme block gap zeroed inside it (`--wp--style--block-gap: 0` on the grid group, or a stripe of page background opens between the rows), every cell `aspect-ratio: 1`, image cells as cover blocks with `object-fit: cover`, text cells as groups with palette backgrounds alternating by `:nth-child` rules.
Fallback: two columns on mobile, still gutterless.

## Mondrian
The page is a full-bleed composition of a few rectangles of very different sizes, separated by thick dark rules: one dominant cell holds the hero, and each other cell is either an image, a flat color field, or a single line of text. There is no repeating pattern and no gutters; the same composition, rotated, opens each section.
Build: a CSS grid with `grid-template-areas` describing the composition (for example a 4×3 grid where the hero spans 3×2), `gap: 12px` with the page background as the dark rule color, every cell a group or cover block with `min-height: 0` so images crop; section openers reuse the grid with the areas rotated.
Fallback: cells stack in source order on mobile with the rules kept as 12px bands.

## Collage
Sections deliberately overlap and break the column grid: an image tucked under a headline, a caption hanging into the margin, a quote laid across two sections, a small photo pinned over the corner of a large one. Nothing lines up on purpose, and the page reads like a pinboard.
Build: constrained groups with negative `margin-block-start` and `margin-inline` on selected blocks, `z-index` layering, `alignwide` and `alignfull` for the elements that escape the column, a few `rotate(-2deg)` accents; a pattern per section keeps the overlaps repeatable.
Fallback: overlaps and rotations removed with a `max-width: 782px` rule that resets margins.
