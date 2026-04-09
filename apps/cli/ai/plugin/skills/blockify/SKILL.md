---
name: blockify
description: Convert all core/html blocks in a WordPress site to native Gutenberg blocks. Run this after building a site (Phase 2) or on any existing site that uses custom HTML blocks.
user-invokable: true
---

# Block Conversion (Blockify)

Convert all `core/html` blocks in a site's pages, posts, and template parts to native Gutenberg blocks. The CSS stays untouched — the visual output must remain identical.

## How to Run

### Step 1 — Read back all content

Retrieve every piece of block content:
- Page/post content: `wp_cli post get <id> --field=post_content` for each page/post
- Template part files: Read header.html, footer.html, and any other template parts from disk

You need the full current content to plan the conversion.

### Step 2 — Plan the conversion section-by-section

For each section of content, decide what converts to native blocks and what stays as `core/html`:

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

Keep `core/html` ONLY for content with no native block equivalent:
- Inline SVGs (icons, illustrations, decorative graphics)
- `<form>` elements and interactive inputs
- `<canvas>`, `<iframe>`, `<video>`, `<audio>`
- Animation/interaction markup (marquee, custom cursor, scroll-triggered elements)
- Elements needing custom `data-*` attributes for JS interactivity
- A single `<script>` block at the bottom of the page for frontend JS

All CSS classes from the original design stay in style.css — the visual output must remain identical after conversion.

### Step 3 — Write the converted content

Rewrite the full content for each page/post and template part using native Gutenberg block markup. Use the block patterns below as reference. Update posts via `wp_cli post update` and template parts via Write/Edit.

### Step 4 — Validate block markup

Run `validate_blocks` on every piece of converted content to catch markup errors (missing attributes, invalid nesting, malformed block comments). If it flags invalid blocks, fix the markup and re-run until all blocks pass.

### Step 5 — Final visual check

Take screenshots (desktop + mobile) to confirm the conversion did not break the design. Fix any visual regressions — the site must look identical to the original.

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

## Nesting blocks

Sections are built by nesting blocks inside `core/group`. All visual styling (grid layouts, spacing, colors, backgrounds, animations) goes in `style.css` targeting the `className`. The block structure is for editability; the CSS is for aesthetics.

## Additional rules

- Never use `core/html` to wrap text content, headings, layout sections, or lists.
- No decorative HTML comments (e.g. `<!-- Hero Section -->`, `<!-- Features -->`). Only block delimiter comments are allowed.
- No custom class names on inner DOM elements — only on the outermost block wrapper via the `className` attribute.
- No inline `style` or `style` block attributes for styling. Use `className` + `style.css` instead.
- Use `core/spacer` for empty spacing divs, not `core/group`.
- No emojis anywhere in generated content.
- Adding `data-*` attributes does NOT make a block acceptable — use `className` on `core/group` blocks instead.
