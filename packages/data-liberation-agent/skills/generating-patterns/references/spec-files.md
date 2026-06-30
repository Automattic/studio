# Per-section spec files

A spec file is a contract between extraction and pattern generation. One spec file per section. It contains every value needed to write the WP block pattern without re-running capture.

**Path:** `<outputDir>/specs/section-<n>-<type>.md`
**Source:** the section extraction tool (step 9 of `/liberate`) — computed styles, interaction model, uploaded WP media URLs, brightness, motion signals.
**Consumed by:** Step 10 of `/liberate` — the pattern generator (builder subagent) reads this file and picks the matching block template from `references/section-mapping.md`.

**Media note:** image references in specs use **uploaded WP-library URLs** (the URLs returned after the pipeline's media dedup + upload step) or `assets/<local-filename>` for theme-shipped assets. Do NOT reference CDN URLs from the source platform — those are gone by the time the theme is deployed.

## Template

Copy this template verbatim for every section. Fill every field. If a field truly doesn't apply, write `n/a` — but most fields apply to most sections.

```markdown
# Section <n> — <Interaction Model>

## Identity

- **Index in page:** <n from section extraction>
- **Interaction model:** <static | cover-with-headline | animated-cover | media-text | columns | gallery | logo-strip | testimonial | cta | blog-card-grid | project-card-grid | price-list | color-block-grid | marquee-strip | horizontal-showcase | footer | nav>
- **Y band:** top=<px>, height=<px>
- **Framework-specific widget:** <none | marquee | store | booking | form | chat | members | cms-collection | shopify-embed>
- **Copyright flag:** <none | contains trademarked logos | contains celebrity photography | contains copyrighted editorial imagery>

## Captured palette

- **Background color:** <hex from wrapper.styles.backgroundColor, e.g. #FFE600>
- **Background brightness:** <0-255 computed via 0.299R + 0.587G + 0.114B — drives cover-vs-group choice>
- **Text color:** <hex, e.g. #111111>
- **Accent color used inside section:** <hex or n/a>
- **Does the section overlay a background image?** <yes | no>
  - If yes: `assets/<local-filename>` — size <w×h> — alt text: "<alt>"

## Real content (verbatim from the site)

### Headings
- **h1:** "<exact text>" — captured font-size <Npx>, weight <N>, family "<family>"
- **h2:** "<exact text>" — captured size <Npx>
- **h3 etc.:** "<exact text>" — ...

### Body text / paragraphs
- "<exact paragraph text, up to 300 chars>"
- "<next paragraph>"

### Buttons
- Label: "<exact text>"; href: "<url>"; bg color: <hex>; text color: <hex>

### Lists / bullet items
- "<item 1>"
- "<item 2>"

## Images used in this section

For each image in this section, list:

- `<uploaded-wp-url or assets/img-<nn>.<ext>` — kind `<img | background>` — original alt "<alt>" — captured rect <w×h> — position in section <top-left | center | right-column | grid-item-N>

Use the **uploaded WP-library URL** when the media upload step succeeded. Fall back to `assets/<local-filename>` only for theme-shipped assets (logos, decorative SVGs, icons packaged with the theme).

If this section has **layered images** (background + foreground stacked), list them in back-to-front order and mark which are positioned as `absolute`.

## Inline SVGs / icons

For each meaningful non-downloadable SVG, list:

- label/viewBox/path count — captured rect <w×h> — role <icon | badge | arrow | decorative> — WP reproduction <inline SVG | CSS approximation | omit as decorative>

Small page-builder arrows, checkmarks, service icons, award badges, and social icons often arrive as inline SVG rather than `img`. Record them here so the pattern generator preserves visible UI chrome instead of replacing it with generic glyphs.

## Layout

- **Container width:** <px from wrapper.rect.width>
- **Padding:** <Npx top / right / bottom / left>
- **Child layout:** <grid | flex-row | flex-column | stack>
- **Column count (if grid/flex-row):** <N>
- **Gap between children:** <Npx>
- **Divider above:** <color + thickness (e.g. "rgba(255,255,255,0.15) 1px"), or n/a>
- **Divider below:** <color + thickness, or n/a>
- **Responsive notes:** <how does this change at 390px from the mobile screenshot?>

## Motion profile

- **Motion class:** <none | css-transition | css-keyframes | entry-reveal | marquee | carousel | parallax | video | lottie | scroll-triggered>
- **Captured signals:** <e.g. transition, transform, carousel-like>
- **Animated elements:** <count>
- **Media fallback:** <video poster path | carousel reduced to project grid | static final state | n/a>
- **Timing:** <duration/delay/easing, or n/a>
- **Start state:** <opacity/transform/position if visible in motion-start capture, or n/a>
- **End state:** <settled final state from desktop screenshot, or n/a>
- **Reduced-motion behavior:** <disable animation and show final state | keep static poster | n/a>
- **WP reproduction plan:** <theme-scoped CSS class | static fallback with explicit comment | plugin required>

## Generation instructions

- **Block template to use (from `section-mapping.md`):** `<template-name>`
- **Placeholders to fill:**
  - `{{BG_COLOR}}` → <hex>
  - `{{BG_GRADIENT}}` → <linear-gradient(...) string, or n/a — wins over BG_COLOR when present>
  - `{{TEXT_COLOR}}` → <hex>
  - `{{HEADING}}` → "<text from above>"
  - `{{SUBHEADING}}` → "<text>"
  - `{{BUTTON_LABEL}}` → "<text>"
  - `{{BUTTON_HREF}}` → "<url>"
  - `{{ASSETS}}` → [<uploaded-wp-url or assets/img-<nn>.<ext>>, ...] (as a list for the generator loop)
  - `{{COLUMN_COUNT}}` → <N>
  - `{{DIVIDER_ABOVE}}` → <color hex, or n/a>
  - `{{DIVIDER_BELOW}}` → <color hex, or n/a>
- **Substitutions made for copyright:** <none | img-04.jpg replaced with assets/placeholder-600x400.svg because it's a celebrity photo>
- **Design brief citations:** <list the `design.md` subsections this pattern depends on, e.g. "Component > Cards & Containers for shadow and radius; Typography > Card Heading for title size/weight; Color Palette > Surface & Shadows for card bg"> — the builder reads both files and expects these citations.

## Notes for the pattern generator

Free-form notes that don't fit the template. Anything the pattern author needs to know — "this is a press-logo strip so use `core/columns` with uniform widths", "the background has a subtle gradient from #FFE600 to #FFEE66", "the heading is broken across three lines using explicit `<br>` so preserve them".
```

## How to fill a spec file

Read the output of the section extraction tool for this section. It produces three top-level keys:

- `wrapper` — the section container's tag, rect, and computed styles. Use this for **Captured palette** (background color, text color, overlay detection via `backgroundImage`).
- `tree` — the full DOM tree. Walk it to find per-element styles if you need more than the flat summary.
- `flat` — shortcut arrays: `text[]`, `images[]`, `backgroundImages[]`, `svgs[]`, `videos[]`, `buttons[]`. This is where most of the **Real content**, **Images**, and **Inline SVGs / icons** data comes from.

Example — given this `flat` payload from a captured section:

```json
{
  "text": [
    { "role": "heading", "text": "DESIGNER WHEEL COVERS", "size": "45px" },
    { "role": "subheading", "text": "5 collaborations", "size": "23px" }
  ],
  "images": [
    { "src": "https://cdn.example.com/abc.png", "alt": "Jason Naylor collab", "w": 220, "h": 220, "wpUrl": "https://mysite.local/wp-content/uploads/abc.png" },
    { "src": "https://cdn.example.com/def.jpg", "alt": "Tropical Flowers", "w": 221, "h": 220, "wpUrl": "https://mysite.local/wp-content/uploads/def.jpg" }
  ],
  "buttons": []
}
```

The spec file for this section fills like:

```markdown
## Real content
### Headings
- **h2:** "DESIGNER WHEEL COVERS" — captured size 45px
- **h3:** "5 collaborations" — captured size 23px

## Images used in this section
- `https://mysite.local/wp-content/uploads/abc.png` — alt "Jason Naylor collab" — 220×220 — grid-item-1
- `https://mysite.local/wp-content/uploads/def.jpg` — alt "Tropical Flowers" — 221×220 — grid-item-2

## Layout
- Child layout: flex-row (grid)
- Column count: 5
- Gap between children: ~20px

## Generation instructions
- **Block template to use:** `columns`
- **Placeholders to fill:**
  - `{{HEADING}}` → "DESIGNER WHEEL COVERS"
  - `{{ASSETS}}` → [https://mysite.local/wp-content/uploads/abc.png, ...]
  - `{{COLUMN_COUNT}}` → 5
```

## What makes a spec file "complete"

A spec file is complete when a human who has never seen the source page can read only this file and write the matching WP block pattern without guessing. If your generator has to make assumptions, go back to the extraction output and re-read until you can fill the gap.

For complex UI sites, "complete" also means a human can tell what happens when the section moves. If the section has hover cards, entry reveals, marquees, carousels, parallax, video, or framework animation markers, the Motion profile must say whether WP preserves it, reduces it, or stubs it with an explicit comment.

If you write `n/a` for more than 3 fields, the section probably needs re-extraction — either the section index was wrong, or the wrapper detection picked an empty outer container instead of the real section.

The spec must also pass the `liberate_validate_artifacts` gate before the section goes out to a builder. The gate checks escaping (`esc_html`/`esc_attr`/`esc_url` applied), injection allowlist (no raw `<?php` / `<script>` / `on*=` in emitted markup), and provenance (emitted text is a subset of the spec's captured text). Fix gate failures before dispatch — do not send a failing spec to a builder.
