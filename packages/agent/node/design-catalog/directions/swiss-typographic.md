---
title: "Swiss typographic"
description: "The page is set like a 1960s Swiss poster: a white ground, black text, one signal red, and only functional elements. Hierarchy comes from size and position alone — headlines at poster scale, small text in tight flush-left blocks — and everything snaps to a visible modular grid with hairline rules."
---
Palette: paper white `#ffffff`, ink `#111111`, one signal red `#e2231a`; each color at full strength in flat fills, with red as the single accent.
Type: one neutral grotesk (Inter Tight, Archivo, or another Helvetica-class face) for everything; headlines at `clamp(3rem, 9vw, 9rem)` with `letter-spacing: -0.03em` and `line-height: 0.95`; body at 1rem/1.5 in narrow flush-left columns; labels uppercase with `letter-spacing: 0.08em`; upright roman sans throughout.
Surface: flat, plain white; `border-radius: 0` everywhere.
Shapes: 1px hairline rules in ink between sections and columns; an occasional solid red rectangle as a block of color; square corners; text always flush-left.
Imagery: black-and-white photography (`filter: grayscale(1)`), or duotoned into red with `mix-blend-mode: multiply` over a red field; images sit flat in grid cells with square corners.
Motion: instant hover changes (text turns red) are the only motion; everything else stays still.
Avoid: centered text, drop shadows, a second accent color, decorative icons, rounded corners.
