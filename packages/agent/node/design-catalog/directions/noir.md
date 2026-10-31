---
title: "Noir"
description: "Black ground, white type, monochrome photography, and one cold accent: the site is a darkroom print. Contrast does the work, images carry the mood, and everything else stays out of the way. For photographers, nightlife, fashion, studios, and anything that wants to feel expensive after dark."
---
Palette: black `#0b0b0c`, charcoal `#161618` for panels, white `#f2f2f0` for text, gray `#8a8a8a` for secondary text, one cold accent (steel blue `#5b8def` or acid lime `#c8ff3d`) used only for links, one rule, and the call to action.
Type: a tight grotesk (Inter Tight, Archivo, or Manrope) at weight 500–600 for headlines at `clamp(2.5rem, 7vw, 6.5rem)` with `letter-spacing: -0.03em` and `line-height: 0.95`, or a high-contrast serif (Playfair Display) for a more fashion feel; body at 1rem/1.6 in white at 80% opacity; small uppercase labels with `letter-spacing: 0.14em` in gray.
Surface: flat black; panels in charcoal separated by 1px rules in white at 12% opacity; no drop shadows; an optional fine film grain (an inline SVG `feTurbulence` noise at 4–5% opacity).
Shapes: square corners; hairlines; large images with no borders; generous black space between sections; the accent as a single 2px rule under the hero headline.
Imagery: monochrome photography (`filter: grayscale(1) contrast(1.1)`), large and frequent, with a gradient scrim toward black at the edge that meets text; captions in the label style; an optional slow reveal of an image from black.
Motion: slow fades from black (800ms) as images enter the viewport; hover brightens an image slightly (`filter: brightness(1.1)`); link underline in the accent; nothing bouncy.
Avoid: color photography, rounded corners, gradients other than scrims, gray backgrounds lighter than charcoal, more than one accent.
