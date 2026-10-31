---
title: "Collage"
description: "Sections deliberately overlap and break the column grid: an image tucked under a headline, a caption hanging into the margin, a quote laid across two sections, a small photo pinned over the corner of a large one. Nothing lines up on purpose, and the page reads like a pinboard."
---
Build: constrained groups with negative `margin-block-start` and `margin-inline` on selected blocks, `z-index` layering, `alignwide` and `alignfull` for the elements that escape the column, a few `rotate(-2deg)` accents; a pattern per section keeps the overlaps repeatable; overlaps may cover images, color fields, and empty space, never running text: an element that overlaps a paragraph sits behind it (lower `z-index`), and an element pulled up with a negative margin clears the previous block's last line of text by at least one line-height.
Fallback: overlaps and rotations removed with a `max-width: 782px` rule that resets margins.
