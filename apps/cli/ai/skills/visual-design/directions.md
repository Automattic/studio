# Artistic Directions

Catalog behind the `visual-design` skill's direction shortlist. The Skill tool samples a random subset of these entries into the runbook on every load, so the same brief gets a different shortlist each run. Each `##` heading is one direction: a description, then seven fixed lines, **Palette**, **Type**, **Surface**, **Shapes**, **Imagery**, **Motion**, and **Avoid**.

A direction is about feeling, not structure: the colors, the type, the surfaces, the shapes, how imagery is treated, and how things move. The layout is decided separately by the signature concept, and any direction must be able to dress any concept. Every direction is buildable inside a block theme with the tools Studio Code has: `theme.json` (palette and typography), `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Palette hex values are starting points for `settings.color.palette`; tune them to the brand, but keep the relationships.

## Swiss typographic
The page is set like a 1960s Swiss poster: a white ground, black text, one signal red, and nothing decorative. Hierarchy comes from size and position alone — headlines at poster scale, small text in tight flush-left blocks — and everything snaps to a visible modular grid with hairline rules.
Palette: paper white `#ffffff`, ink `#111111`, one signal red `#e2231a`; no tints, no gradients, no second accent.
Type: one neutral grotesk (Inter Tight, Archivo, or another Helvetica-class face) for everything; headlines at `clamp(3rem, 9vw, 9rem)` with `letter-spacing: -0.03em` and `line-height: 0.95`; body at 1rem/1.5 in narrow flush-left columns; labels uppercase with `letter-spacing: 0.08em`; no italics, no serifs.
Surface: flat white; no shadows, no textures, `border-radius: 0` everywhere.
Shapes: 1px hairline rules in ink between sections and columns; an occasional solid red rectangle as a block of color; square corners; text always flush-left, never centered.
Imagery: black-and-white photography (`filter: grayscale(1)`), or duotoned into red with `mix-blend-mode: multiply` over a red field; images sit in grid cells with no radius and no shadow.
Motion: none beyond instant hover changes (text turns red); no fades, no parallax.
Avoid: centered text, drop shadows, a second accent color, decorative icons, rounded corners.

## Quiet luxury editorial
The site reads like the pages of a fashion or hospitality magazine: warm cream paper, ink text, a high-contrast serif for headlines, tiny spaced capitals for labels, hairline rules, and a great deal of empty space. Restraint is the statement — few elements, each placed exactly.
Palette: cream `#f4efe6`, ink `#1a1917`, one muted accent (moss `#5b6b4f` or oxblood `#6b2f2f`) used only for links and a single rule.
Type: a high-contrast serif (Playfair Display, Cormorant, or Fraunces at a high optical size) for headlines at `clamp(2.5rem, 7vw, 6.5rem)`, weight 400, `line-height: 1.05`; body in a quiet serif or humanist sans at 1.0625rem/1.6; labels uppercase at `0.75rem` with `letter-spacing: 0.18em`; italic serif for pull quotes.
Surface: flat cream; no shadows and no cards — content sits on the page, separated by whitespace and 1px rules in ink at 20% opacity; section padding 8–12rem on desktop.
Shapes: hairlines, thin borders, square corners or a 2px radius at most; wide margins.
Imagery: full-color editorial photography with a slight warm grade (`filter: sepia(0.08) contrast(1.02)`), usually one large image per section with a small caption in the label style.
Motion: slow (600–900ms) fades with a 12px rise on scroll for images and headlines; link hover draws a 1px underline from left to right.
Avoid: bold weights, saturated colors, icons, drop shadows, badges and pills, dense layouts.

