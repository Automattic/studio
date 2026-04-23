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
- **Out of scope**: this skill does NOT modify CSS, theme files, or site content by default. It is a pure HTML → block markup transformation. If the caller wants the result applied somewhere, they invoke the appropriate tool after receiving the output.

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

## Nesting

Sections are built by nesting blocks inside `core/group`. The block structure is for editability; the stylesheet is for aesthetics. Never push layout, spacing, or color into block markup that belongs in CSS.

## Additional rules

- Never use `core/html` to wrap text content, headings, layout sections, or lists.
- No decorative HTML comments (e.g. `<!-- Hero Section -->`, `<!-- Features -->`). Only block delimiter comments are allowed.
- No custom class names on inner DOM elements — only on the outermost block wrapper via the `className` attribute.
- No inline `style` or `style` block attributes for styling. Use `className` instead.
- Use `core/spacer` for empty spacing divs, not `core/group`.
- No emojis anywhere in generated content.
- Adding `data-*` attributes does NOT make a block acceptable — use `className` on `core/group` blocks instead.
