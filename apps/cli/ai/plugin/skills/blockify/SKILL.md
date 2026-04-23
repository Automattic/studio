---
name: blockify
description: Convert HTML content to native Gutenberg block markup. Invoke this any time you need to translate raw HTML (a section, a full page, a file on disk, a snippet in the conversation) into valid block markup. Works on any input — not scoped to a site, a post, or a theme.
user-invokable: true
---

# Blockify — HTML to Gutenberg blocks

Convert HTML input into native Gutenberg block markup. The goal is **FAITHFUL CONVERSION**: reproduce the same DOM using native blocks, preserve every className, and only fall back to `core/html` for truly non-convertible elements.

## Input and output

- **Input**: any HTML — a single section, a full page, a file you `Read`, a snippet the user pasted, the `post_content` of an existing post fetched via `wp_cli post get`. This skill does not care where the HTML came from.
- **Output**: valid Gutenberg block markup that renders the same visual DOM. Return it inline in your response, write it to a file with `Write`/`Edit`, or apply it with `wp_cli post update` — whichever the caller asked for.
- **Out of scope**: this skill does not modify CSS or theme files itself. It provides the HTML → block markup translation AND the CSS selector adjustments you MUST make when porting prototype CSS to a block theme (see "CSS migration after conversion" below) so the theme renders identically to the prototype.

## Decompose — do not give up on a section

Never wrap an entire section in `core/html` just because some of its children are non-convertible. Break sections apart: convert every convertible child to a native block and isolate only the truly non-convertible child as its own `core/html` block.

Example: a hero `<section>` with a heading, paragraph, buttons, image, AND a scroll-indicator animation becomes `core/group` > `core/heading` + `core/paragraph` + `core/buttons` + `core/image` + `core/html` (scroll indicator only). Do NOT keep the entire hero as `core/html`.

## Translation table

| HTML | Gutenberg block |
|------|----------------|
| `<section>`, `<div>`, `<header>`, `<footer>`, `<aside>` | `core/group` with appropriate `tagName` |
| `<h1>`–`<h6>` | `core/heading` with matching `level` |
| `<p>` | `core/paragraph` |
| `<a class="btn">` / CTA links | `core/buttons` + `core/button` |
| CSS grid/flex layouts with `<div>` children | `core/columns` + `core/column` |
| `<ul>` / `<ol>` | `core/list` + `core/list-item` |
| `<img>` | `core/image` |
| `<figure>` | `core/image` or `core/media-text` |
| `<blockquote>` | `core/quote` |
| `<table>` | `core/table` |
| `<hr>` | `core/separator` |
| Empty spacing `<div>` | `core/spacer` |

## Keep `core/html` ONLY for

- Inline SVGs (icons, illustrations, decorative graphics)
- `<form>` elements and interactive inputs
- `<canvas>`, `<iframe>`, `<video>`, `<audio>`
- Animation/interaction markup (marquee, custom cursor, scroll-triggered elements)
- Elements needing custom `data-*` attributes for JS interactivity
- `<script>` tags — always extract into their own separate `core/html` block, never bundled with structural content

## NOT valid reasons to keep an element as `core/html`

- `id` attributes — `core/group` supports `anchor` for element IDs.
- Inline `<em>`, `<strong>`, `<br>`, `<a>` inside text — `core/heading` and `core/paragraph` support inline HTML.
- `loading="eager"` on images — drop the attribute rather than keeping the whole section as HTML.
- A single non-convertible child — decompose the section instead of skipping it.
- Small text-containing `<div>` or `<span>` (eyebrow text, labels, captions, taglines) — convert to `core/paragraph` with the appropriate `className`.
- Decorative wrapper `<div>` elements — convert to `core/group` with `className`.
- **Section wrappers with background images, overlays, or gradients** — always `core/group` with `className`. All visual effects (background-image, overlays, pseudo-elements, gradients) are handled by CSS targeting the className, not by the block markup.

