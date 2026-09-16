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
- **Artistic direction**: the feeling of the site — palette, type, surfaces, shapes, imagery, and motion — settled with `pick_design` from the direction catalog below and written down as the site's `DESIGN.md` (see "Concept and Direction").
- **Signature concept**: the spatial structure that makes the site memorable, settled with `pick_design` from the layout catalog below.
- **Constraints**: Account for technical requirements, performance, accessibility, responsive behavior, and WordPress editability.

Execute the settled direction and concept with precision. Bold maximalism and refined minimalism can both work; the important thing is intentionality.

## Concept and Direction

Every site gets one artistic direction and one signature concept, both chosen before any code is written: the direction first, because it becomes the site's `DESIGN.md`, then the concept, chosen to suit it. The concept is the one structural idea a visitor remembers — a cover made of four tiles, a site laid out sideways, a page read like a newspaper — and it is about layout only: the shape of the page and how sections relate to the viewport. The direction is everything the concept leaves open — color, type, surfaces, shapes, how imagery is treated, how things move — and any direction must be able to dress any concept. A Swiss typographic Checkerboard and a Neo-brutalist Checkerboard share a grid and nothing else.

The two catalogs at the end of this runbook list every layout concept and every artistic direction by name and description; their notes only come back from `pick_design` for the entries it settles. The user's words always win over the catalog, on both sides:

1. A catalog entry the brief names is built as named — never a similar-sounding one.
2. If the brief specifies a layout or a look the catalog lacks — a style by name ("vaporwave", "like a 1950s diner"), a mood, a full brand system — do not settle that side from the catalog at all. Skip that catalog's `pick_design` call and design it from the brief; the closest catalog entry's lines are a useful checklist of what to decide, not a substitute for what was asked. `pick_design` rejects an off-catalog name for exactly this reason: the answer to that error is to follow the brief, never to pass a nearby catalog name instead.
3. If the brief only constrains a side — "dark", "use our navy and gold", "lots of photos", "keep it minimal" — choose entries that can honor it and adapt whatever is settled to it: a brand palette replaces the entry's colors while its type, surfaces, shapes, and motion stay.
4. A reference site gives its feel — palette, type, surfaces, density, how the page is laid out — never its text, images, or logo: choose the closest entries and adapt them toward it.
5. When choosing for the user to pick from, choose four directions that suit this site and differ from one another, from a safe fit to bold ones you could execute well. Unless the brief constrains it, the four must not share a ground — at least one on white or a cool light tone, at least one dark, at most one warm cream — and must span both serif and sans headlines and both quiet and saturated palettes; for the layout, choose two that suit the picked look, one safe and one bold, and the code adds two at random. Give each a one-line reason, and do not describe or defend them in prose: the user decides.
6. Build what was settled or picked — never a substitute. In a redesign, a side the user keeps counts as named in the brief.
7. Adapt both to the site: change the subject, the proportions, or the content that fills each slot of the concept so it belongs to this brand rather than to the catalog, and tune the direction's palette and type to the brand while keeping its relationships. Name the twist for each. "Simple" or "small" in a brief means fewer pages and less content, not a tamer concept or direction.
8. A **layout map** is the plan the build follows, written before any code: one line per section of the page, in page order, saying what the concept does to that section — which slot of the layout it fills, how it is positioned relative to the viewport and its neighbors, what it must not fall back to. Every section gets a line, including the header, the footer, and any form; a section the concept does not shape must say so explicitly and justify why.
9. Build the concept first, in the hero or first template, not as a finishing touch, and follow the entry's build and fallback notes: theme CSS and a small vanilla script only, editable content, and a mobile layout. Put `DESIGN.md`'s colors, typography, spacing, and radii into `theme.json` before writing any pattern, and follow its sections throughout — the look is a system that every section obeys, not a coat of paint on the hero. Shape language still serves the concept: a direction's rounded corners go on inner elements (buttons, cards, form fields), never on a section, row, or grid cell that touches the viewport edge — anything full-bleed stays square-cornered so it still meets the edge.

## DESIGN.md

The look is written down once, as `DESIGN.md` at the site root, in the DESIGN.md format: YAML front matter with the design tokens, then Markdown sections that explain how to use them. Every later change to the site reads it, so it must stand on its own.

