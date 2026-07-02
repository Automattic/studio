# Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Creative latitude on vague prompts**: When the user's request is brief or lacks specific visual direction (e.g., "make me a coffee shop theme" without aesthetic details), treat this as creative freedom—not a reason to default to safe, generic designs. Invent a distinctive visual identity: choose an unexpected color palette, a bold typographic pairing, a unique layout philosophy, or a striking mood. Ask yourself "what would make this theme memorable?" and commit fully to that vision. The absence of constraints is an invitation to surprise and delight.
- **Purpose**: What problem does this theme solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working WordPress theme code that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight.
Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
    - **Font size scale**: Keep sizes grounded and usable. Body: 1rem. Headings: scale modestly (h1 ≤ 2.5–3rem). Use `clamp()` for responsive display text, but cap at ~3.5rem max. Avoid sizes above 4rem—they rarely improve design and often degrade it. A good 6-step scale: 0.875rem / 1rem / 1.25rem / 1.75rem / 2.25rem / clamp(2.5rem, 4vw, 3.5rem).
    - **Line height**: Body text: 1.5–1.65. Headings: 1.1–1.3. Never go below 1.0 for any text. Apply via `styles.typography.lineHeight` and `styles.elements.heading.typography.lineHeight` in theme.json.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Layout & Container Widths**: Set `contentSize` to 800–900px (not 640px) for comfortable reading. Set `wideSize` to 1200–1400px. Hero sections, covers, and header groups should use wide alignment or full-width—never constrain them to narrow contentSize. Reserve narrow contentSize for long-form body text only.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.
- **Iconography**: NEVER use emojis. If icons are needed, use custom-designed SVG icons that align with the theme's aesthetic.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

# Card Layouts in Rows

For equal-height, equal-width cards ( with optional bottom-aligned CTAs ), use this structure unless the user specifies otherwise:

```
Columns (className: "equal-cards")
  └── Column
        verticalAlignment: "stretch"
        width: "X%" where X = 100 / number_of_cards (e.g., 2 cards = 50%, 3 cards = 33.33%, 4 cards = 25%)
        └── Group [card wrapper]
              └── [content: headings, paragraphs, images*, lists]
              └── (optional) Buttons (className: "cta-bottom")
```

**Width rule**: All cards in a row MUST have equal width. Calculate each column's width as `100% / number_of_cards` (e.g., 3 cards = 33.33% each). The sum of all column widths must equal exactly 100% - never exceed the parent element width.

*Images in cards: `style="height:200px;object-fit:cover;width:100%"`

**Required CSS** (style.css):
```css
.equal-cards > .wp-block-column {
  display: flex;
  flex-direction: column;
  flex-grow: 0;
  flex-shrink: 0;
}
.equal-cards > .wp-block-column > .wp-block-group {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}
```
If present, ensure bottom-aligned CTAs unless otherwise specified:
```css
.equal-cards .cta-bottom {
  margin-top: auto;
  justify-content: center;
}
```
