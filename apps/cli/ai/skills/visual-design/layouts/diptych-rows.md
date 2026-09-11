---
title: "Diptych rows"
description: "The page is a strict rhythm of image rows: a pair of images side by side edge to edge, then one full-width image, then a pair, then one, all the way down. Each pair is a deliberate juxtaposition — a portrait beside a detail, a wide shot beside a close-up — and the few text sections sit inside the rhythm as a full-width row of type, never beside an image."
---
Build: alternate two-column groups (`gap: 0`, each column a cover or image block with `aspect-ratio: 4 / 5`) and single full-width cover or image blocks (`aspect-ratio: 21 / 9`), all `alignfull`; text rows as constrained groups with generous block padding; zero the theme block gap between rows (`margin-block-start: 0` on the row groups) so images touch; the header is a slim fixed bar with its own background.
Fallback: pairs stack into single images on mobile, keeping the order.
