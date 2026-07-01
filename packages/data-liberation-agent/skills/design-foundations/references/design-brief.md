# Design brief — the `design.md` contract

## Purpose

`design.md` is a one-page design system contract, written once per site in **step 6 of `/liberate`** (the `design-foundations` skill) and consulted by every step that follows. It captures the design decisions that hold for the whole site — palette roles, typography scale with measurements, shadow stack, radius scale, do's and don'ts, and an agent-prompt guide — so parallel builders in step 10 don't each re-derive them and drift apart on small choices ("is the button radius 8 px or 12 px? does the card have one shadow layer or three?").

`design.md` stands to the site as `theme.json` stands to WordPress: the authoritative, site-wide style reference. `theme.json` is the machine-readable subset of it; every pattern file cites the human-readable sections here when making a choice.

**Lifecycle:**

- Written once in step 6 (`design-foundations`), immediately after capture.
- Read by step 7 (`creating-themes` — `theme.json`, font foundation), step 9 (spec file writing), step 10 (parallel builder subagents), step 14 (`design-qa` visual QA loop).
- Frozen during pattern work. If a mismatch surfaces during visual QA iteration 3, correct `design.md` first, then re-derive `theme.json` and regenerate the affected patterns — don't patch patterns one-off and let `design.md` drift.

## Source data

Every section of `design.md` fills from `<outputDir>/` artifacts, never from the live site:

| Section | Source |
|---|---|
| 1. Visual theme & atmosphere | `screenshots/desktop/<slug>.png` (mood), typography tokens from `typography.json`, `palette.json` (temperature + tone), body background from `breakpoints.json` + palette, structural cue from section count |
| 2. Color palette & roles | button color tokens, body text color, `palette.json` dominant colors, link colors from captured sections, section effective backgrounds |
| 3. Typography rules | `typography.json` per-selector font metrics, largest visible text samples from captured sections (size + weight + letter-spacing), Google Fonts substitute chosen per `references/theme-tokens.md` |
| 4. Component stylings | captured button styles, biggest-area card candidate (for shadow and radius), nav anchors, image rects from captured sections |
| 5. Layout principles | `breakpoints.json`, top-5 captured padding/gap/borderRadius values across sections |
| 6. Depth & elevation | `boxShadow` values on the top-5 largest-area cards in captured sections |
| 7. Do's and don'ts | Programmatic seeds from sections 2-6 (see rules below) |
| 8. Responsive behavior | `screenshots/mobile/<slug>.png` vs desktop; `breakpoints.json` integer px values |
| 9. Motion & interaction system | motion signals from captured section analysis |
| 10. Agent prompt guide | Quick reference block from sections 2 and 9, example prompts filled from sections 3-6 |

## Filename and path

`<outputDir>/design.md` — always at the site output root, alongside `palette.json`, `typography.json`, and `breakpoints.json`. The theme directory is a WP-consumable artifact; `design.md` is the contract driving that artifact.

## The 10-section template

Fill every section. If a section truly does not apply (e.g. no shadows detected anywhere → Depth & Elevation becomes "Flat design — no elevation"), still include the heading with a one-line explanation; don't omit headings.

### 1. Visual Theme & Atmosphere

Two paragraphs of narrative + a bulleted "Key Characteristics" list.

**Paragraph 1:** describe the mood as if narrating to a reader flipping through the page. Synthesize from:
- Palette temperature: `(R+G)/2` vs `(G+B)/2` on `palette[0]` — warmer when red-green dominates, cooler when blue-green dominates.
- Display font classification: serif / sans / display / handwriting (match the captured family substring against the table in `references/theme-tokens.md`).
- Hero image palette mood: from `palette.json` histogram — skin tones / product shots / abstract gradients / architectural / nature.
- Section strategy: `'semantic'` suggests a content-forward site (blog, docs, portfolio); `'y-band'` suggests a builder template (marketing, agency, e-commerce).

**Paragraph 2:** describe the *distinguishing* move — the one design choice that makes this site specifically itself. Pull from the captured oddities: a display font at an unusual weight, a gradient body background, a specific shadow stack, unusually generous radius, a pill-collapsed nav. Cite actual captured values.

**Key Characteristics** — 6-8 bulleted items, each concrete and measurable:

