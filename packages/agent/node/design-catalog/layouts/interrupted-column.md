---
title: "Interrupted column"
description: "A narrow reading column runs down the page and is interrupted, at regular intervals, by full-bleed bands that run edge to edge: an image, a wide quote, a row of products. The rhythm of narrow, wide, narrow is the layout."
---
Build: `settings.layout.contentSize` set narrow (`640px`) in `theme.json`; text sections as constrained groups; every second or third section an `alignfull` group or cover block with its own background; content uses only the narrow width and `alignfull`, so exactly two widths exist; the header is a slim fixed bar (`position: sticky; top: 0`) with its own opaque or translucent background so it stays distinct from the band scrolling under it.
Fallback: the same two widths carry over to mobile as they are.
