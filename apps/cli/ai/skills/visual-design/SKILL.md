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
- **Differentiation**: Decide what should make the site memorable.

Choose a conceptual direction and execute it with precision. Bold maximalism and refined minimalism can both work; the important thing is intentionality.

## Implementation Priorities

Build working code that is:

- Production-grade and functional.
- Visually striking and memorable.
- Cohesive, with a clear aesthetic point of view.
- Refined in typography, spacing, hierarchy, interaction states, and responsive behavior.

Focus on:

- **Typography**: Choose fonts that suit the concept. Avoid defaulting to generic choices like Arial, Inter, Roboto, or system fonts unless restraint is clearly part of the brief. Pair display and body typography intentionally.
- **Color and theme**: Commit to a palette and define it once in the theme's `theme.json` (`settings.color.palette`), then drive every section, block, and CSS rule from those palette colors by slug. Use dominant colors and sharp accents deliberately instead of timid, evenly distributed colors. When redesigning or adding sections to a site that already has an active theme, inherit its existing palette rather than inventing new custom colors. Treat the palette as the single source of truth — do not scatter hardcoded hex values across block markup or CSS; introduce a custom color only when the concept genuinely needs one the palette lacks, and add it to the palette first. See the `block-content` skill for how to reference palette colors.
- **Motion**: Use animation and transitions when they serve the concept. Prefer CSS where possible. A few well-orchestrated moments are better than scattered effects.
- **Spatial composition**: Use asymmetry, overlap, diagonal flow, grid-breaking elements, generous negative space, or controlled density when appropriate to the concept.
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