- **Front matter**: `name` (the site's name), `description` (its tagline), `colors` (quoted hex values, each color once: `primary`, `background`, `text`, and any accents), `typography` (named styles such as `display`, `headline`, `body`, and `label`, each with a Google Fonts `fontFamily`, a `fontSize` in px or rem, `fontWeight`, `lineHeight`, and `letterSpacing` where it matters), `rounded` and `spacing` (named scales, such as `sm: 4px`), `components` (at least `button-primary` with `backgroundColor`, `textColor`, `rounded`, and `padding`), and `imagery` (the direction's photo treatment as CSS: `filter`, the value from its Imagery line, left out when it names none, and `overlay`, `multiply` or `screen`, only for a duotone, where a layer of `primary` sits over the photo). Component values can reference tokens, as in `"{colors.primary}"`.
- **Sections**, in this order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts, Imagery, Motion, Voice. They carry the direction's lines, tuned to the brand: Palette into Colors, Type into Typography, Surface into Elevation & Depth, Avoid into Do's and Don'ts, and Shapes, Imagery, and Motion into their own. Until the layout is picked, Layout holds only the content widths and spacing rhythm, and no section describes the page's structure — no grids, bands, or concept names; the layout step then adds the signature concept and how every page follows it. Voice is how the copy talks: its tone, and the words to use and to avoid.
- **A draft**, for a design option, is the front matter and the Overview. It is rendered as a design-system board — the `display` and `body` type with the scale, the colors as a grid led by `primary`, the components, and the look image under the option's `imagery` treatment, framed in its `rounded` shape — so the user judges exactly the tokens. The picked draft becomes the file: tokens unchanged, every section written.
- **Keep it true**: `theme.json` follows its tokens under the same names — the `primary` color is the `primary` palette slug — and a later change to the look updates `DESIGN.md` in the same turn.

## Sneak peeks

A sneak peek is a standalone HTML page that lets a layout concept be judged in the picked look, at a glance, before anything is built. It is a taste of the layout, not a page to reuse: never port it into the theme.

- **A full frame**: the header or masthead and the hero as the concept shapes them, then the next section. The frame is 1200×900 and the page must reach its bottom edge, so make `body` a `min-height: 100vh` flex column and give the last section `flex: 1` and a background — nothing ends inside the frame, whatever the copy length. Grids need enough rows to pass 900px: four square columns of 300px need three rows.
- **The look, exactly**: `DESIGN.md`'s colors and fonts drive every color and font, and its surfaces and shapes show in the hero, so only the layout differs between options.
- **Real content**: the site's real name and plausible copy, never lorem ipsum. Image slots take the site's image set (see the `imagery` skill), a different image per slot with the first-screen scene in the dominant one, never the same image twice in a frame, each under `DESIGN.md`'s `imagery` treatment; a slot the set cannot fill takes a solid color shape in a palette color.
- **Small and self-contained**: inline CSS, under ~120 lines, no scripts; a Google Fonts `<link>` with a fallback stack is fine.

## Implementation Priorities

Build working code that is:

- Production-grade and functional.
- Visually striking and memorable.
- Cohesive, with a clear aesthetic point of view.
- Refined in typography, spacing, hierarchy, interaction states, and responsive behavior.

Focus on:

- **Typography**: Choose the `DESIGN.md` fonts from the direction's Type line. Avoid defaulting to generic choices like Arial, Inter, Roboto, or system fonts unless restraint is clearly part of the brief. Pair display and body typography intentionally.
- **Color and theme**: Start from `DESIGN.md`'s colors and define them once in the theme's `theme.json` (`settings.color.palette`), then drive every section, block, and CSS rule from those palette colors by slug. Use dominant colors and sharp accents deliberately instead of timid, evenly distributed colors. When redesigning or adding sections to a site that already has an active theme, inherit its existing palette rather than inventing new custom colors. When that active theme is an installed third-party theme, put palette overrides and all other design changes in a child theme (scaffold_theme with parentTheme), never in the installed theme's own files — editing its source is wiped by the next update, and if the theme compiles its assets (a `style.min.css` served in production, a `build/` or `dist/` step), the edit never reaches the rendered site at all. Treat the palette as the single source of truth — do not scatter hardcoded hex values across block markup or CSS; introduce a custom color only when the concept genuinely needs one the palette lacks, and add it to the palette first. See the `block-content` skill for how to reference palette colors.
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

Every layout concept, by name and description. Choose from these; `pick_design` returns the build notes for the entries it settles on.

{{layout-index}}

## Direction catalog

Every artistic direction, by name and description. Choose from these; `pick_design` returns the notes for the entries it settles on.

{{direction-index}}
