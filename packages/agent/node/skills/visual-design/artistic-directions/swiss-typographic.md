---
title: "Swiss typographic"
description: "The page is set like a 1960s Swiss poster: a white ground, black text, one signal red, and nothing decorative. Hierarchy comes from size and position alone — headlines at poster scale, small text in tight flush-left blocks — and everything snaps to a visible modular grid with hairline rules."
---
Palette: paper white `#ffffff`, ink `#111111`, one signal red `#e2231a`; no tints, no gradients, no second accent.
Type: one neutral grotesk (Inter Tight, Archivo, or another Helvetica-class face) for everything; headlines at `clamp(3rem, 9vw, 9rem)` with `letter-spacing: -0.03em` and `line-height: 0.95`; body at 1rem/1.5 in narrow flush-left columns; labels uppercase with `letter-spacing: 0.08em`; no italics, no serifs.
Surface: flat white; no shadows, no textures, `border-radius: 0` everywhere.
Shapes: 1px hairline rules in ink between sections and columns; an occasional solid red rectangle as a block of color; square corners; text always flush-left, never centered.
Imagery: black-and-white photography (`filter: grayscale(1)`), or duotoned into red with `mix-blend-mode: multiply` over a red field; images sit in grid cells with no radius and no shadow.
Motion: none beyond instant hover changes (text turns red); no fades, no parallax.
Avoid: centered text, drop shadows, a second accent color, decorative icons, rounded corners.
