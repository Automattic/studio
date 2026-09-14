---
title: "Book spreads"
description: "The site is a sequence of open two-page spreads: a left page and a right page side by side with a visible gutter, page numbers in the outer corners, and each section filling one spread. Scrolling moves to the next spread."
---
Build: each section a two-column group with `gap: 0`, a gutter via `border-inline-start` on the right page plus an inner shadow gradient toward the center, page numbers as small paragraphs positioned bottom-left and bottom-right, `min-height: 100dvh` per spread with `scroll-snap-align: start`; zero the theme block gap between spreads (`margin-block-start: 0` on the spread groups, or `--wp--style--block-gap: 0` on their parent), or a stripe of page background opens between consecutive spreads and the book reads as separate cards.
Fallback: pages stack in reading order on mobile, page numbers kept.
