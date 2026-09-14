---
title: "Sticky split"
description: "The page is two half-width panes. The left pane is pinned to the viewport and holds one large image that changes as each section passes; the right pane scrolls the content. Every section owns an image, so the left pane is never blank and the split is visible from the first pixel to the footer."
---
Build: a two-column group (`grid-template-columns: 1fr 1fr; align-items: start`); the left column `position: sticky; top: 0; height: 100dvh` holding one absolutely positioned image per section stacked with `opacity: 0`; an IntersectionObserver on each right-hand section toggles `is-active` on its image; the header floats over the split.
Fallback: single column on mobile, each section's image shown above its text.
