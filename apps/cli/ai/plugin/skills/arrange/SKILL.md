---
name: arrange
description: Fix spacing consistency, visual hierarchy, and layout rhythm. Use when the layout feels off, crowded, monotonous, or lacks visual structure.
user-invokable: true
argument-hint: "[target]"
---

Assess and improve layout and spacing that feels monotonous, crowded, or structurally weak — turning generic arrangements into intentional, rhythmic compositions.

## MANDATORY PREPARATION

If no design context exists yet (no `.impeccable.md` in the site root), you MUST run `/design-setup` first. Use `site_info` to get the site path and check for `{site_path}/.impeccable.md`.

---

## Assess Current Layout

Take a screenshot with `take_screenshot`, then analyze the active theme's `theme.json` and `style.css`:

1. **Spacing**:
   - Is spacing consistent or arbitrary? (Random padding/margin values)
   - Is all spacing the same? (Equal padding everywhere = no rhythm)
   - Are related elements grouped tightly, with generous space between groups?

2. **Visual hierarchy**:
   - Apply the squint test: blur your (metaphorical) eyes — can you still identify the most important element, second most important, and clear groupings?
   - Does whitespace guide the eye to what matters?

3. **Grid & structure**:
   - Is there a clear underlying structure, or does the layout feel random?
   - Are identical card grids used everywhere? (Icon + heading + text, repeated endlessly)
   - Is everything centered? (Left-aligned with asymmetric layouts often feels more designed)

4. **Rhythm & variety**:
   - Does the layout have visual rhythm? (Alternating tight/generous spacing)
   - Is every section structured the same way? (Monotonous repetition)
   - Are there intentional moments of surprise or emphasis?

5. **Density**:
   - Is the layout too cramped? (Not enough breathing room)
   - Is the layout too sparse? (Excessive whitespace without purpose)
   - Does density match the content type? (Content-rich pages need tighter spacing; landing pages need more air)

**CRITICAL**: Layout problems are often the root cause of interfaces feeling "off" even when colors and fonts are fine. Space is a design material — use it with intention.

## Plan Layout Improvements

Create a systematic plan:

- **Spacing system**: Use a consistent scale — whether that's WordPress's built-in spacing scale in `theme.json`, rem-based tokens, or CSS custom properties. Consistency matters more than specific values.
- **Hierarchy strategy**: How will space communicate importance?
- **Layout approach**: What structure fits the content? Flex for 1D, Grid for 2D, named areas for complex page layouts.
- **Rhythm**: Where should spacing be tight vs generous?

## Improve Layout Systematically

### Establish a Spacing System

In WordPress block themes, set spacing in `theme.json` → `settings.spacing.spacingSizes`:
- Use semantic names: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`
- Use `gap` for sibling spacing instead of margins
- Apply `clamp()` for fluid spacing that breathes on larger screens

### Create Visual Rhythm

- **Tight grouping** for related elements (8-12px between siblings)
- **Generous separation** between distinct sections (48-96px)
- **Varied spacing** within sections — not every row needs the same gap
- **Asymmetric compositions** — break the predictable centered-content pattern when it makes sense

### Choose the Right Layout Tool

- **Use Flexbox for 1D layouts**: Rows of items, nav bars, button groups, card contents, most component internals
- **Use Grid for 2D layouts**: Page-level structure, content grids, anything where rows AND columns need coordinated control
- **Don't default to Grid** when Flexbox with `flex-wrap` would be simpler
- Use `repeat(auto-fit, minmax(280px, 1fr))` for responsive grids without breakpoints

### Break Card Grid Monotony

- Don't default to card grids for everything — spacing and alignment create visual grouping naturally
- Use cards only when content is truly distinct and actionable — never nest cards inside cards
- Vary card sizes, span columns, or mix cards with non-card content to break repetition

### Strengthen Visual Hierarchy

- Use the fewest dimensions needed for clear hierarchy — space alone can be enough
- Create clear content groupings through proximity and separation
- Be aware of reading flow — in LTR languages, the eye naturally scans top-left to bottom-right

**NEVER**:
- Use arbitrary spacing values outside your scale
- Make all spacing equal — variety creates hierarchy
- Wrap everything in cards — not everything needs a container
- Nest cards inside cards — use spacing and dividers for hierarchy within
- Use identical card grids everywhere (icon + heading + text, repeated)
- Default to CSS Grid when Flexbox would be simpler

## Verify Layout Improvements

Take a screenshot after changes and check:

- **Squint test**: Can you identify primary, secondary, and groupings with blurred vision?
- **Rhythm**: Does the page have a satisfying beat of tight and generous spacing?
- **Hierarchy**: Is the most important content obvious within 2 seconds?
- **Breathing room**: Does the layout feel comfortable, not cramped or wasteful?
- **Consistency**: Is the spacing system applied uniformly?
- **Responsiveness**: Does the layout adapt gracefully across screen sizes?

Remember: Space is the most underused design tool. A layout with the right rhythm and hierarchy can make even simple content feel polished and intentional.

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
