---
title: "Checkerboard"
description: "The whole page is a strict full-width checkerboard: square cells alternating between image and text, no gutters, no margins, the pattern running edge to edge from the top of the page to the footer. Headlines sit inside cells like everything else."
---
Build: a group with the grid layout in its markup (`"layout":{"type":"grid","columnCount":4}`) and `gap: 0`, every cell `aspect-ratio: 1`, image cells as cover blocks with `object-fit: cover`, text cells as groups with palette backgrounds alternating by `:nth-child` rules; the header is a slim fixed bar (`position: sticky; top: 0`) with its own opaque or translucent background so it never merges with the cell or row behind it. image tiles may respond to hover with a slow scale of the image inside its clipped cell (`overflow: hidden` on the cell, `transform: scale(1.04)` on the image over 600ms), never a change of the cell's own size.
Fallback: two columns on mobile, still gutterless.