## Soft neutral
The everyday product look of the 2020s, done with care: a warm off-white ground, layered muted neutrals, rounded corners, soft borders, a friendly humanist sans, and one quiet accent. Calm and tidy, with contrast coming from tone rather than color.
Palette: off-white `#faf8f5`, surface `#f0ece6`, stone `#d9d3ca`, text `#2b2a27`, one accent (clay `#c8724f`, sage `#7d8f74`, or slate blue `#5b6e8c`).
Type: one humanist or rounded sans (Instrument Sans, Plus Jakarta Sans, Manrope, or Nunito Sans) throughout; headlines at `clamp(2rem, 5vw, 4rem)`, weight 500–600, `letter-spacing: -0.02em`; body 1rem/1.6.
Surface: layered flat tones — sections and cards use the surface and stone tones with a 1px border in the next-darker tone; at most one soft shadow (`0 1px 2px rgb(0 0 0 / 0.04)`).
Shapes: `border-radius: 12–20px` on cards, buttons, and images; pill buttons; generous gaps; nothing sharp.
Imagery: soft natural photography or simple line illustrations in the accent color; images rounded to match the cards.
Motion: 200–300ms ease-out transitions on hover with a 2px lift on cards; nothing on scroll.
Avoid: pure white or pure black, saturated multi-color palettes, hard edges, heavy weights, gradients.

## Bauhaus
Primary colors, elementary shapes, and functional type: the page is composed of circles, triangles, and bars in red, yellow, and blue on white and black, with a geometric sans and an asymmetric grid. The shapes are the ornament and each one does a job — a red disc behind a number, a yellow bar under a headline, a blue triangle pointing at the call to action.
Palette: white `#f5f2ea`, black `#141414`, red `#d7261e`, yellow `#f2c318`, blue `#1d4e9e`; flat fields at full strength, one primary dominant per section.
Type: one geometric sans (Jost, Outfit, or Josefin Sans — Futura-class) for everything; headlines at `clamp(2.5rem, 8vw, 7rem)`, weight 700, often lowercase; body 1rem/1.5; large numerals used as graphic elements.
Surface: flat; no shadows, textures, or gradients; sections alternate white and black backgrounds.
Shapes: circles (`border-radius: 50%`), triangles (`clip-path: polygon(...)`), and rectangles as absolutely positioned elements behind or beside content; 4–8px rules in one primary; content offset from center.
Imagery: photos in black-and-white or with one primary overlaid (`mix-blend-mode: multiply`), cropped into a circle or rectangle that belongs to the shape system.
Motion: shapes rotate or slide in once on first view (400ms); hover swaps a shape's color between two primaries.
Avoid: pastel tints, rounded containers, serifs, any color beyond the three primaries plus black and white.

## Art Deco
A 1920s grand-hotel feel: a deep dark ground, gold lines and lettering, a tall condensed display face, sunburst and fan motifs, stepped frames, and symmetrical composition. Luxury through geometry and gilt rather than photography.
Palette: a ground of near-black `#0f0f14`, deep emerald `#0e2f2a`, or navy `#101a3a`; gold `#c9a24d` for rules and headlines; ivory `#f1e9d6` for text; one jewel accent (oxblood `#6e1f2a`) used sparingly.
Type: a tall condensed or geometric display face (Cinzel, Marcellus, Poiret One, or Josefin Sans) for headlines in uppercase with `letter-spacing: 0.12–0.2em`; body in a quiet serif (Cormorant or EB Garamond) or a light geometric sans at 1.0625rem/1.6.
Surface: flat dark ground; gold as flat color or a subtle gradient (`linear-gradient(135deg, #d8b45c, #a8822f)`) on headline text via `background-clip: text` and on rules; no drop shadows.
Shapes: double hairline frames (a `border` plus an offset `outline`), stepped corners via `clip-path`, a sunburst behind the hero from `repeating-conic-gradient`, chevron dividers; strict horizontal symmetry with centered headlines.
Imagery: photography desaturated and tinted toward the ground (`filter: grayscale(1) sepia(0.3)`) under a dark scrim, or replaced by pattern; framed images carry a 1px gold border.
Motion: the sunburst fades in on load (1200ms); gold rules draw in on scroll; hover brightens gold.
Avoid: rounded corners, light backgrounds, heavy sans body text, bright saturated colors.

