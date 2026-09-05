# Signature Concepts

Catalog behind the `visual-design` skill's concept shortlist. The Skill tool samples a random subset of these entries into the runbook on every load, so the same brief gets a different shortlist each run. Each `##` heading is one concept with three fixed lines: **Fits**, **Build**, **Fallback**.

The bar for an entry: a template would never ship it, and a visitor would describe it to a friend. Every concept is written to be buildable inside a block theme with the tools Studio Code has: `theme.json`, `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Content stays editable in blocks. Motion respects `prefers-reduced-motion`, and CSS scroll-driven animations (`animation-timeline: scroll()` / `view()`) sit inside `@supports` with a static or IntersectionObserver fallback.

## Four-tile cover
A cover made of four squares that together fill the viewport; each tile carries one part of the hero (image, headline, color field, call to action) and enters with a short stagger.
Fits: studios, portfolios, brands with strong imagery or a four-part offer.
Build: full-height group with a 2×2 CSS grid (`height: 100dvh`), each tile a group or cover block; entrance via `@keyframes` with per-tile `animation-delay`.
Fallback: tiles stack into a single column on small screens; no entrance animation under reduced motion.

## Growing artifact
A single illustrated object (plant, building, product, logo) sits pinned beside the content and grows or unfolds as the visitor scrolls the story.
Fits: gardens, sustainability, product journeys, "how we grew" pages.
Build: sticky column holding an inline SVG; stages toggled by `view()` timelines on paths (`scale`, `stroke-dashoffset`) or an IntersectionObserver that adds `is-stage-2`, `is-stage-3` classes.
Fallback: artifact shown fully grown, static, above the content on mobile.

## Changing seasons
A hero scene (tree, landscape, storefront) shifts through spring, summer, autumn, and winter as the visitor scrolls, or matches the current month on load.
Fits: farms, gardens, tourism, schools, seasonal shops.
Build: inline SVG scene with four CSS states toggled by a `season-*` class on the hero; a `scroll()` timeline or a 5-line script picks the class from the month.
Fallback: single season matching the current month, static.

## Perspective floor
A grid that recedes toward a horizon behind the hero, giving the page a 3D room feel without any 3D library; the horizon glows in the accent and the grid drifts slowly toward the visitor.
Fits: tech, games, music, retro-future brands.
Build: a fixed pseudo-element with `background-image: repeating-linear-gradient` lines, `transform: perspective(60vh) rotateX(60deg)`, a slow `background-position` keyframe, a `radial-gradient` glow at the horizon.
Fallback: static grid; animation off under reduced motion.

## Giant clock
The hero is a clock face filling the viewport; the hands show the real time, and the twelve hour markers are the navigation.
Fits: watchmakers, bars, coworking spaces, event venues, anything built around hours.
Build: a circular group with twelve absolutely positioned links rotated around the center (`rotate(n*30deg) translateY(-42%) rotate(-n*30deg)`), hands as thin groups rotated by a 5-line script from the current time.
Fallback: hands static at the load time; markers become a list on mobile.

## Rotating cube
The hero is a cube; each face is a section, and the navigation rotates it to the chosen face.
Fits: agencies with four services, product with four features, portfolios.
Build: a `perspective` wrapper with a `transform-style: preserve-3d` group; faces absolutely positioned with `rotateY(n*90deg) translateZ(...)`; radio inputs set the cube's rotation.
Fallback: faces stack as sections on mobile and under reduced motion.

## Turnaround room
The hero is a room the visitor can turn around in: panels arranged in a cylinder, dragged or scrolled to look at each wall.
Fits: interiors, galleries, hotels, showrooms, escape rooms.
Build: eight panel groups under `perspective` with `rotateY(n*45deg) translateZ(r)`; a wrapper rotates by pointer drag or arrow keys via a 20-line script.
Fallback: panels become a horizontal scroll-snap row on mobile.

## Day to night
The page begins at dawn and ends at night: the sky gradient darkens as the visitor scrolls, stars fade in, and the footer is midnight.
Fits: hotels, cafés open late, event venues, wellness.
Build: fixed background gradient whose stops are variables animated on a `scroll()` timeline over the page; a stars layer (`radial-gradient` dots) fades in past 60%.
Fallback: static dusk gradient.

## Keyhole hero
The hero image is seen through a shape (circle, arch, letterform) that expands to full bleed as the visitor scrolls.
Fits: photographers, travel, architecture, wellness.
Build: cover block with `clip-path: circle(20% at 50% 50%)` animated to `circle(100%)` on a `view()` timeline; the shape can be `inset(... round ...)` for an arch.
Fallback: static full-bleed image when scroll timelines are unsupported or motion is reduced.

## Departures board
The hero is an airport departures board: rows of split-flap letters that flip into place to spell the headline and the section names, with a clock and a "now boarding" row.
Fits: travel, logistics, event schedules, coworking spaces, anything with a timetable.
Build: each letter a small dark tile with a horizontal seam (`::after` hairline); flipping via a `rotateX` keyframe under `perspective` with per-tile delay, running through a few characters before settling; rows are links.
Fallback: letters shown settled under reduced motion.
