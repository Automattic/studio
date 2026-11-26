---
title: "Athletic"
description: "Fast and hard: a white or black ground, one neon accent, condensed italic uppercase type at poster scale, diagonal cuts between sections, oversized numbers, and motion that actually moves — marquees, counters, slides. For gyms, sports clubs, races, energy drinks, and anything that sells intensity."
---
Palette: white `#ffffff` with black `#0c0c0c` sections, or the reverse; one neon accent — volt `#ccff00`, signal orange `#ff4d00`, or electric cyan `#00e5ff` — for headline words, numbers, the primary button, and diagonal bands; gray `#8c8c8c` for secondary text; no other color.
Type: a condensed grotesk (Barlow Condensed, Oswald, or Anton) in uppercase italics at 700–900 for headlines at `clamp(3.5rem, 11vw, 10rem)` with `line-height: 0.85` and `letter-spacing: -0.02em`, the second line optionally outlined (`-webkit-text-stroke: 2px; color: transparent`); body in a plain grotesk (Barlow or Work Sans) at 1rem/1.5; stats as oversized numerals in the accent.
Surface: flat black and white fields; no shadows; no gradients except a scrim on photographs; a repeating diagonal hatch (`repeating-linear-gradient(-45deg, ...)`) in the accent as a texture strip.
Shapes: sections end in a diagonal (`clip-path: polygon(0 0, 100% 0, 100% 90%, 0 100%)`); skewed buttons and tags (`transform: skewX(-8deg)`, text unskewed); thick 6px accent bars; square corners.
Imagery: high-contrast action photography with crushed blacks (`filter: contrast(1.25) saturate(1.1)`), or duotoned into black and the accent with `mix-blend-mode`; images cut at a diagonal; no soft or posed shots.
Motion: a text marquee in the accent between sections (a `translateX` loop, paused under reduced motion); numbers count up on first view; a 250ms slide-in from the left for headlines; hover fills a button with the accent instantly; fast easing (`cubic-bezier(0.2, 0, 0, 1)`).
Avoid: pastel or muted tones, serifs, rounded corners, cream, slow fades, thin type, more than one accent, centered body text.
