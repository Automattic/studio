---
title: "Mondrian"
description: "The page is a full-bleed composition of a few rectangles of very different sizes, separated by thick dark rules: one dominant cell holds the hero, and each other cell is either an image, a flat color field, or a single line of text. There is no repeating pattern and no gutters; the same composition, rotated, opens each section."
---
Build: a CSS grid with `grid-template-areas` describing the composition (for example a 4×3 grid where the hero spans 3×2), `gap: 12px` with the page background as the dark rule color, every cell a group or cover block with `min-height: 0` so images crop; section openers reuse the grid with the areas rotated; the header is a slim fixed bar (`position: sticky; top: 0`) with its own opaque or translucent background so it never merges with the cell or row behind it. image tiles may respond to hover with a slow scale of the image inside its clipped cell (`overflow: hidden` on the cell, `transform: scale(1.04)` on the image over 600ms), never a change of the cell's own size.
Fallback: cells stack in source order on mobile with the rules kept as 12px bands.
