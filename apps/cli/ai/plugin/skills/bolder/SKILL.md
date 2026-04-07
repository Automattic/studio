---
name: bolder
description: Amplify safe or boring designs with more personality and visual impact. Use when the site looks bland, generic, or lacks character.
user-invokable: true
argument-hint: "[target]"
---

Increase visual impact and personality in designs that are too safe, generic, or visually underwhelming — creating more engaging and memorable WordPress sites.

## MANDATORY PREPARATION

If no design context exists yet (no `.impeccable.md` in the site root), you MUST run `/design-setup` first. Use `site_info` to get the site path and check for `{site_path}/.impeccable.md`.

---

## Assess Current State

Take a screenshot with `take_screenshot`, then analyze the active theme:

1. **Identify weakness sources**:
   - **Generic choices**: System fonts, basic colors, standard layouts
   - **Timid scale**: Everything is medium-sized with no drama
   - **Low contrast**: Everything has similar visual weight
   - **Static**: No motion, no energy, no life
   - **Predictable**: Standard WordPress patterns with no surprises
   - **Flat hierarchy**: Nothing stands out or commands attention

2. **Understand the context**:
   - What's the brand personality? (How far can we push?)
   - What's the purpose? (Landing pages can be bolder than member dashboards)
   - Who's the audience? (What will resonate?)
   - What are the constraints? (Brand guidelines, accessibility)

If any of these are unclear, STOP and call the AskUserQuestion tool to clarify.

**CRITICAL**: "Bolder" doesn't mean chaotic or garish. It means distinctive, memorable, and confident. Think intentional drama, not random chaos.

**WARNING - AI SLOP TRAP**: When making things "bolder," AI defaults to the same tired tricks: cyan/purple gradients, glassmorphism, neon accents on dark backgrounds, gradient text on metrics. These are the OPPOSITE of bold — they're generic. Bold means distinctive, not "more effects."

## Plan Amplification

Create a strategy to increase impact while maintaining coherence:

- **Focal point**: What should be the hero moment? (Pick ONE, make it amazing)
- **Personality direction**: Maximalist chaos? Elegant drama? Playful energy? Dark moody? Choose a lane.
- **Risk budget**: How experimental can we be? Push boundaries within constraints.
- **Hierarchy amplification**: Make big things BIGGER, small things smaller (increase contrast)

**IMPORTANT**: Bold design must still be usable. Impact without function is just decoration.

## Amplify the Design

In WordPress, changes go in `theme.json` (design tokens) and `style.css` (CSS). For block themes, leverage `theme.json` color palettes, font sizes, and spacing scales.

### Typography Amplification
- **Replace generic fonts**: Swap system fonts for distinctive choices via `theme.json` → `settings.typography.fontFamilies`
- **Extreme scale**: Create dramatic size jumps (3x-5x differences, not 1.5x)
- **Weight contrast**: Pair 900 weights with 200 weights, not 600 with 400
- **Unexpected choices**: Variable fonts, display fonts for headlines, condensed/extended widths

### Color Intensification
- **Increase saturation**: Shift to more vibrant, energetic colors (but not neon) — update `theme.json` color palette
- **Bold palette**: Introduce unexpected color combinations — avoid the purple-blue gradient AI slop
- **Dominant color strategy**: Let one bold color own 60% of the design
- **Sharp accents**: High-contrast accent colors that pop
- **Rich gradients**: Intentional multi-stop gradients (not generic purple-to-blue)

### Spatial Drama
- **Extreme scale jumps**: Make important elements 3-5x larger than surroundings
- **Break the grid**: Let hero elements escape containers and cross boundaries
- **Asymmetric layouts**: Replace centered, balanced layouts with tension-filled asymmetry
- **Generous space**: Use white space dramatically (100-200px gaps, not 20-40px)
- **Overlap**: Layer elements intentionally for depth

### Visual Effects
- **Dramatic shadows**: Large, soft shadows for elevation (not generic drop shadows on rounded rectangles)
- **Background treatments**: Mesh patterns, noise textures, geometric patterns, intentional gradients
- **Texture & depth**: Grain, halftone, duotone — NOT glassmorphism (it's overused AI slop)
- **Borders & frames**: Thick borders, decorative frames, custom shapes
- **Custom elements**: Illustrative elements, custom icons, decorative details that reinforce brand

### Motion & Animation
- **Entrance choreography**: Staggered, dramatic page load animations
- **Scroll effects**: Parallax, reveal animations
- **Micro-interactions**: Satisfying hover effects, click feedback
- **Transitions**: Smooth, noticeable transitions using ease-out-quart/quint/expo (not bounce or elastic)

### Composition Boldness
- **Hero moments**: Create clear focal points with dramatic treatment
- **Full-bleed elements**: Use full viewport width/height for impact
- **Unexpected proportions**: Try 70/30, 80/20 splits

**NEVER**:
- Add effects randomly without purpose (chaos ≠ bold)
- Sacrifice readability for aesthetics (body text must be readable)
- Make everything bold (then nothing is bold — need contrast)
- Ignore accessibility (bold design must still meet WCAG standards)
- Overwhelm with motion (animation fatigue is real)
- Copy trendy aesthetics blindly (bold means distinctive, not derivative)

## Verify Quality

Take a screenshot after changes and check:

- **NOT AI slop**: Does this look like every other AI-generated "bold" design? If yes, start over.
- **Still functional**: Can users accomplish tasks without distraction?
- **Coherent**: Does everything feel intentional and unified?
- **Memorable**: Will users remember this experience?
- **Accessible**: Does it still meet accessibility standards?

**The test**: If you showed this to someone and said "AI made this bolder," would they believe you immediately? If yes, you've failed. Bold means distinctive, not "more AI effects."

Remember: Bold design is confident design. It takes risks, makes statements, and creates memorable experiences. But bold without strategy is just loud. Be intentional, be dramatic, be unforgettable.

## WordPress Studio Context

You are operating within WordPress Studio. Before making any changes:

1. Use `site_info` to find the active site's path
2. Find the active theme: `wp_cli theme list --status=active --format=json`
3. Editable design files live at `{site_path}/wp-content/themes/{active-theme}/`:
   - `style.css` — main stylesheet
   - `theme.json` — design tokens (colors, typography, spacing)
   - Custom block styles and templates
4. After making changes, call `take_screenshot` to verify visually
5. Never modify WordPress core files — only theme directory files

The `.impeccable.md` design context file lives at `{site_path}/.impeccable.md`.
