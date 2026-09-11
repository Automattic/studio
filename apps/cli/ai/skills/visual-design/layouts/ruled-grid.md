---
title: "Ruled grid"
description: "The page is a visible grid: hairline rules run the full height and width of the site, every piece of content sits inside a cell, and nothing carries a background, so all structure comes from lines. Large cells hold the hero and images, small cells hold labels and short facts, and empty cells stay empty and ruled."
---
Build: one `core/grid` or group per section with `grid-template-columns: repeat(6, 1fr)` and `gap: 0`, every cell a group with `border-right` and `border-bottom` in the text color at 1px, spans via `grid-column`/`grid-row` for the hero and images, the outer wrapper with a matching `border-left`/`border-top`; the header is the first ruled row; no `background` on any cell.
Fallback: two columns on mobile with the rules kept.
