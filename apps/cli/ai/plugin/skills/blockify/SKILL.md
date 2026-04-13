---
name: blockify
description: Convert all core/html blocks in a WordPress site to native Gutenberg blocks. Run this after building a site (Phase 2) or on any existing site that uses custom HTML blocks.
user-invokable: true
---

# Block Conversion (Blockify)

Convert all `core/html` blocks in a site's pages, posts, and template parts to native Gutenberg blocks. The CSS stays untouched — the visual output must remain identical.

## How to Run

### Step 1 — Read back all content

Retrieve every piece of block content. You MUST read ALL of these before proceeding:
- Page/post content: `wp_cli post list --post_type=page,post --fields=ID,post_title` then `wp_cli post get <id> --field=post_content` for each
- Template part files: Read header.html, footer.html, and ALL other template part files from the theme's `parts/` directory

Do NOT skip template parts — they often contain navigation, hero sections, or footer content that needs conversion.

### Step 2 — Plan the conversion element-by-element

**CRITICAL: Always decompose.** Never keep an entire section as `core/html` just because it contains some non-convertible sub-elements. Break the section apart: convert every convertible element to native blocks and isolate only the truly non-convertible elements as individual `core/html` blocks.

For example, a hero section with a heading, paragraph, buttons, image, AND a scroll-indicator animation should become: `core/group` > `core/heading` + `core/paragraph` + `core/buttons` + `core/image` + `core/html` (scroll indicator only). Do NOT keep the entire hero as `core/html`.

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

Keep `core/html` ONLY for individual elements with no native block equivalent:
- Inline SVGs (icons, illustrations, decorative graphics)
- `<form>` elements and interactive inputs
- `<canvas>`, `<iframe>`, `<video>`, `<audio>`
- Animation/interaction markup (marquee, custom cursor, scroll-triggered elements)
- Elements needing custom `data-*` attributes for JS interactivity
- `<script>` tags — always extract into their own separate `core/html` block, never bundled with structural content

**Things that are NOT valid reasons to keep an element as `core/html`:**
- `id` attributes — `core/group` supports `anchor` for element IDs
- Inline `<em>`, `<strong>`, `<br>`, `<a>` inside text — `core/heading` and `core/paragraph` support inline HTML
- `loading="eager"` on images — drop the attribute rather than keeping the whole section as HTML
- A single non-convertible child — decompose the section instead of skipping it entirely
- Small text-containing `<div>` or `<span>` elements (eyebrow text, labels, captions, taglines) — convert to `core/paragraph` with the appropriate `className`
- Decorative wrapper `<div>` elements — convert to `core/group` with `className`

**Be thorough.** Convert every single element that has a native block equivalent. Do not leave small or simple elements as `core/html` out of convenience. A `<div>` with text inside it is a `core/paragraph` or `core/group`, not a Custom HTML block.

All CSS classes from the original design stay in style.css — the visual output must remain identical after conversion.

### Step 3 — Write the converted content

Rewrite the full content for each page/post and template part using native Gutenberg block markup. Use the block patterns below as reference. Update posts via `wp_cli post update` and template parts via Write/Edit.

**IMPORTANT — Fix CSS conflicts after conversion.** Native Gutenberg blocks add wrapper elements with default styles (e.g., `core/button` adds `.wp-block-button` and `.wp-block-button__link.wp-element-button` with their own border, padding, and background). These default styles will stack on top of your Phase 1 CSS and cause visual regressions like double borders on buttons. After converting, update `style.css` to reset the default block styles that conflict with your design. Common fixes:
- Buttons: Reset `.wp-block-button__link` border, padding, and background so only your custom class styles apply.
- Groups: Reset `.wp-block-group` padding/margin if it conflicts with your section spacing.
- Columns: Reset `.wp-block-columns` gap if it overrides your grid spacing.

### Step 4 — Validate block markup

Run `validate_blocks` on every piece of converted content to catch markup errors (missing attributes, invalid nesting, malformed block comments). If it flags invalid blocks, fix the markup and re-run until all blocks pass.

### Step 5 — Visual regression check

Take screenshots (desktop + mobile) and compare them against the Phase 1 screenshots you already have in context. The site must look identical to the Phase 1 result. Look specifically for these common regressions introduced by block conversion:

- **Double borders or backgrounds on buttons** — `core/button` adds `.wp-block-button__link` with default border/background that stacks on your CSS
- **Extra padding or spacing around sections** — `core/group` and `.wp-block-columns` add default padding/gap
- **Missing background colors or gradients** — elements that had inline styles may lose them when converted to blocks
- **Font size or weight changes** — block defaults may override your typography
- **Broken hover/active states** — interactive styles may target the old selectors

If any regressions are found, update `style.css` to fix the conflicts (typically by resetting default block styles for the affected classes), then re-screenshot and compare again. Iterate until the design matches Phase 1 exactly.

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