- `[base-color hex]` canvas with `[accent hex]` as singular brand accent
- `[Display font]` — `[classification, e.g. variable geometric sans / serif / handwriting]`
- `[Radius scale description]`: `[smallest]px buttons, `[medium]`px cards, `[largest]`px hero elements
- `[Shadow description]`: flat / single / multi-layer
- `[Typography-first | Image-first | Gradient-first]`
- Near-`[warm | cool] [black | white]` text (`[captured body color]`)
- `[Any other distinguishing capture — e.g. fixed-attachment body gradient, sticky header, circular nav controls]`

### 2. Color Palette & Roles

Always include the first four groups. Add **Premium Tiers** only when two or more visually distinct accent colors were captured.

**Primary Brand**
| Hex | Token slug | Role | Captured from |
|---|---|---|---|
| `#{hex}` | `primary` | Brand accent, primary CTA | `tokens.button.bg` (or `palette[0]` if button was null) |
| `#{hex}` | `primary-dark` | Pressed / hover state | darker mix of primary if captured; otherwise derive 10% darker |

**Text Scale**
| Hex | Token slug | Role | Captured from |
|---|---|---|---|
| `#{hex}` | `contrast` | Primary text | `tokens.body.color` |
| `#{hex}` | `contrast-focused` | Focused state | derived — 20% more saturated |
| `rgba(...)` | `contrast-muted` | Secondary text, descriptions | derived — 60% opacity |
| `rgba(...)` | `contrast-disabled` | Disabled state | derived — 24% opacity |

**Interactive**
| Hex | Token slug | Role | Captured from |
|---|---|---|---|
| `#{hex}` | `accent` | Link color, informational | link color from captured section buttons |
| `#{hex}` | `border` | Card border, dividers | captured divider color if any, else derived |

**Surface & Shadows**
| Hex | Token slug | Role | Captured from |
|---|---|---|---|
| `#{hex}` | `base` | Page background | body bg, or dominant stop from `palette.json` |
| `#{hex}` | `surface` | Card surface | biggest-area opaque backgroundColor from captured sections |
| `[shadow stack]` | — | Card shadow | captured boxShadow stack (preserve layer order) |

**Premium Tiers** (optional — include only if 2+ distinct accents were captured)
| Hex | Token slug | Role | Captured from |
|---|---|---|---|
| `#{hex}` | `accent-alt` | Secondary accent, tier badge | second most common accent |

### 3. Typography Rules

Start with a short paragraph naming the captured font family, the Google Fonts substitute, and the principle ("warm weight range 500–700" / "display-only weight 900 with serif body" / "monospace for code, variable sans for body" — pick the one that describes the actual captures).

**Hierarchy** — fill every row from the captured data; use `n/a` when the site genuinely doesn't use that level:

| Role | Font | Size | Weight | Line-height | Letter-spacing | Notes |
|---|---|---|---|---|---|---|
| Display | {display fontFamily substitute} | {display fontSize}px / {px/16}rem | {display fontWeight} | {px → unitless} | {if captured, else `normal`} | Hero headline |
| Section heading | same | {largest h2 size from sections} | {weight} | same | same | `h2` in pattern |
| Card heading | same | {median card title size} | {weight} | same | same | Insight / service row title |
| Sub-heading | same | {h3 size} | {weight} | same | same | |
| Feature title | same | {4th largest text} | {weight} | same | same | |
| UI Medium | body font | 16px / 1rem | 500 | 1.25 | normal | Nav, buttons |
| Button | body font | 16px / 1rem | {captured button label weight} | 1.25 | normal | CTA label |
| Body | body font | {body.fontSize}px | 400 | 1.5 | normal | Paragraph |
| Small | body font | 14px / 0.875rem | 400 | 1.4 | normal | Caption, meta |
| Tag | body font | 12px / 0.75rem | 500-700 | 1.3 | normal | Pills, prices |
| Badge | body font | 11px / 0.69rem | 600 | 1.2 | normal | Status badge |
| Micro | body font | 8-10px | 700 | 1.2 | 0.3-0.4px | Uppercase eyebrow (only if captured) |

**Principles** — 3-4 bullets describing the typographic voice:

- Weight range used (e.g. "500-800" or "400 body only, 700 display only")
- Letter-spacing pattern (e.g. "negative tracking on display for intimacy" or "none — numbers-friendly")
- Any distinctive feature (variable fonts, OpenType features like `salt`, italic-only variant)
- Substitution note: "{captured family} → {free replacement}; self-hosted via `assets/fonts/` in the theme"

### 4. Component Stylings

Break into subsections; fill values from captures, not defaults. For each subsection: describe the style in 2-4 lines, then list concrete values.

**Buttons** — primary, plus one or two variants if detected (circular nav, pill, outlined):

- Primary: background `{captured bg}`, text `{captured fg}`, padding `{captured padding}`, radius `{captured radius}`.
- Hover: `{captured or derived hover state}`.
- Focus: `{captured or a 2px contrast-color ring}`.
- Variant: `{name — e.g. circular nav, outlined, pill — with dimensions}`.

**Cards & Containers**
- Background: `{captured card bg}`.
- Radius: `{captured radius — one or two values across sections}`.
- Shadow: `{captured multi-layer stack or 'flat, no shadow'}`.
- Border: `{captured or 'none'}`.

