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
- **Color and theme**: Commit to a palette. Use dominant colors and sharp accents deliberately instead of timid, evenly distributed colors.
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

Before writing files or block markup, state a compact internal direction in your own words, then implement in small increments and verify visually.

## Verifying Layout From Screenshots

When you screenshot to check your work, the screenshot is a measurement instrument — know its limits or you will chase bugs that do not exist.

- **A full-page screenshot of a long page is downscaled to fit, so fine detail blurs.** Do NOT count columns, cards, or grid items, or judge spacing and alignment, from a full-page shot. When you need that detail, capture a single viewport-height slice (paging down the page) instead, or measure the rendered DOM directly.
- **When something looks wrong, confirm it is real before editing.** A "missing card" or "only 2 columns" in a blurry full-page shot is more often a downscaling artifact than a CSS bug. Verify with a viewport-height capture, or by reading the element's rendered geometry and computed styles (e.g. the grid container's computed `grid-template-columns`), first. If the markup and computed styles are correct, the layout is correct — stop, and do not edit CSS to make a downscaled screenshot look different.
- **Stop after two failed fixes of the same symptom.** If the same issue survives two attempts, your model of the problem is wrong. Change instrument (viewport-height capture, computed-style measurement, read the rendered HTML) to find the true cause, or tell the user what you are seeing and ask — do not keep editing the same CSS in a loop.
- **Never trade real-browser correctness for a better screenshot.** Clean, semantic layout (e.g. a fixed `grid-template-columns: repeat(3, 1fr)`) that renders correctly in a browser must not be degraded into something worse just to change how a downscaled capture looks.

**In Studio:** capture the viewport-height slice with `take_screenshot` (`fullPage: false`, paging with `offset`); read rendered geometry and computed styles with `measure_elements`.
