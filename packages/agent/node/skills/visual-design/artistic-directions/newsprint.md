---
title: "Newsprint"
description: "The site reads like a daily paper: newsprint gray, black ink, a condensed serif for headlines, a running masthead with the date, bylines and datelines in small caps, dense text set in columns with rules between them, and photographs printed in halftone black-and-white. Everything feels typeset in a hurry and printed by the thousand."
---
Palette: newsprint `#ece8df`, ink `#161412`, a single red `#b3261e` for the masthead rule and one kicker per section; no other color.
Type: a condensed serif for headlines (Playfair Display SC, Bodoni Moda at a narrow width, or Fraunces at a high wght and tight tracking) at 2.5–4.5rem with `line-height: 1`; body in a compact text serif (Source Serif, Noto Serif, or PT Serif) at 1rem/1.45 set in `column-count: 2` or `3` with `column-rule: 1px solid` the ink at 30%; bylines, datelines, and section labels in small caps with `letter-spacing: 0.08em`; a bold sans (Oswald or Archivo Narrow) for kickers and page furniture only.
Surface: flat newsprint; no shadows; a faint paper grain (an inline SVG `feTurbulence` noise as `background-image` at 3–4% opacity); rules everywhere — a thick 3px masthead rule, 1px rules between columns and stories, double rules above section heads.
Shapes: rectangles only, square corners; boxed sidebars with a 1px ink border and a small caps header; a folio line (site name, date, "Page 1") repeated in the footer.
Imagery: black-and-white halftone (`filter: grayscale(1) contrast(1.15)` under a `radial-gradient` dot pattern with `mix-blend-mode: multiply`), each photo with an italic caption and a credit; images sit inside the column grid, never full-bleed.
Motion: none; hover underlines a headline in the red.
Avoid: color photography, rounded corners, drop shadows, a hero image above the masthead, wide unfilled whitespace.