**Inputs**
- Search / text field: `{captured bg, text color, radius, focus state}` or "none captured — skip" when absent.

**Navigation**
- Layout: `{sticky | fixed | static}` header, logo `{left | center}`-aligned, links `{captured}`, CTA slot: `{captured}`.
- Treatment: overlay (transparent) or solid, per the source header; our dynamic block-header derives this automatically from the captured source.
- Mobile collapse: `{full inline | pill menu | hamburger}` — from mobile screenshot.

**Image Treatment**
- Featured image aspect: `{captured w/h ratio}`.
- Radius: `{captured radius on images}`.
- Overlay: `{any captured overlay color/opacity}` or "none".
- Carousel: `{detected or not}`.

### 5. Layout Principles

**Spacing scale** — list 5-8 snapped values derived from captured paddings/gaps across sections. Use the snap table in `references/theme-tokens.md`:

```
20: 0.25rem — inline (chips, inline buttons)
30: 0.5rem  — tight inter-element
40: 1rem    — default block gap
50: 1.5rem  — card inner padding
60: 2rem    — section inner padding
70: 3rem    — section vertical
80: 4rem    — hero / major section vertical
```

**Container widths**
- Content: `{captured main width || 720-780px default}`.
- Wide: `{nearest 20px below captured contentWidth}`.

**Whitespace philosophy** — one paragraph describing how the site breathes: travel-magazine (generous vertical), editorial (tight-packed), showroom (full-bleed), dashboard (dense grid). Use the captured section heights as evidence.

**Border-radius scale** — explicit list of the discrete values used on the site:

- `{N}px` — small (inline chips, tags)
- `{N}px` — standard (buttons, search)
- `{N}px` — card (feature panels)
- `{N}px` — large (hero, media frames)
- `50%` — circle (nav controls, avatars) — only if detected

### 6. Depth & Elevation

| Level | Treatment | Use |
|---|---|---|
| Flat (0) | No shadow | Page bg, text blocks |
| Card (1) | `{captured card shadow stack}` | {card-like elements detected} |
| Hover (2) | `{captured or derived hover shadow}` | {buttons, interactive lifts} |
| Active Focus (3) | `{captured focus ring or a 2-4px contrast ring}` | {focused elements} |

**Philosophy paragraph** — one paragraph describing the elevation voice: natural (multi-layer), synthetic (single hard shadow), flat (none), depth-first (heavy), content-first (subtle). Tie back to the captured stack.

If the source has no detectable shadows anywhere, collapse to a single line: "Flat design — no elevation is used. All cards and containers sit directly on the surface." Skip levels 1-3.

### 7. Do's and Don'ts

6-8 items each. Seed from captures:

**Do** — always include:
- `Use {captured base hex} for the canvas — {warm | cool | neutral}, not pure white/black.`
- `Apply {captured primary hex} only for {role — CTAs, brand moments, interactive affordances}.`
- `Use {captured display font} at weight {weight range}.`
- `Apply the {multi-layer | single | flat} {shadow description} for elevated surfaces.`
- `Use radius values from the {captured scale}.`
- `{Image-first | Typography-first | Gradient-first} — {the hero medium}.`

**Don't** — always include:
- `Don't use pure {#000000 | #ffffff} for {text | background} — the captured value is {captured hex} (warm, not cold).`
- `Don't apply {primary accent} to large surfaces — it's a {CTA | accent} only.`
- `Don't use {thin | heavy} font weights ({weights}) for headings.`
- `Don't use {sharp | overly-rounded} corners — the captured scale is {scale}.`
- `Don't introduce brand colors beyond {the captured palette}.`
- `Don't override the palette slug system — use \`--wp--preset--color--{slug}\` variables consistently.`
- `Don't emit @import from Google Fonts in the generated theme.css — self-host via assets/fonts/.`

### 8. Responsive Behavior

**Breakpoints** — fill from `breakpoints.json` (union of `@media min-width` / `max-width` integer px values captured during the screenshot step); if empty, emit a generic 4-row scale and mark "inferred, not captured":

| Name | Width | Key Changes |
|---|---|---|
| Mobile | <550px | {stack behavior from mobile screenshot} |
| Tablet | 550-950px | {intermediate behavior or note "same as desktop minus nav"} |
| Desktop | 950-1280px | {detected columns count} |
| Large | 1280-1920px | {detected columns count} |

**Touch targets** — one line describing what's interactive on mobile (per mobile screenshot): full-card taps, pill CTAs, hamburger, carousel swipe.

**Collapsing strategy** — how columns/grids degrade:
- Grid: `{N → N-1 → ...}`
- Nav: `{full → simplified → hamburger}`
- Images: `{captured or 'aspect-ratio preserved'}`

