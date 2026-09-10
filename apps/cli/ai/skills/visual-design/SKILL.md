---
name: visual-design
description: Plan and execute high-quality visual direction for site creation, redesign, layout, typography, color, motion, and visual polish.
user-invokable: true
---

# Visual Design

Use this skill before creating or redesigning a site, landing page, homepage, layout, style system, typography, color palette, animation system, or other visual polish.

## Design Direction

Understand the context and commit to a clear aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Artistic direction**: the feeling of the site — palette, type, surfaces, shapes, imagery, and motion — settled with `pick_design` from the direction catalog below (see "Concept and Direction").
- **Signature concept**: the spatial structure that makes the site memorable, settled by the same `pick_design` call from the layout catalog below.
- **Constraints**: Account for technical requirements, performance, accessibility, responsive behavior, and WordPress editability.

Execute the drawn pair with precision. Bold maximalism and refined minimalism can both work; the important thing is intentionality.

## Concept and Direction

Every site gets one signature concept and one artistic direction, both chosen before any code is written. The concept is the one structural idea a visitor remembers — a cover made of four tiles, a site laid out sideways, a page read like a newspaper — and it is about layout only: the shape of the page and how sections relate to the viewport. The direction is everything the concept leaves open — color, type, surfaces, shapes, how imagery is treated, how things move — and any direction must be able to dress any concept. A Swiss typographic Checkerboard and a Neo-brutalist Checkerboard share a grid and nothing else.

The two catalogs at the end of this runbook list every layout concept and every artistic direction by name and description; their build notes only come back from `pick_design` for the pairs it returns. You choose some, the code draws the rest, the user picks. The draw exists only for what the brief leaves open: the user's words always win over the catalog, on both sides. Work from the catalogs like this:

1. If the user's brief names a catalog concept or direction, pass that name as `layoutNamedInBrief` or `directionNamedInBrief` — exactly as it appears in the catalog — and that side is fixed across every pair. Never substitute a similar-sounding entry for the name the brief used.
2. If the brief specifies a layout or a look the catalog lacks — a style by name ("vaporwave", "like a 1950s diner"), a mood, a reference site, a full brand system — do not draw that side at all. Leave it out of the `pick_design` call, design it from the brief, and state it as `Concept: <the brief's words> — <how it is built>` or `Direction: <the brief's words> — <how it is built>`; the closest catalog entry's lines are a useful checklist of what to decide, not a substitute for what was asked. `pick_design` rejects an off-catalog name for exactly this reason: the answer to that error is to skip the draw and follow the brief, never to pass a nearby catalog name instead.
3. If the brief only constrains a side — "dark", "use our navy and gold", "lots of photos", "keep it minimal" — put the entries that cannot honor the constraint in `avoid` (a dark brief avoids the cream and paper directions) and adapt whatever is drawn to it: a brand palette replaces the drawn entry's colors while its type, surfaces, shapes, and motion stay.
4. When the user will pick (the `site-spec` skill says when), choose two pairs from the catalogs that you judge suit this site — one safe fit and one bold one you could execute well — each with a one-line reason, and pass them as `chosen`. Do not describe or defend them in prose. `pick_design` adds random pairs until there are four, all with distinct concepts and directions, and shuffles them.
5. Call `pick_design` once with every open side settled as above and `options` per the `site-spec` skill (4 for a pick, 1 otherwise). Build what was drawn or picked — do not call the tool again to get a different result, and do not substitute another entry. For a redesign that keeps its layout or its look, pass the kept side as named in the brief.
6. Adapt both to the site: change the subject, the proportions, or the content that fills each slot of the concept so it belongs to this brand rather than to the catalog, and tune the direction's palette and type to the brand while keeping its relationships. Name the twist for each. "Simple" or "small" in a brief means fewer pages and less content, not a tamer concept or direction.
7. State them in the Site Spec as `Concept: <catalog name> — <one-line adaptation>` and `Direction: <catalog name> — <one-line adaptation>`, using each entry's name verbatim so the user can find it, then the twist.
8. Follow the Concept line with a **Layout map**: one line per section of the page, in page order, saying what the concept does to that section — which slot of the layout it fills, how it is positioned relative to the viewport and its neighbors, what it must not fall back to. Every section gets a line, including the header, the footer, and any form; a section the concept does not shape must say so explicitly and justify why. The map is the plan the build follows, so write it before any code.
9. Build the concept first, in the hero or first template, not as a finishing touch, and follow the entry's build and fallback notes: theme CSS and a small vanilla script only, editable content, and a mobile layout. Put the direction's palette and type into `theme.json` before writing any pattern, and follow its Surface, Shapes, Imagery, Motion, and Avoid lines throughout — the direction is a system that every section obeys, not a coat of paint on the hero. Shape language still serves the concept: a direction's rounded corners go on inner elements (buttons, cards, form fields), never on a section, row, or grid cell that touches the viewport edge — anything full-bleed stays square-cornered so it still meets the edge.

