---
name: taste
description: High-agency design direction for WordPress block themes. Enforces bold aesthetic commitment, anti-slop rules, and Studio-specific constraints (block-only content, style.css, progressive-enhancement animations). Load this before planning or generating any design work.
user-invokable: true
---

# Taste — WordPress Block Theme Design Skill

Adapted from [taste-skill](https://github.com/Leonxlnx/taste-skill) for WordPress Studio. The aesthetic philosophy and anti-slop rules are preserved; the technical directives are rewritten for block themes (core blocks, `style.css`, progressive-enhancement JS) instead of React/Tailwind/Framer Motion.

## 1. ACTIVE BASELINE CONFIGURATION

- **DESIGN_VARIANCE**: 7 (1=Perfect Symmetry, 10=Artsy Chaos)
- **MOTION_INTENSITY**: 6 (1=Static, 10=Cinematic scroll-telling)
- **VISUAL_DENSITY**: 4 (1=Art Gallery/Airy, 10=Packed Data)

**Instruction:** These are the default dials for any new site. Adapt them dynamically when the user expresses a direction ("make it quieter" → lower MOTION_INTENSITY and DESIGN_VARIANCE; "I want a dense dashboard feel" → raise VISUAL_DENSITY). Use these values as global parameters driving Sections 3-6.

If the site-spec skill captured an explicit aesthetic direction (minimalist, soft, editorial, brutalist, maximalist), let that override the defaults:

- **minimalist** → VARIANCE 3, MOTION 4, DENSITY 3
- **soft** → VARIANCE 4, MOTION 6, DENSITY 3
- **editorial** → VARIANCE 6, MOTION 6, DENSITY 5
- **brutalist** → VARIANCE 9, MOTION 7, DENSITY 6
- **maximalist** → VARIANCE 9, MOTION 9, DENSITY 7

**MOTION floor = 4.** Every site gets at least a page-load fade cascade and scroll reveals on key sections. MOTION 1-3 is only used when the user explicitly requests a static or accessibility-minimal site.

## 1b. CROSS-GENERATION VARIANCE (READ FIRST)

Every site you build must feel meaningfully different from the last. Convergence on a single "safe" template across generations is the single biggest failure mode of AI design, and it is the primary reason this skill exists. Before settling on any choice, check whether it was used recently and pick something else if so.

Vary deliberately across:

- **Aesthetic direction** — if the user didn't specify one and the last site was minimalist, pick something else this time. Don't default to the same mood twice.
- **Light vs. dark** — alternate. If the last site was a light cream theme, this one should lean dark (graphite, ink, midnight) or vice versa. Don't converge on light-by-default.
- **Display font** — never reach for Space Grotesk, Inter, or any single font reflexively. Rotate across the preferred lists in Section 3 Rule 1. If the last site used Cabinet Grotesk, pick Fraunces, Editorial New, Clash Display, Satoshi, etc.
- **Palette temperature** — alternate warm (cream, stone, brass, rose) and cool (graphite, slate, electric blue, forest) across generations.
- **Hero paradigm** — see Section 8. Never pick the same paradigm back to back. Specifically: do not default to the asymmetric split hero.
- **Layout signature** — zig-zag, bento, masonry, horizontal scroll, sticky stack, numbered list — rotate through these instead of converging.
- **Implementation complexity** — match the aesthetic: maximalist needs elaborate motion and layering; minimalist needs restraint and precision; editorial needs typographic confidence over visual effects. Both ends require intentionality; the failure is timid middle-ground output.

**Commit boldly.** Timid, generic output is a failure of this skill. If you find yourself reaching for the safe choice, pick the second-safest one instead.

**Always use sophisticated scroll effects and page-load animations unless the user explicitly asks for a static site.** MOTION_INTENSITY floor is 4 — even the minimalist preset gets a page-load cascade and scroll reveals. Static (1-3) is opt-in only.

## 2. STUDIO ARCHITECTURE & HARD CONSTRAINTS

These are non-negotiable Studio/WordPress rules. Design decisions must work within them.

- **Block themes only.** Never generate classic themes. All pages are assembled from core WordPress blocks.
- **Core blocks only for structure and content.** `core/html` blocks are reserved for: inline SVGs, `<form>` elements and interactive inputs, animation/interaction markup with no block equivalent (marquee, cursor effects), and a single `<script>` block at the bottom of the page. Never use `core/html` to wrap text, headings, layout sections, or lists.
- **All styling goes in the theme's `style.css`.** No inline `style` attributes. No `style` block attributes. No custom stylesheets. Target blocks via the `className` attribute set on the outermost wrapper.
- **Register `style.css` as editor styles** in the theme's `functions.php` so the block editor matches the frontend.
- **Progressive-enhancement animations.** CSS must define elements in their **final visible state** (full opacity, final position). Frontend JS adds the initial hidden state and scroll-triggered transitions. This guarantees elements render correctly in the block editor, which loads theme CSS but not custom JS.
- **Respect `prefers-reduced-motion`.** Every animation or transition must be disabled or simplified inside `@media (prefers-reduced-motion: reduce) { … }`.
- **Validate blocks after every write.** Invalid blocks break the editor; always run the validator and fix any reported issues.
- **No emojis** anywhere in generated content.
- **No decorative HTML comments** (e.g. `<!-- Hero Section -->`). Only block delimiter comments are allowed.

## 3. DESIGN ENGINEERING DIRECTIVES (Bias Correction)

LLMs have statistical biases toward specific UI clichés. Proactively construct premium interfaces using these engineered rules:

**Rule 1: Deterministic Typography**

- Pair a distinctive display font with a refined body font. Load both via Google Fonts (`@import` in `style.css` or enqueued properly in `functions.php`).
- **ANTI-SLOP BANNED FONTS**: Inter, Roboto, Arial, Open Sans, Lato, system-ui default stacks. These are AI fallbacks.
- **Preferred display fonts**: Fraunces, Cabinet Grotesk, Satoshi, Outfit, Geist, Instrument Serif, Tobi, Clash Display, Cormorant, Editorial New.
- **Preferred body fonts**: Geist, Satoshi, Outfit, Source Serif Pro, Inter Display (distinct from Inter). Keep body line-height around 1.5-1.7, max line length 65ch.
- **Display/Headlines**: Tight letter-spacing (`letter-spacing: -0.02em`), tight line-height (`line-height: 1` to `1.1`), scale of `clamp(2.5rem, 6vw, 5rem)` or larger for hero h1.
- **NEVER converge on the same font across generations** (stop reaching for Space Grotesk by default).

**Rule 2: Color Calibration**

- **Max 1 accent color.** Saturation < 80% unless the aesthetic is explicitly maximalist.
- **THE LILA BAN**: The "AI Purple/Blue gradient" aesthetic is BANNED. No purple-to-blue button glows, no default neon gradients.
- **No pure black (`#000000`) or pure white (`#ffffff`)** for large surfaces. Use off-black (`#0a0a0a`, `#14110f`) and off-white (`#faf8f5`, `#f5f2ec`). Tinted neutrals communicate intentionality.
- **Commit to one palette for the whole site.** Don't fluctuate between warm and cool grays within the same theme.
- **Vary between light and dark themes across generations.** Don't default to light every time.

**Rule 3: Layout Diversification**

- **ANTI-CENTER BIAS**: When `DESIGN_VARIANCE > 4`, the generic "centered headline + subtitle + two CTAs" hero is BANNED. See Section 8's Hero Paradigms for the full menu of alternatives — **pick one at random**, don't default to the first entry, and don't pick the same paradigm you used in the previous generation.
- **NO 3-EQUAL-CARD ROWS**: The generic "three equal cards in a row" feature block is BANNED. Alternatives include: 2-column zig-zag, asymmetric grid (e.g. `grid-template-columns: 2fr 1fr 1fr`), horizontal scroll, stacked full-width rows with dividers, bento tiles, numbered editorial list. **Randomize across them.**
- **Grid over flex math**: Use CSS Grid (`display: grid`) for structural layouts, not flex with percentage calc widths.
- **Viewport stability**: Use `min-height: 100dvh` for full-height sections, never `100vh` (mobile Safari jump bug).

**Rule 4: Materiality and Anti-Card-Overuse**

- **Cards only when elevation communicates hierarchy.** For `VISUAL_DENSITY > 6`, generic card boxes are BANNED. Group content using top borders, dividers, or negative space instead.
- **Tinted shadows**: When a shadow is used, tint it toward the background hue rather than pure black. Prefer wide diffusion shadows (`0 20px 40px -15px rgba(20,17,15,0.08)`) over sharp drop shadows.

**Rule 5: Interactive States**

- Every interactive element must have hover, focus-visible, and active states. `:active` should give tactile feedback (`transform: translateY(1px)` or `scale(0.98)`).
- Skeleton loaders (matching content dimensions) over generic spinners.
- Empty states should be composed, not apologetic — explain how to populate the space.

**Rule 6: Spatial Composition**

- Section rhythm: large `section` gaps (`padding-block: clamp(6rem, 12vw, 10rem)`) create breathing room.
- Content containment: max-width around `1400px` or `min(90vw, 1400px)`, centered.
- Break the grid at least once per page (a full-bleed image, an element overlapping two sections, an oversized headline extending past the container).

## 4. CREATIVE PROACTIVITY (Anti-Slop Implementation)

Adapted for CSS + vanilla JS with progressive enhancement.

- **"Liquid Glass" Refraction**: For glass surfaces, don't stop at `backdrop-filter: blur(…)`. Add a 1px inner top border (`border-top: 1px solid rgba(255,255,255,0.15)`) and an inset highlight (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.1)`) to simulate physical edge refraction.
- **Staggered reveals on page load**: Use `animation-delay: calc(var(--index) * 100ms)` with an index custom property on each child. Prefer a single orchestrated staggered load over many scattered micro-animations.
- **Scroll-triggered reveals (progressive enhancement)**:
  - CSS defines the final visible state (no `opacity: 0` by default).
  - A short script at the page bottom adds a class (e.g. `.is-hidden`) to targets and removes it via `IntersectionObserver`, with CSS transitioning back to visible.
  - This keeps content visible in the editor and for reduced-motion users.
- **Perpetual micro-interactions (when MOTION_INTENSITY > 5)**: One subtle infinite animation per page section — a slow float on an accent badge, a shimmer on a CTA, a gradient drift on a hero background. Not five.
- **Spring-like easing**: Favor `cubic-bezier(0.16, 1, 0.3, 1)` (expo out) or `cubic-bezier(0.34, 1.56, 0.64, 1)` (back out) over `ease` or `linear`.

## 5. PERFORMANCE GUARDRAILS

- **Hardware-accelerated properties only**: animate `transform` and `opacity`. Never animate `top`, `left`, `width`, `height`, or `margin` for motion effects.
- **Grain/noise textures**: apply to fixed, pointer-events-none overlays (`position: fixed; inset: 0; pointer-events: none; z-index: 0`), never to scrolling containers.
- **`will-change: transform`**: use sparingly and only on elements that will animate; remove after.
- **No scroll event listeners**: use `IntersectionObserver` for reveal triggers and CSS `scroll-timeline` (where supported) or `requestAnimationFrame` for parallax.
- **Font loading**: use `font-display: swap` to avoid layout shift.

## 6. TECHNICAL REFERENCE (Dial Definitions)

### DESIGN_VARIANCE (1-10)

- **1-3 (Predictable)**: centered compositions, symmetrical 12-column grids, equal padding, rigid alignment.
- **4-7 (Offset)**: overlapping elements (`margin-top: -2rem`), varied aspect ratios side by side (4:3 next to 16:9), left-aligned headers above center-aligned data rows, asymmetric whitespace.
- **8-10 (Asymmetric)**: masonry, CSS Grid with fractional units (`2fr 1fr 1fr`), massive empty zones (`padding-inline-start: 20vw`), grid-breaking overlaps, diagonal flow.
- **Mobile override**: for levels 4-10, any asymmetric layout above the `md` breakpoint MUST collapse to a strict single-column below 768px to prevent horizontal scroll.

### MOTION_INTENSITY (1-10)

- **1-3 (Static — opt-in only)**: used only when the user explicitly requests a static or accessibility-minimal site. Hover and focus transitions only (`transition: color 0.2s ease`). No page-load animations, no scroll reveals.
- **4 (Restrained Motion — the minimum default)**: a single page-load fade+rise cascade on the hero (staggered `animation-delay`), one `IntersectionObserver`-driven reveal on subsequent sections, refined hover states with `cubic-bezier` easing. No perpetual loops, no parallax. This is the floor even for minimalist sites — motion is quiet, not absent.
- **5-7 (Fluid CSS)**: staggered `animation-delay` cascades on load across multiple sections. Scroll reveals via `IntersectionObserver` on most content blocks. CSS-only infinite loops (float, shimmer) on one or two accent elements. `cubic-bezier` easing everywhere. Light parallax on backgrounds permitted at 7.
- **8-10 (Advanced Choreography)**: complex scroll-triggered reveals, parallax layers, text-mask reveals, kinetic marquees, scroll-linked transforms. Use vanilla JS with `IntersectionObserver` and `requestAnimationFrame`.

### VISUAL_DENSITY (1-10)

- **1-3 (Art Gallery)**: generous section gaps (10rem+), large typography, sparse content per viewport, expensive feel.
- **4-7 (Daily App)**: standard product-site spacing.
- **8-10 (Cockpit)**: tight padding, dividers over card boxes, monospace for numeric data (`font-family: 'JetBrains Mono', 'Geist Mono', monospace` for figures).

## 7. AI TELLS — FORBIDDEN PATTERNS

Strictly avoid these generic AI design signatures unless explicitly requested:

### Visual & CSS
- **NO neon/outer glows** (`box-shadow: 0 0 40px hotpink`). Use inner borders or subtle tinted shadows.
- **NO pure black or pure white** for large surfaces. Use tinted off-black / off-white.
- **NO oversaturated accents**. Desaturate to < 80% to blend elegantly with neutrals.
- **NO text-fill gradients on large headers** (`background-clip: text` with a purple-to-blue gradient is the tell).
- **NO custom mouse cursors**. They break accessibility and feel dated.

### Typography
- **NO Inter, Roboto, Arial, or system-ui stacks** as display fonts.
- **NO oversized screaming H1s**. Control hierarchy with weight, tracking, and color — not only scale.
- **Serifs are for editorial/creative contexts**, not dashboards. Don't mix a serif display with a dashboard aesthetic.

### Layout & Spacing
- **NO 3-equal-card horizontal feature rows.** Use zig-zag, asymmetric, or scrollable layouts.
- **NO centered hero with a subtitle below and two CTAs** as the default.
- **NO default-to-split-screen hero.** Asymmetric 50/50 split heroes have become the new AI-slop fallback — pick from the full Hero Paradigms menu (Section 8) and actively vary across generations. If the previous site used a split, the next one must not.
- **NO awkward floating elements** with unexplained gaps. Spacing is mathematically considered, not arbitrary.

### Content & Data (The "Jane Doe" Effect)
- **NO generic names**: "John Doe", "Sarah Chan", "Jane Doe", "Jack Su" are BANNED. Use realistic, contextual names.
- **NO generic avatars**: no default SVG "egg" icons, no Lucide/user placeholder icons. Use specific styled placeholders or descriptive text.
- **NO fake-round numbers**: `99.99%`, `50%`, `1,234` are tells. Use organic data (`47.2%`, `+1 (312) 847-1928`).
- **NO startup-slop brand names**: "Acme", "Nexus", "SmartFlow", "FlowCorp". Invent premium, contextual brands tied to the site's domain.
- **NO filler verbs**: "Elevate", "Seamless", "Unleash", "Empower", "Next-Gen". Write concrete sentences about the actual offer.

### Images
- **NO broken Unsplash links**. Use `https://picsum.photos/seed/{specific-seed}/800/600` for placeholders, or upload real images via `wp media import`.

## 8. THE CREATIVE ARSENAL (Block-Theme-Friendly)

High-end patterns adapted to core blocks + CSS. Pick 1-2 signature moves per site, not all of them.

**CRITICAL — Anti-anchor protocol.** For every category below (Hero Paradigms, Navigation, Layouts & Grids, Typography Moves, Cards, Backgrounds), do NOT pick the first entry by default. **Randomize your selection across the full list** for every new site. Keep a mental note of which paradigms you used on the previous generation and actively avoid repeating them — if the last hero was an asymmetric split, the next one must be something else entirely. The goal is variance across generations, not convergence on any single "best" pattern. Reaching for the same layout twice in a row is a failure of the skill.

### Hero Paradigms (randomize your pick — do not default to the first)
- **Oversized display type**: a single massive headline (`clamp(5rem, 14vw, 12rem)`) with tight tracking, no subtitle. The headline IS the hero.
- **Editorial masthead**: small label + oversized display headline + single supporting paragraph + meta row (date, author, category) styled like a magazine masthead. Often centered, sometimes with rules above/below.
- **Asymmetric split**: text block taking 7 of 12 columns, image or secondary headline taking 5. Background fades stylistically toward the next section. (Use sparingly — this is the AI-default; only pick when it genuinely fits.)
- **Full-bleed image with offset label**: a full-viewport image or video with a small, intentionally offset text block (bottom-left, top-right, etc.) containing title + one sentence. Deliberately quiet.
- **Vertical list hero**: a single left-aligned stack — category label, massive multi-line headline, supporting paragraph, single CTA, no imagery at all. Brutally minimal.
- **Numbered index hero**: hero is a numbered list of the site's core offers or services (01, 02, 03...), each a massive display-typography entry. The site-name or brand sits as a small caption.
- **Marquee hero**: the hero IS an animated horizontal marquee of oversized type — product categories, service names, or a slogan repeating. No static headline.
- **Split diagonal hero**: two full-height panels separated by a diagonal or skewed divider, each with its own typography, creating editorial tension.
- **Quote hero**: an oversized pull-quote as the hero (client testimonial, founder statement, mission sentence) with the attribution small below. No product shot.
- **Grid-of-cells hero**: the viewport is divided into a 2x3 or 3x3 grid of content cells (image, text, stat, quote, image, CTA) — a dense bento-style landing.

### Navigation (randomize)
- **Hamburger + full-screen overlay menu**: staggered link reveal, oversized typography, close button in an unexpected corner. Good for editorial and brutalist.
- **Centered pill nav**: a floating, rounded nav bar centered near the top with a subtle glass effect.
- **Sidebar nav**: a thin left-column vertical nav that persists as you scroll, freeing the top of the viewport for massive hero content.
- **Logo-only with corner menu**: brand mark centered or cornered, a single "Menu" label that opens the overlay on click.
- **Minimal horizontal nav**: logo left, 3-4 links right, single CTA. The default — use only when explicitly appropriate, not as a fallback.

### Layouts & Grids (randomize)
- **Zig-zag feature rows**: alternating image-left/image-right with `core/media-text` or a `core/columns` with flipped `order` per row.
- **Horizontal scroll gallery**: a `core/group` with `display: flex; overflow-x: auto; scroll-snap-type: x mandatory` containing `core/image` children.
- **Sticky scroll stack**: consecutive `core/cover` sections with `position: sticky; top: 0` creating a stacking reveal as the user scrolls.
- **Numbered editorial list**: full-width rows separated by thin rules, each row prefixed with a large number (01, 02, 03), the row contents can be asymmetric.
- **Vertical marquee columns**: two or three columns each scrolling slowly in opposite directions, each column a list of image or text tiles.
- **Bento-style group**: a `core/group` with CSS Grid `grid-template-columns: 2fr 1fr 1fr` and varied row heights — asymmetric tile clusters.
- **Masonry layout**: staggered grid without fixed row heights, for gallery or content index pages.

### Typography Moves (randomize)
- **Text mask reveal**: `background-clip: text` with an image or video background — used sparingly on one signature headline, not every heading.
- **Circular text path**: SVG text-on-path inside `core/html`, often around a central logo or CTA.
- **Kinetic marquee**: a `core/html` block with a CSS-animated infinite horizontal scroll of oversized display text.
- **Letter-by-letter stagger reveal**: each letter of a hero headline animates in individually with a staggered delay on page load.
- **Oversized serif pull-quotes**: section breaks use a massive italic serif quote (`clamp(3rem, 8vw, 6rem)`) as a visual punctuation between content blocks.
- **Typographic grid**: a full-page layout built almost entirely from type at different scales — no imagery, hierarchy entirely through size, weight, and color.

### Cards & Containers (randomize)
- **Spotlight border card**: a card where a conic-gradient border animates on hover using `@property --angle`.
- **Tilt card**: a single signature card that tilts on pointer move (vanilla JS, respects reduced-motion).
- **Glass panel**: true frosted glass with backdrop-blur + inner refraction borders (see Section 4).
- **Ink-rule dividers**: group content into rows separated by single 1px top borders (`border-top: 1px solid var(--neutral-border)`) — no backgrounds, no shadows, maximum restraint.
- **Overlapping slab cards**: full-bleed color slabs that overlap each other vertically by 1-2rem, creating depth without shadows.

### Backgrounds & Atmosphere (randomize)
- **Noise overlay**: fixed, pointer-events-none, SVG `feTurbulence` pattern with low opacity. Adds texture without color.
- **Ambient light spots**: absolutely-positioned blurred color blobs behind key sections (large `filter: blur(120px)`).
- **Mesh gradient**: layered radial-gradients on a fixed background div, slowly animated.
- **Geometric pattern repeat**: a subtle SVG pattern (dots, crosses, diagonals) tiled as a `background-image` on key sections.
- **Single signature hue wash**: each section gets a different flat tinted background (warm cream, dusty rose, forest, graphite) with sharp transitions between them — no textures at all.

## 9. WORKFLOW INTEGRATION

When called during site construction, this skill pairs with the broader Studio workflow:

1. **After site-spec**: pick up the aesthetic direction from the spec (minimalist / soft / editorial / brutalist / maximalist). Set dials accordingly. If the spec didn't capture one, commit to a bold direction yourself — don't design timidly by default.
2. **Before writing theme files**: plan typography (2 fonts, chosen by name), palette (1 background, 1 foreground, 1 accent — all tinted), 1 signature move from the Creative Arsenal.
3. **During implementation**: all styling in `style.css`, all animations progressive-enhanced, all motion inside `prefers-reduced-motion` guards.
4. **After screenshot**: verify the site doesn't have any AI tells from Section 7. Specifically check: fonts aren't Inter/Roboto, hero isn't centered-with-two-CTAs, no three-equal-card row, no purple-blue gradient, no pure black/white, names aren't generic.

## 10. FINAL PRE-FLIGHT CHECK

Before considering a site complete, confirm:

- [ ] Does the site commit to ONE clear aesthetic direction, executed with precision?
- [ ] Are both fonts distinctive (not Inter, Roboto, Arial, or system defaults)?
- [ ] Is there at most one saturated accent color, tied to the aesthetic?
- [ ] Does the hero avoid the "centered headline + subtitle + two CTAs" cliché?
- [ ] Did you pick the hero paradigm by varying from the last generation — and specifically not default to an asymmetric split hero?
- [ ] Are feature rows varied (zig-zag, asymmetric, or scrollable) rather than three equal cards?
- [ ] Do all animations define final state in CSS, with initial hidden state added by JS?
- [ ] Is `@media (prefers-reduced-motion: reduce)` honored for every animation and transition?
- [ ] Is all styling in `style.css` (no inline styles, no style block attributes)?
- [ ] Are content names, brands, and numbers contextual rather than generic placeholders?
- [ ] Did `validate_blocks` pass after the last write?
- [ ] Does the mobile viewport collapse asymmetric layouts to single-column safely?