**Image behavior** — `{carousel | static | lazy-load}` at each size.

### 9. Motion & Interaction System

Describe the site's motion voice in one paragraph: static/editorial, subtle premium reveals, playful kinetic, slideshow-led, parallax-heavy, or framework-driven. Use captured motion signals rather than guessing.

**Motion inventory**
| Signal | Count | Where used | Reproduction |
|---:|---:|---|---|
| `css-transition` | {count} | {sections} | theme-scoped hover/focus CSS |
| `css-keyframes` | {count} | {sections} | copy timing into `style.css` if simple |
| `marquee-like` | {count} | {sections} | CSS marquee or static strip |
| `carousel-like` | {count} | {sections} | responsive grid or carousel plugin note |
| `scroll-effect` | {count} | {sections} | static final state unless simple |
| `video/lottie/canvas` | {count} | {sections} | poster/static fallback with comment |

**Rules**
- Preserve simple opacity/transform reveals with the captured duration, easing, and final visible state.
- Keep hover overlays additive; mobile must show the same labels without hover.
- Disable non-essential motion under `prefers-reduced-motion: reduce`.
- Do not recreate cookie banners, chat popups, or builder chrome as theme content.

### 10. Agent Prompt Guide

**Quick color reference** — compact key=value block:

```
Background: {base hex}
Text: {contrast hex}
Brand accent: {primary hex}
Secondary text: {contrast-muted hex}
Disabled: {contrast-disabled}
Card surface: {surface hex}
Card border: {border hex or 'none'}
Card shadow: {full stack}
Button surface: {primary hex}
```

**Example component prompts** — 3-5 ready-to-paste prompts filled with the captured tokens. Each should mention concrete values and reference a section above:

- `"Create a listing card: {surface} background, {card radius}px radius, {shadow stack}. Photo area on top ({image aspect}), details below: {card heading size}px {display font} weight {card heading weight} title, {body size}px weight 400 description in {contrast-muted}."`
- `"Design a primary button: {primary bg}, {primary fg} text, {button radius}px radius, {button size}px {body font} weight {button weight}, {padding} padding. Hover: {hover treatment}."`
- `"Build a section header: {display size}px {display font} weight {display weight} heading in {contrast}, tracking {letter-spacing} if captured. Optional eyebrow tag in {micro style} if captured."`
- `"Create a feature row: {row bg}, horizontal flex with title left / price center / CTA right, {row padding} padding. Row radius {row radius}px."` (include only for sites with a captured `price-list` section)
- `"Design a footer: {base bg}, {contrast} text, {columns count} columns, {separator rule or 'none'} between brand and links."`

**Iteration guide** — 6-8 bullets in imperative voice, synthesizing the principles:

- `Start with {canvas} — {what provides the visual interest: photography, gradient, typography, illustration}.`
- `{Primary accent} is the singular accent — use sparingly for {role}.`
- `{Warm | Cool | Neutral}-near-{black | white} for text — the {warmth | coolness} matters.`
- `{Multi-layer | Single | Flat} shadows — always use {all layers | the captured stack | no shadow}.`
- `{Radius discipline} — {the scale or 'always 50% for controls'}.`
- `{Display font} at {weight range} — {avoid thin weights | variable-axis driven | only one weight}.`
- `{Image-first | Typography-first | Gradient-first} — every card/section leads with {the hero medium}.`

## What NOT to include

- **Not a changelog.** Edits go directly into the content, not a "v1 / v2" list.
- **Not per-section specs.** Those live in `<outputDir>/specs/section-<n>.md`. `design.md` is site-wide.
- **Not copy text.** Heading text, body copy, button labels all live in captured section data. `design.md` describes *style*, not *content*.
- **Not raw computed-style dumps.** Summaries and tables only. If a section needs 50 lines to describe, it's wrong for this document.
- **Not WP-specific markup.** No block JSON, no `wp:*` blocks. The emission templates in `references/section-mapping.md` are the WP-specific translation of `design.md` values.

## How `design.md` is used downstream

| Step | Reads | Uses for |
|---|---|---|
| 7 (`creating-themes`) | Sections 2, 3, 5, 6 | Emitting `theme.json` palette, typography preset, spacing scale, shadow defaults |
| 9 (spec writing) | Section 4 | Deciding which component template (button, card, input) applies per section |
| 10 (builder subagents) | All sections | Every builder is given `design.md` + the per-section spec, and MUST cite a `design.md` subsection for any styling choice |
| 14 (`design-qa`) | All sections | Diff triage — if the rendered clone's card radius differs from `design.md`'s Component > Cards entry, it's a class-B template issue; if `design.md` itself is wrong, correct it and regenerate patterns |