**Be thorough.** Convert every single element that has a native block equivalent. A `<div>` with text inside it is a `core/paragraph` or `core/group`, not a Custom HTML block.

## Preserve every className

Every CSS class from the input stays on the outermost block wrapper via the `className` attribute. No custom class names on inner DOM elements. Never inline `style` attributes — classNames drive all appearance, backed by whatever stylesheet the caller already has.

## Block pattern reference

### Section wrapper

Replaces `<section>`, `<div>`, `<aside>`, `<header>`, `<footer>`:
```
<!-- wp:group {"tagName":"section","className":"hero-section","layout":{"type":"default"}} -->
<section class="wp-block-group hero-section">
  <!-- inner blocks go here -->
</section>
<!-- /wp:group -->
```

### Heading

Replaces `<h1>`–`<h6>`:
```
<!-- wp:heading {"level":1,"className":"hero-title"} -->
<h1 class="wp-block-heading hero-title">Your Title</h1>
<!-- /wp:heading -->
```

### Paragraph

Replaces `<p>`:
```
<!-- wp:paragraph {"className":"hero-subtitle"} -->
<p class="hero-subtitle">Your text here.</p>
<!-- /wp:paragraph -->
```

### Columns layout

Replaces CSS grid/flex with `<div>` children:
```
<!-- wp:columns {"className":"features-grid"} -->
<div class="wp-block-columns features-grid">
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- inner blocks -->
  </div>
  <!-- /wp:column -->
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- inner blocks -->
  </div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->
```

### Image

Replaces `<img>`:
```
<!-- wp:image {"className":"hero-image"} -->
<figure class="wp-block-image hero-image"><img src="https://example.com/image.jpg" alt="Description"/></figure>
<!-- /wp:image -->
```

### Buttons

Replaces `<a class="btn">`:
```
<!-- wp:buttons {"className":"hero-cta"} -->
<div class="wp-block-buttons hero-cta">
  <!-- wp:button {"className":"primary-btn"} -->
  <div class="wp-block-button primary-btn"><a class="wp-block-button__link wp-element-button" href="#">Get Started</a></div>
  <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
```

### List

Replaces `<ul>` / `<ol>`:
```
<!-- wp:list {"className":"feature-list"} -->
<ul class="feature-list">
  <!-- wp:list-item -->
  <li>First item</li>
  <!-- /wp:list-item -->
  <!-- wp:list-item -->
  <li>Second item</li>
  <!-- /wp:list-item -->
</ul>
<!-- /wp:list -->
```

### Separator

Replaces `<hr>`:
```
<!-- wp:separator {"className":"section-divider"} -->
<hr class="wp-block-separator section-divider"/>
<!-- /wp:separator -->
```

## CSS migration after conversion

