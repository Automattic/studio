---
title: "Book"
description: "The site is set like a well-made book: a warm white page, one text serif at a comfortable reading size, a measure of about sixty-five characters, real italics and small caps, a drop cap opening each section, and a wide outer margin that holds dates and marginal notes. The body text is the design; nothing competes with it."
---
Palette: page `#fbf7ef`, ink `#1f1c18`, one rubrication accent (brick `#9a3b2b`) for drop caps, links, and marginal notes; no other color.
Type: one text serif built for long reading (Literata, Newsreader, Source Serif, or EB Garamond) at 1.125–1.25rem with `line-height: 1.6` and `max-width: 65ch`; headlines in the same face at 2–3rem, never poster scale; section labels in small caps (`font-variant-caps: small-caps; letter-spacing: 0.06em`), emphasis in true italics, old-style numerals (`font-variant-numeric: oldstyle-nums`); a drop cap on the first paragraph of each section via `::first-letter` (`float: left; font-size: 3.4em; line-height: 0.8`).
Surface: flat page; no cards, no shadows; hairline rules only above running heads and footnotes.
Shapes: none — structure comes from the measure, the vertical rhythm, and asymmetric margins with a wider outer margin (`grid-template-columns: 1fr minmax(0, 65ch) 14rem`) carrying marginal notes as small italic paragraphs.
Imagery: rare and small, inset into the text column like plates in a book, each with an italic caption; no full-bleed images and no hero image.
Motion: none beyond a link underline that thickens on hover (`text-decoration-thickness`).
Avoid: sans-serif headlines, pull-quote cards, hero images, centered text, anything wider than the measure, more than one accent.
