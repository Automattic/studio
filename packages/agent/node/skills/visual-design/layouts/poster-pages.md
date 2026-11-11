---
title: "Poster pages"
description: "Every section is a full-viewport poster: one full-bleed image, one headline, one line of text, one link, nothing else, and the page snaps from poster to poster. The site reads like a campaign rather than a document."
---
Build: `scroll-snap-type: y mandatory` on the page, each section a cover block with `height: 100dvh; scroll-snap-align: start`, content bottom-left with a gradient scrim; the footer is the last poster; the header is fixed over the posters (`position: fixed; top: 0` with a transparent or translucent background) rather than a block above the first one — with mandatory snapping, an in-flow header shorter than a viewport can never be scrolled into view; if it must stay in flow, give it `scroll-snap-align: start` too.
Fallback: snap disabled and heights relaxed to `min-height: 70dvh` on screens shorter than 640px.