## Terminal
The site is a screen, not a page: black ground, one phosphor accent, monospace type for everything, hairline borders, and labels that look like command output. Structure comes from indices, prompts, and rules rather than from color or imagery.
Palette: black `#0a0a0a`, panel `#111111`, one phosphor accent — green `#33ff66`, amber `#ffb000`, or cyan `#4de3ff` — dim text `#9a9a9a`, bright text `#e8e8e8`.
Type: one monospace face (JetBrains Mono, IBM Plex Mono, or Space Mono) for everything including headlines at `clamp(2rem, 6vw, 5rem)` with `line-height: 1.1`; body 0.9375rem/1.6; labels prefixed with `>` or `$` or numbered `01`, `02`, uppercase with `letter-spacing: 0.1em`.
Surface: flat black; panels drawn with a `1px solid` border in the accent at 30% opacity; an optional faint scanline overlay (`repeating-linear-gradient(0deg, transparent 0 2px, rgb(0 0 0 / 0.15) 2px 3px)`).
Shapes: square corners, 1px rules, bracketed labels (`[ menu ]`), ASCII-style dividers (`────`), and a blinking block cursor after the headline (a `steps(1)` opacity animation, 1s).
Imagery: minimal; photos in a monochrome treatment (`filter: grayscale(1) contrast(1.2)`) under an accent-tinted overlay, or replaced by data tables and ASCII-like grids.
Motion: a typewriter reveal of the hero headline (`steps()` on width, once), the cursor blink, instant hover inversions (accent background, black text); no easing curves.
Avoid: rounded corners, gradients other than scanlines, a second accent, proportional fonts anywhere.

## Liquid glass
Layered translucent panels floating over a soft colored field: content sits on frosted surfaces with blur, a bright specular edge, and gentle depth, while two or three blurred color blobs glow behind everything. Light, cool, and slightly refractive.
Palette: a light field `#eef1f7` with two or three soft blobs (sky `#9ec5ff`, lilac `#c9b8ff`, mint `#a8f0d4`) blurred behind the content; ink `#14161c`; glass panels white at 55–70% opacity; one saturated action accent `#2f6bff`. Dark variant: field `#0e1220`, blobs at half opacity, panels white at 8–12% with ivory text.
Type: a clean sans (Inter, Manrope, or Albert Sans) at weight 500–600; headlines at `clamp(2.25rem, 6vw, 5rem)` with `letter-spacing: -0.02em`; body 1rem/1.55.
Surface: glass panels as `background: rgb(255 255 255 / 0.6); backdrop-filter: blur(24px) saturate(1.4); border: 1px solid rgb(255 255 255 / 0.7); box-shadow: 0 8px 32px rgb(20 22 28 / 0.08), inset 0 1px 0 rgb(255 255 255 / 0.8)`; blobs as absolutely positioned `border-radius: 50%` divs with `filter: blur(80px)` behind the content; check text contrast on every panel.
Shapes: large radii (`border-radius: 24–32px`), pill buttons, a capsule navigation bar; panels offset slightly from each other to show depth.
Imagery: photos inside glass-framed cards with the same radius; thin monoline icons.
Motion: blobs drift slowly (a 20–30s translate loop, paused under reduced motion); panels lift 4px and brighten on hover (300ms); a subtle highlight sweep across buttons.
Avoid: hard shadows, sharp corners, more than three blob colors, a glass panel with nothing behind it to refract, text on glass without enough contrast.

## Earthy organic
Sun-baked and handmade: sand and terracotta against one deep espresso or olive ground, arches and blob shapes painted in strong color, a humanist serif with weight, warm saturated photography, and a fine grain only where it is dark. Natural, but with real contrast — clay in sunlight and shadow, not beige on beige.
Palette: sand `#efe6d8` as the light ground, one deep ground — espresso `#2b1f18` or deep olive `#2f3a2a` — on at least one full section (the story or the footer), terracotta `#c2552b` as the primary accent for a section field, buttons, and a headline word, sage `#5f6f52` and clay `#d9b99b` as supporting tones, bark `#3d3229` for text on sand and sand for text on the deep ground.
Type: a humanist serif with weight (Fraunces at 500–600, Lora at 600, or Gloock) for headlines at `clamp(2.5rem, 6.5vw, 5.5rem)`, `line-height: 1.05`, with one word in italic or in terracotta; body in a humanist sans (Nunito Sans, Karla, or Work Sans) at 1.0625rem/1.6.
Surface: flat sand; the deep sections carry a fine grain (an inline SVG `feTurbulence` noise as `background-image` at 3–4% opacity), the light ones none; no drop shadows; borders in bark at 15% opacity.
Shapes: arches (`border-radius: 999px 999px 0 0`) on images and cards and one large terracotta arch behind the hero image, blobs (`border-radius: 60% 40% 55% 45% / 50% 60% 40% 50%`) painted in terracotta or the deep ground and never in a tint of the page background, a wavy SVG underline under key words; large radii on buttons.
Imagery: natural-light photography of materials, hands, food, and plants with a warm saturated grade (`filter: saturate(1.15) contrast(1.05) sepia(0.06)`), cropped into arches or blobs; images sit on the sand ground or bleed into the deep sections.
Motion: gentle 500ms fades on scroll; blob accents drift very slowly; hover deepens the terracotta.
Avoid: pure white, cool grays, sharp corners, neon, heavy sans headlines, a page with no dark section, accent colors used only on hover, desaturated photos.

