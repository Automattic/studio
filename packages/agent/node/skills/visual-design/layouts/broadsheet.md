---
title: "Broadsheet"
description: "The page is laid out as a newspaper front page: a masthead across the top, a dateline rule, a lead story spanning three columns with a large image, two narrower side columns with shorter items, and \"continued on\" links at the foot of each column."
---
Build: a CSS grid with named areas (`masthead`, `lead`, `side-a`, `side-b`, `foot`), `column-count: 3` on the lead story, hairline rules between columns via `column-rule` and borders, a masthead heading at `clamp(3rem, 10vw, 8rem)`.
Fallback: columns collapse to one below 782px; the masthead stays.
