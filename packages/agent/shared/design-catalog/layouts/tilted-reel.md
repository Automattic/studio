---
title: "Tilted reel"
description: "Images run across sections in full-width strips rotated a few degrees, like a film reel laid diagonally across the page, and the text sits in the wedges of space the strips leave open. The reel is the page's spine: every image on the site belongs to a strip."
---
Build: each strip a flex row of image blocks with a fixed height and a small gap, wider than the viewport (`width: 120vw; margin-inline-start: -10vw`), `transform: rotate(-4deg)`, inside a section with `overflow: hidden` and enough block padding that the rotated strip stays fully visible; text groups positioned in the open wedge above or below the strip, clear of it, and a strip covers empty space only, clearing the nearest line of text by at least one line-height; strips alternate rotation direction down the page.
Fallback: strips lose the rotation and become horizontal scroll-snap rows on mobile.