## Neo-brutalist
Flat saturated color fields, thick black borders, hard offset shadows, big unapologetic grotesk type, and zero rounding: the page looks assembled from cardboard and marker. Loud, blocky, and fun, with every element outlined like a sticker.
Palette: off-white `#fdfbf3` ground, black `#000000` outlines, and two or three saturated flats (lime `#c7f464`, hot pink `#ff5ca8`, sky `#7dd3fc`, orange `#ff8a3d`); each section takes one flat as its background.
Type: a wide or heavy grotesk (Archivo Black, Syne, Bricolage Grotesque, or Space Grotesk at 700) for headlines at `clamp(2.5rem, 8vw, 7rem)`, uppercase welcome, `line-height: 0.95`; body in a plain grotesk at 1rem/1.5; labels in monospace for contrast.
Surface: flat; `border: 3px solid #000` on cards, buttons, images, and inputs; hard offset shadows `box-shadow: 6px 6px 0 #000`; no blur, no gradients.
Shapes: rectangles only, `border-radius: 0`; rotated sticker badges (`transform: rotate(-4deg)`) with a black border; 4px section dividers; marquee strips of repeated text along section edges.
Imagery: photos with a black border and offset shadow; flat illustrations with thick outlines; an optional duotone into the section color.
Motion: hover moves the element by `translate(-2px, -2px)` and grows its shadow to `8px 8px`; a running marquee (a `translateX` loop, paused under reduced motion); no fades.
Avoid: soft shadows, gradients, rounded corners, thin type, muted colors.

## Risograph
The page looks printed on a two-color risograph: a paper ground, two or three spot inks that overprint into a third color where they overlap, grainy fills, slightly misregistered headlines, and flat illustrative shapes. Analog, tactile, and warm, with the imperfection as the charm.
Palette: paper `#f6f1e7`; two inks such as blue `#2f4bd6` and fluorescent orange `#ff6b35`, or teal `#0b8a8f` and pink `#ff4f8b`; black `#1b1b1b` for body text; overlaps rendered with `mix-blend-mode: multiply`.
Type: a bold grotesk or chunky serif (Archivo, Young Serif, or Work Sans at 800) for headlines at `clamp(2.5rem, 7vw, 6rem)`; body in a plain sans (Karla or Work Sans) at 1rem/1.55; misregistration by duplicating the headline in the second ink via a `::before` with `content: attr(data-text)`, offset 3px, `mix-blend-mode: multiply`.
Surface: paper with a fine grain (an inline SVG `feTurbulence` noise as `background-image` at 6–8% opacity); ink fields at 85–95% opacity so the grain shows through; no drop shadows.
Shapes: flat rectangles and circles in the inks, halftone-dot tints from `radial-gradient` patterns, rough 2px rules, slight rotations on stickers and captions; square or barely rounded corners.
Imagery: photos converted to one ink (`filter: grayscale(1) contrast(1.3)` with the ink overlaid via `mix-blend-mode: multiply` on a colored field), or flat illustrations in the two inks; never full-color photography.
Motion: minimal — hover swaps a button's ink; a small misregistration shift on hover (`translate(2px, -2px)` on the duplicate layer).
Avoid: gradients, full-color imagery, more than three inks, drop shadows, pure white.

