---
name: frontend-design
description: "Use when generating any user-facing HTML, CSS, or WordPress markup. Enforces design excellence: purposeful layouts, sophisticated typography, meaningful whitespace, and visual hierarchy. Prevents generic 'AI-generated' aesthetics."
---

# Frontend Design Excellence

## When to use

Apply this skill to ALL visual output — landing pages, themes, patterns, single-page layouts, any HTML/CSS generation. This skill defines the quality bar.

## Related Skills

- **Load `wordpress-block-theming`** for WordPress FSE implementation details — theme.json, block templates, patterns, and the className pattern for connecting CSS animations to WordPress blocks.
- **Load `wp-interactivity-api`** when implementing scroll-triggered animations, dynamic state, or any JavaScript-driven interactivity in WordPress. It's the native way to add motion and behavior to block themes.

## Core Principles

### 1. No AI Slop

AI-generated designs share recognizable patterns that immediately signal "template." Avoid all of these:

- **Generic hero patterns**: Big heading + subtitle + two buttons centered on a gradient. Instead, design heroes that match the brand's personality — asymmetric layouts, bold typography treatments, unexpected compositions.
- **Emoji headings**: Never prefix section headings with emoji. Use typography, color, and spacing to create visual hierarchy.
- **Uniform card grids**: Three identical cards with icon + heading + paragraph is the hallmark of AI design. Vary card sizes, use asymmetric grids, feature one item prominently, or use entirely different layouts. If equal cards are genuinely needed (pricing tiers, feature comparison), vary the visual treatment — different background colors, featured/highlighted card, varied imagery.
- **Stock phrases**: "Elevate your experience," "Unlock the power of," "Transform your workflow." Write copy that is specific to the actual product/service.
- **Decorative filler sections**: Every section must earn its place. If it doesn't serve the user's goal, remove it.
- **Rainbow gradients and generic blobs**: Use intentional color that reinforces brand identity.

### 2. Visual Hierarchy

Every page needs a clear reading order:

- **One dominant element per viewport**: The eye needs a starting point. Usually the hero heading or a striking image.
- **Size contrast**: If everything is the same size, nothing stands out. Create drama with scale differences — a massive heading paired with small body text, a full-bleed image next to a narrow text column.
- **Whitespace is structure**: Generous spacing between sections creates rhythm. Tight spacing within groups creates unity. Use spacing intentionally, not uniformly.
- **Color as signal**: Reserve your accent/primary color for CTAs and key interactive elements. Using it everywhere dilutes its impact.

### 3. Typography as Design

Typography is the single most impactful design tool:

- **Choose distinctive fonts**: Skip Arial, Inter, Open Sans. Use fonts with character — Clash Display, Cabinet Grotesk, Instrument Serif, Space Grotesk, Fraunces, Playfair Display. Pair a distinctive display font with a refined body font.
- **Size with intention**: Body text at 1rem. Headings should create a clear scale. Hero headings can be large (clamp-based), but avoid sizes above 4rem — they rarely improve design.
- **Weight and style variation**: Use bold, italic, uppercase tracking, and font-weight differences to create typographic hierarchy without relying solely on size.
- **Line height matters**: Body text 1.5-1.65. Headings 1.1-1.3. Tight leading on large display text creates visual density and impact.

### 4. Color with Purpose

- **Start with a limited palette**: 2-3 colors maximum for most designs. Expand with tints/shades, not new hues.
- **Dark backgrounds create drama**: Don't default to white backgrounds. Dark sections with light text create visual weight and break up page monotony.
- **Contrast ratios**: Ensure text meets WCAG AA (4.5:1 for body text, 3:1 for large text). This is non-negotiable.
- **Background alternation**: Create visual rhythm by alternating section backgrounds — but make each transition feel intentional, not mechanical.

### 5. Layout Composition

- **Break the grid occasionally**: A mostly-constrained layout with one full-bleed element creates visual interest. Predictable grids feel static.
- **Asymmetry over symmetry**: Slightly off-center compositions feel more dynamic and designed. Centered layouts are safe but rarely exciting.
- **Edge-to-edge sections**: Major page sections should be full-width (`alignfull`) with constrained content inside. Narrow pages feel like documents, not designs.
- **Vary section density**: Alternate between dense, content-rich sections and spacious, breathing-room sections.

### 6. Motion and Interaction

- **Scroll-triggered reveals**: Sections fading up as the user scrolls is the single most impactful animation. For WordPress block themes, see the `wordpress-block-theming` skill for the CSS className pattern and `wp-interactivity-api` for advanced directive-driven animations.
- **Hover states on interactive elements**: Cards, buttons, and links should respond to hover with subtle transforms or shadow changes.
- **Staggered animations**: When revealing a group of elements (cards, features), stagger their entrance for a cascading effect.
- **Restraint**: Animate section entrances and interactive elements. Don't animate every heading and paragraph — visual noise degrades the experience.
- **Respect `prefers-reduced-motion`**: Always include the media query to disable animations for users who prefer it.

## Quality Checklist

Before considering any design complete:

- [ ] Does the hero section feel unique to this brand, not generic?
- [ ] Is there clear visual hierarchy — can you trace the reading order?
- [ ] Are fonts distinctive and well-paired?
- [ ] Does the color palette feel intentional and limited?
- [ ] Is there rhythm in section backgrounds and spacing?
- [ ] Do interactive elements have hover/focus states?
- [ ] Are scroll animations present but restrained?
- [ ] Is the design accessible (contrast, focus states, reduced-motion)?
- [ ] Could you tell this was hand-designed, not AI-generated?