## Sneak peeks

A sneak peek is a standalone HTML page that lets a concept and a direction be judged at a glance before anything is built. It is a taste of the look, not a page to reuse: never port it into the theme.

- **First screen only**: the header or masthead and the hero as the concept shapes them, and the top of the next section — enough for the concept's structural idea to read.
- **The direction, applied**: its Palette and Type lines drive every color and font; its Surface and Shapes lines show in the hero.
- **Real content**: the site's real name and plausible copy, never lorem ipsum. Where an image belongs, use the option's generated image if there is one, otherwise a solid color shape in a palette color.
- **Small and self-contained**: inline CSS, under ~120 lines, no scripts; a Google Fonts `<link>` with a fallback stack is fine. The first 1200×900 pixels are what gets rendered.

## Implementation Priorities

Build working code that is:

- Production-grade and functional.
- Visually striking and memorable.
- Cohesive, with a clear aesthetic point of view.
- Refined in typography, spacing, hierarchy, interaction states, and responsive behavior.

Focus on:

- **Typography**: Start from the drawn direction's Type line and choose fonts that suit it. Avoid defaulting to generic choices like Arial, Inter, Roboto, or system fonts unless restraint is clearly part of the brief. Pair display and body typography intentionally.
- **Color and theme**: Start from the drawn direction's Palette line, tune it to the brand, and define it once in the theme's `theme.json` (`settings.color.palette`), then drive every section, block, and CSS rule from those palette colors by slug. Use dominant colors and sharp accents deliberately instead of timid, evenly distributed colors. When redesigning or adding sections to a site that already has an active theme, inherit its existing palette rather than inventing new custom colors. When that active theme is an installed third-party theme, put palette overrides and all other design changes in a child theme (scaffold_theme with parentTheme), never in the installed theme's own files — editing its source is wiped by the next update, and if the theme compiles its assets (a `style.min.css` served in production, a `build/` or `dist/` step), the edit never reaches the rendered site at all. Treat the palette as the single source of truth — do not scatter hardcoded hex values across block markup or CSS; introduce a custom color only when the concept genuinely needs one the palette lacks, and add it to the palette first. See the `block-content` skill for how to reference palette colors.
- **Motion**: Use animation and transitions when they serve the concept. Prefer CSS where possible. A few well-orchestrated moments are better than scattered effects.
- **Spatial composition**: Use asymmetry, overlap, diagonal flow, grid-breaking elements, generous negative space, or controlled density when appropriate to the concept.
- **Content width**: Tune `settings.layout.contentSize` and `wideSize` in `theme.json` to the site type. The scaffold defaults (1000px / 1280px) suit marketing, landing, and business pages, which want 960–1200px content; narrow to 700–860px for editorial reading columns. Keep `wideSize` at 1200–1400px, above `contentSize`. Put columns, card grids, and galleries at `"align":"wide"` (see the `block-content` skill) so they use the wide width.
- **Backgrounds and visual details**: Add atmosphere and depth with contextual textures, patterns, shadows, borders, transparency, or custom visual treatments when they reinforce the direction.

## Avoid Generic Output

Avoid overused AI-generated aesthetics:

- Purple gradients on white backgrounds unless specifically appropriate.
- Predictable hero/card/feature-grid layouts with no concept.
- Generic font stacks when a more distinctive pairing would fit.
- Reusing the same visual formula across unrelated sites.

Interpret the user's brief creatively and make choices that feel specific to the site. Vary between light and dark themes, typography systems, layout structures, and visual styles across builds.

## Match Complexity To The Vision

Maximalist designs need enough layered detail, motion, and visual systems to feel intentional. Minimalist or refined designs need restraint, exact spacing, strong typography, and careful hierarchy. Do not confuse minimal with unfinished.

## Layout catalog

Every layout concept, by name and description. Choose from these; `pick_design` returns the build notes for the pairs it settles on.

{{layout-index}}

## Direction catalog

Every artistic direction, by name and description. Choose from these; `pick_design` returns the notes for the pairs it settles on.

{{direction-index}}
