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
- **Tone**: Pick a specific direction, such as brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, or another direction that fits the user's brief.
- **Constraints**: Account for technical requirements, performance, accessibility, responsive behavior, and WordPress editability.
- **Signature concept**: Pick one layout concept from the shortlist below (see "Signature Concept") — the spatial structure that makes the site memorable.

Choose a conceptual direction and execute it with precision. Bold maximalism and refined minimalism can both work; the important thing is intentionality.

## Signature Concept

A direction sets the tone; a signature concept is the one structural idea a visitor remembers — a cover made of four tiles, a site laid out sideways, sections scattered on a canvas you pan around. The concept is about layout only: the shape of the page and how sections relate to the viewport. Color, typography, and motion are decided in the direction and serve the concept. Every site gets exactly one, chosen before any code is written and built into the hero or first template.

The shortlist at the end of this runbook is a random sample from a small catalog, and it changes on every load. Work from it like this:

1. Read every entry on the shortlist as a candidate. Any of them can work for any site; do not default to the first entry, the most familiar one, or the flashiest one.
2. Pick one and adapt it to the site: change the subject, the proportions, or the content that fills each slot so it belongs to this brand rather than to the catalog. Name the twist.
3. Pick from the shortlist. Inventing a concept is the exception, allowed only when the user's brief names a layout of its own; an invented concept must be at least as ambitious as the shortlisted ones and described in the same shape (what it is, how it is built, how it degrades). "Simple" or "small" in a brief means fewer pages and less content, not a tamer concept.
4. Choose the boldest entry you can execute well — the one a visitor would describe to a friend — not the safest. The quietest option is for explicitly minimal briefs only, and even then pick one rather than skipping the concept.
5. State it in the Site Spec as `Concept: <catalog name> — <one-line adaptation>`, using the entry's name verbatim so the user can find it, then the twist.
6. Build the concept first, in the hero or first template, not as a finishing touch, and follow the entry's build and fallback notes: theme CSS and a small vanilla script only, editable content, and a mobile layout. Color, typography, and motion should serve the concept, not compete with it.

## Implementation Priorities

Build working code that is:

- Production-grade and functional.
- Visually striking and memorable.
- Cohesive, with a clear aesthetic point of view.
- Refined in typography, spacing, hierarchy, interaction states, and responsive behavior.

Focus on:

- **Typography**: Choose fonts that suit the concept. Avoid defaulting to generic choices like Arial, Inter, Roboto, or system fonts unless restraint is clearly part of the brief. Pair display and body typography intentionally.
- **Color and theme**: Commit to a palette and define it once in the theme's `theme.json` (`settings.color.palette`), then drive every section, block, and CSS rule from those palette colors by slug. Use dominant colors and sharp accents deliberately instead of timid, evenly distributed colors. When redesigning or adding sections to a site that already has an active theme, inherit its existing palette rather than inventing new custom colors. When that active theme is an installed third-party theme, put palette overrides and all other design changes in a child theme (scaffold_theme with parentTheme), never in the installed theme's own files — editing its source is wiped by the next update, and if the theme compiles its assets (a `style.min.css` served in production, a `build/` or `dist/` step), the edit never reaches the rendered site at all. Treat the palette as the single source of truth — do not scatter hardcoded hex values across block markup or CSS; introduce a custom color only when the concept genuinely needs one the palette lacks, and add it to the palette first. See the `block-content` skill for how to reference palette colors.
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

## Concept Shortlist

A random sample for this build. Pick one and adapt it per "Signature Concept" above.

{{concept-shortlist}}
