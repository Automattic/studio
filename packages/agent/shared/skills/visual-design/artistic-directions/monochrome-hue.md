---
title: "Monochrome hue"
description: "One color, the whole site: a single saturated hue — Klein blue, poppy red, forest green — as the ground of most sections, its tints and shades doing everything a palette normally does, type in the hue's darkest shade or in white, and no second color anywhere, photographs included. Striking and unmistakable; the color becomes the brand. For studios, launches, fashion, and any business that owns a color."
---
Palette: one hue in a four-step ladder — for blue: field `#1f3aff`, deep `#0a1466` for text on tints, tint `#dfe4ff` for light sections, pale `#f2f4ff` for an occasional resting section — plus white `#ffffff` for text on the field; red (`#e2261f` / `#5c0d0a` / `#fde3e1` / `#fff4f3`) and green (`#0f6b3a` / `#062d18` / `#dcefe3` / `#f1f8f4`) follow the same ladder; the field at full strength covers at least half the page; black is never used.
Type: one grotesk with presence (Archivo, Instrument Sans at 600, or Schibsted Grotesk) for headlines at `clamp(2.75rem, 8vw, 7rem)` with `letter-spacing: -0.03em` and `line-height: 0.95`; body at 1.0625rem/1.55 in white on the field or deep on tints; labels uppercase with `letter-spacing: 0.1em`.
Surface: flat fields in the four steps; no shadows, no gradients; sections are separated only by a change of step; buttons are white on the field and field-colored on tints.
Shapes: square corners, or one large radius used everywhere — pick one; a single large circle or half-circle in the tint as the only shape; 1px rules in the deep at 25% opacity.
Imagery: photography duotoned into the hue (`filter: grayscale(1)` under a field-colored overlay with `mix-blend-mode: multiply` or `screen`) so nothing on the page breaks the monochrome; icons in the deep or white.
Motion: instant hover inversions (white and field swap); a 500ms fade on scroll; nothing else.
Avoid: a second hue anywhere including photographs, black text, gray, cream, gradients, the hue used only as an accent on white.