## Book
The site is set like a well-made book: a warm white page, one text serif at a comfortable reading size, a measure of about sixty-five characters, real italics and small caps, a drop cap opening each section, and a wide outer margin that holds dates and marginal notes. The body text is the design; nothing competes with it.
Palette: page `#fbf7ef`, ink `#1f1c18`, one rubrication accent (brick `#9a3b2b`) for drop caps, links, and marginal notes; no other color.
Type: one text serif built for long reading (Literata, Newsreader, Source Serif, or EB Garamond) at 1.125–1.25rem with `line-height: 1.6` and `max-width: 65ch`; headlines in the same face at 2–3rem, never poster scale; section labels in small caps (`font-variant-caps: small-caps; letter-spacing: 0.06em`), emphasis in true italics, old-style numerals (`font-variant-numeric: oldstyle-nums`); a drop cap on the first paragraph of each section via `::first-letter` (`float: left; font-size: 3.4em; line-height: 0.8`).
Surface: flat page; no cards, no shadows; hairline rules only above running heads and footnotes.
Shapes: none — structure comes from the measure, the vertical rhythm, and asymmetric margins with a wider outer margin (`grid-template-columns: 1fr minmax(0, 65ch) 14rem`) carrying marginal notes as small italic paragraphs.
Imagery: rare and small, inset into the text column like plates in a book, each with an italic caption; no full-bleed images and no hero image.
Motion: none beyond a link underline that thickens on hover (`text-decoration-thickness`).
Avoid: sans-serif headlines, pull-quote cards, hero images, centered text, anything wider than the measure, more than one accent.

## Newsprint
The site reads like a daily paper: newsprint gray, black ink, a condensed serif for headlines, a running masthead with the date, bylines and datelines in small caps, dense text set in columns with rules between them, and photographs printed in halftone black-and-white. Everything feels typeset in a hurry and printed by the thousand.
Palette: newsprint `#ece8df`, ink `#161412`, a single red `#b3261e` for the masthead rule and one kicker per section; no other color.
Type: a condensed serif for headlines (Playfair Display SC, Bodoni Moda at a narrow width, or Fraunces at a high wght and tight tracking) at 2.5–4.5rem with `line-height: 1`; body in a compact text serif (Source Serif, Noto Serif, or PT Serif) at 1rem/1.45 set in `column-count: 2` or `3` with `column-rule: 1px solid` the ink at 30%; bylines, datelines, and section labels in small caps with `letter-spacing: 0.08em`; a bold sans (Oswald or Archivo Narrow) for kickers and page furniture only.
Surface: flat newsprint; no shadows; a faint paper grain (an inline SVG `feTurbulence` noise as `background-image` at 3–4% opacity); rules everywhere — a thick 3px masthead rule, 1px rules between columns and stories, double rules above section heads.
Shapes: rectangles only, square corners; boxed sidebars with a 1px ink border and a small caps header; a folio line (site name, date, "Page 1") repeated in the footer.
Imagery: black-and-white halftone (`filter: grayscale(1) contrast(1.15)` under a `radial-gradient` dot pattern with `mix-blend-mode: multiply`), each photo with an italic caption and a credit; images sit inside the column grid, never full-bleed.
Motion: none; hover underlines a headline in the red.
Avoid: color photography, rounded corners, drop shadows, a hero image above the masthead, wide unfilled whitespace.

## Playful
Bright, rounded, and friendly: a white or pale ground, a candy palette of three or four saturated colors, a chunky rounded display face, blob and pill shapes, sticker badges, flat illustrations with thick outlines, and small bouncy motion. Fun for a kids' brand, an ice cream shop, a toy store, or a festival, without tipping into chaos.
Palette: ground `#fffdf7`, ink `#22223b`, and three or four candy colors — coral `#ff6b6b`, sunflower `#ffd93d`, mint `#6bcb77`, sky `#4d96ff` — each section leading with one and using the others as accents; tints of them at 15% for backgrounds.
Type: a chunky rounded display face (Fredoka, Baloo 2, or Nunito at 800–900) for headlines at `clamp(2.5rem, 7vw, 6rem)` with `line-height: 1`, often with one word in a second candy color; body in a rounded sans (Nunito or Quicksand) at 1.0625rem/1.6; labels in uppercase with wide tracking inside pills.
Surface: flat candy fills; soft colored shadows in the element's own hue (`box-shadow: 0 8px 0 <darker tint>`) on buttons and cards for a toy-like thickness; no gradients.
Shapes: blobs (`border-radius: 60% 40% 55% 45% / 50% 60% 40% 50%`) behind images and as section dividers, pills everywhere (`border-radius: 999px`), rotated sticker badges (`transform: rotate(-6deg)`) with a thick white border, wavy section edges from an inline SVG; nothing sharp.
Imagery: bright photography cropped into blobs or circles, or flat illustrations with thick dark outlines in the palette colors; icons bold and rounded.
Motion: buttons press down on hover (the offset shadow shrinks, 120ms); badges wobble once on first view; a slow float on blob accents; all bouncy easing (`cubic-bezier(0.34, 1.56, 0.64, 1)`), off under reduced motion.
Avoid: muted tones, thin type, sharp corners, black borders, drop shadows in gray, more than four candy colors.