Block markup renders different DOM than prototype HTML, and WordPress injects default paint via \`wp-element-*\` classes and theme.json styles. Prototype CSS copied verbatim to a block theme produces three classic symptoms: double button padding/borders, content narrower than the prototype, and missing section padding. The rules below are MANDATORY when porting prototype CSS to a theme — not optional polish.

### Buttons — the wrapper carries NO paint

\`core/button\` renders two stacked elements:

- outer wrapper: \`<div class="wp-block-button <className>">\` — carries layout only (margin, flex alignment, width).
- inner link: \`<a class="wp-block-button__link wp-element-button <className?>">\` — carries ALL paint.

\`.wp-element-button\` already has default WordPress paint (padding, background, border). If your prototype \`.btn-primary { padding; border; background }\` is copied to the theme as-is, the \`className\` puts it on the outer wrapper via \`.wp-block-button.btn-primary\`, and the inner link keeps WordPress's defaults — you get doubled padding, doubled border, nested backgrounds.

Rule: ALL button paint (background, border, padding, color, font, hover, transitions, shadow, border-radius) goes on \`.wp-block-button.<className> .wp-block-button__link\`. The \`.wp-block-button.<className>\` wrapper gets ZERO paint — only layout.

Migration:
- Delete: \`.btn-primary { background: gold; padding: 1rem 2rem; border: 2px solid gold; color: black; }\`
- Add: \`.wp-block-button.btn-primary .wp-block-button__link { background: gold; padding: 1rem 2rem; border: 2px solid gold; color: black; }\`

### Images — figure wrapper, and the img itself

\`core/image\` renders:

\`\`\`
<figure class="wp-block-image <className>">
  <img src="..." alt="..."/>
</figure>
\`\`\`

Prototype \`.hero-image { ... }\` targeting a bare \`<img>\` now needs to decide:
- figure-level styling (border-radius, box-shadow, outer layout) → \`.wp-block-image.hero-image { ... }\`
- img-level styling (object-fit, aspect-ratio, sizing that has to apply to the pixel data) → \`.wp-block-image.hero-image img { ... }\`

### Groups / sections — constrained layout fights max-width

A \`core/group\` with \`layout: { type: "constrained" }\` picks up the class \`.is-layout-constrained\`. WordPress applies \`max-width: var(--wp--style--global--content-size)\` to every direct child via \`.is-layout-constrained > *\`. If theme.json's \`contentSize\` doesn't match the prototype's intended max-width, children get clamped to the WP default (often 840px) and content appears narrower than the prototype.

Two fixes:
- Set \`settings.layout.contentSize\` and \`settings.layout.wideSize\` in theme.json to match the prototype's actual max-widths (e.g. \`"1200px"\` and \`"1400px"\`).
- For full-bleed sections (hero with a background-image that should go edge-to-edge), use \`layout: { type: "default" }\` on the group instead of \`constrained\` — default layout doesn't inject max-width.

### Neutralize \`wp-element-button\` defaults in theme.json

If your theme provides button styles via \`.wp-block-button.<className> .wp-block-button__link\` selectors, also neutralize the WordPress default so it stops leaking through:

\`\`\`json
"styles": {
  "elements": {
    "button": {
      "color": { "background": "transparent", "text": "inherit" },
      "spacing": { "padding": "0" },
      "border": { "width": "0", "radius": "0" }
    }
  }
}
\`\`\`

This makes \`wp-element-button\` a no-op; your className rules are the only source of button styling.

### Section padding — keep it on the className, not on block attributes

Prototype-style \`.hero-section { padding: var(--section-py) 0; }\` ports cleanly because \`className\` passes through to the outer \`<section class="wp-block-group hero-section">\`. Do NOT move this padding into \`style.spacing.padding\` block attributes — keep it in the stylesheet.

If a section that SHOULD have padding renders without any, check two things: (a) whether \`theme.json\`'s \`styles.spacing.padding\` is setting a default that overrides the prototype rule (fix: remove or null that default), and (b) whether \`is-layout-constrained\` is shifting the padding onto the inner constrained element — make the selector more specific (\`section.hero-section.wp-block-group { padding: ... }\`) or switch the group to \`layout: { type: "default" }\`.

## Nesting

Sections are built by nesting blocks inside \`core/group\`. The block structure is for editability; the stylesheet is for aesthetics. Never push layout, spacing, or color into block markup that belongs in CSS.

## Additional rules

- Never use `core/html` to wrap text content, headings, layout sections, or lists.
- No decorative HTML comments (e.g. `<!-- Hero Section -->`, `<!-- Features -->`). Only block delimiter comments are allowed.
- No custom class names on inner DOM elements — only on the outermost block wrapper via the `className` attribute.
- No inline `style` or `style` block attributes for styling. Use `className` instead.
- Use `core/spacer` for empty spacing divs, not `core/group`.
- No emojis anywhere in generated content.
- Adding `data-*` attributes does NOT make a block acceptable — use `className` on `core/group` blocks instead.
