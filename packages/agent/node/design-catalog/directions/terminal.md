---
title: "Terminal"
description: "The site is a screen, not a page: black ground, one phosphor accent, monospace type for everything, hairline borders, and labels that look like command output. Structure comes from indices, prompts, and rules rather than from color or imagery."
---
Palette: black `#0a0a0a`, panel `#111111`, one phosphor accent — green `#33ff66`, amber `#ffb000`, or cyan `#4de3ff` — dim text `#9a9a9a`, bright text `#e8e8e8`.
Type: one monospace face (JetBrains Mono, IBM Plex Mono, or Space Mono) for everything including headlines at `clamp(2rem, 6vw, 5rem)` with `line-height: 1.1`; body 0.9375rem/1.6; labels prefixed with `>` or `$` or numbered `01`, `02`, uppercase with `letter-spacing: 0.1em`.
Surface: flat black; panels drawn with a `1px solid` border in the accent at 30% opacity; an optional faint scanline overlay (`repeating-linear-gradient(0deg, transparent 0 2px, rgb(0 0 0 / 0.15) 2px 3px)`).
Shapes: square corners, 1px rules, bracketed labels (`[ menu ]`), ASCII-style dividers (`────`), and a blinking block cursor after the headline (a `steps(1)` opacity animation, 1s).
Imagery: minimal; photos in a monochrome treatment (`filter: grayscale(1) contrast(1.2)`) under an accent-tinted overlay, or replaced by data tables and ASCII-like grids.
Motion: a typewriter reveal of the hero headline (`steps()` on width, once), the cursor blink, instant hover inversions (accent background, black text); no easing curves.
Avoid: rounded corners, gradients other than scanlines, a second accent, proportional fonts anywhere.