## Mid-century retro
The optimism of the 1950s and 60s: cream and mustard, teal and burnt orange, a friendly geometric sans with a script accent, atomic starbursts and boomerang shapes, halftone dots, and rounded rectangles with generous padding. Warm, nostalgic, and neat, like a diner menu or an airline brochure.
Palette: cream `#f4ead5`, mustard `#e0a52b`, teal `#2a7f7a`, burnt orange `#d35b2c`, walnut `#3a2a1f` for text; sections alternate cream and one saturated field with cream text.
Type: a geometric or humanist sans with round terminals (Josefin Sans, Poppins, or Outfit) for headlines at `clamp(2.25rem, 6vw, 5rem)`, weight 600–700, sometimes uppercase with wide tracking; one script or brush face (Pacifico, Kaushan Script, or Yellowtail) for a single accent word or the tagline, never for body; body in a humanist sans (Work Sans or Karla) at 1rem/1.6.
Surface: flat warm fields; a fine halftone-dot texture (`radial-gradient` pattern at 6–8% opacity) on saturated sections; no drop shadows; 2px rules in walnut.
Shapes: starbursts from `repeating-conic-gradient` or an inline SVG as accents behind numbers and badges, boomerang and kidney shapes as `border-radius`-heavy blobs, rounded rectangles (`border-radius: 16px`) on cards and buttons, diagonal section dividers via `clip-path`; slight asymmetry.
Imagery: photography with a warm faded grade (`filter: sepia(0.2) contrast(0.95) saturate(1.1)`), cropped into rounded rectangles or circles; flat illustrations with a limited palette welcome.
Motion: starbursts rotate very slowly (60s loop, off under reduced motion); hover shifts a card up 3px and swaps its accent color; nothing else.
Avoid: pure white, cool grays, neon, thin hairline type, glass or blur effects, more than one script word per section.

## Noir
Black ground, white type, monochrome photography, and one cold accent: the site is a darkroom print. Contrast does the work, images carry the mood, and everything else stays out of the way. For photographers, nightlife, fashion, studios, and anything that wants to feel expensive after dark.
Palette: black `#0b0b0c`, charcoal `#161618` for panels, white `#f2f2f0` for text, gray `#8a8a8a` for secondary text, one cold accent (steel blue `#5b8def` or acid lime `#c8ff3d`) used only for links, one rule, and the call to action.
Type: a tight grotesk (Inter Tight, Archivo, or Manrope) at weight 500–600 for headlines at `clamp(2.5rem, 7vw, 6.5rem)` with `letter-spacing: -0.03em` and `line-height: 0.95`, or a high-contrast serif (Playfair Display) for a more fashion feel; body at 1rem/1.6 in white at 80% opacity; small uppercase labels with `letter-spacing: 0.14em` in gray.
Surface: flat black; panels in charcoal separated by 1px rules in white at 12% opacity; no drop shadows; an optional fine film grain (an inline SVG `feTurbulence` noise at 4–5% opacity).
Shapes: square corners; hairlines; large images with no borders; generous black space between sections; the accent as a single 2px rule under the hero headline.
Imagery: monochrome photography (`filter: grayscale(1) contrast(1.1)`), large and frequent, with a gradient scrim toward black at the edge that meets text; captions in the label style; an optional slow reveal of an image from black.
Motion: slow fades from black (800ms) as images enter the viewport; hover brightens an image slightly (`filter: brightness(1.1)`); link underline in the accent; nothing bouncy.
Avoid: color photography, rounded corners, gradients other than scrims, gray backgrounds lighter than charcoal, more than one accent.
