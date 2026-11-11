---
title: "Radial hub"
description: "The hero is the center of a wheel: sections are arranged in a ring around it at equal angles, connected to the hub by spokes, and each section is a card that faces the center. The visitor reads by moving around the ring."
---
Build: a square stage with the hero centered; section cards absolutely positioned with `rotate(n*60deg) translate(38vmin) rotate(-n*60deg)`, spokes as an inline SVG of lines; card width from `--card` so the ring scales with the viewport.
Fallback: the ring unrolls into a vertical stack on screens narrower than 900px.
