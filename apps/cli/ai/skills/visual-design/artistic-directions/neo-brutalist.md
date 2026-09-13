---
title: "Neo-brutalist"
description: "Flat saturated color fields, thick black borders, hard offset shadows, big unapologetic grotesk type, and zero rounding: the page looks assembled from cardboard and marker. Loud, blocky, and fun, with every element outlined like a sticker."
---
Palette: off-white `#fdfbf3` ground, black `#000000` outlines, and two or three saturated flats (lime `#c7f464`, hot pink `#ff5ca8`, sky `#7dd3fc`, orange `#ff8a3d`); each section takes one flat as its background.
Type: a wide or heavy grotesk (Archivo Black, Syne, Bricolage Grotesque, or Space Grotesk at 700) for headlines at `clamp(2.5rem, 8vw, 7rem)`, uppercase welcome, `line-height: 0.95`; body in a plain grotesk at 1rem/1.5; labels in monospace for contrast.
Surface: flat; `border: 3px solid #000` on cards, buttons, images, and inputs; hard offset shadows `box-shadow: 6px 6px 0 #000`; no blur, no gradients.
Shapes: rectangles only, `border-radius: 0`; rotated sticker badges (`transform: rotate(-4deg)`) with a black border; 4px section dividers; marquee strips of repeated text along section edges.
Imagery: photos with a black border and offset shadow; flat illustrations with thick outlines; an optional duotone into the section color.
Motion: hover moves the element by `translate(-2px, -2px)` and grows its shadow to `8px 8px`; a running marquee (a `translateX` loop, paused under reduced motion); no fades.
Avoid: soft shadows, gradients, rounded corners, thin type, muted colors.
