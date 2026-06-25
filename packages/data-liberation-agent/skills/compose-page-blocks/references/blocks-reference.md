# Block markup reference

Concrete examples for the blocks `compose-page-blocks` is allowed to emit. Each example round-trips through `parse_blocks()` cleanly. Adapt slugs (`accent-primary`, `surface-raised`, etc.) to match what the run's `design-foundation.json` defines.

## Heading

```html
<!-- wp:heading {"level":2,"className":"is-style-display"} -->
<h2 class="wp-block-heading is-style-display">Section title text from source</h2>
<!-- /wp:heading -->
```

Use `level` 2 or 3 inside `post_content` (the post title is already `<h1>`). Pull text verbatim from the source's matching heading element.

## Paragraph

```html
<!-- wp:paragraph -->
<p>Paragraph copy taken verbatim from the source.</p>
<!-- /wp:paragraph -->
```

Inline markup like `<strong>`, `<em>`, `<a>` is preserved inside `<p>` content; do not wrap them in extra blocks.

## Image (single)

```html
<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large">
  <img src="https://example.com/hero.jpg" alt="Hero image alt text from source"/>
</figure>
<!-- /wp:image -->
```

Always emit the source-domain URL — the streaming loop's `media-url-rewrite` step swaps it to the local upload URL after compose. Always include `alt`; pull from the source `<img alt>` attribute.

## Cover (hero)

Use for a large headline + subtext (and optional CTA) over a background image.

```html
<!-- wp:cover {"url":"https://example.com/hero.jpg","dimRatio":40,"overlayColor":"surface-inverse","className":"is-style-hero"} -->
<div class="wp-block-cover is-style-hero">
  <span aria-hidden="true" class="wp-block-cover__background has-surface-inverse-background-color has-background-dim-40 has-background-dim"></span>
  <img class="wp-block-cover__image-background" alt="" src="https://example.com/hero.jpg" data-object-fit="cover"/>
  <div class="wp-block-cover__inner-container">
    <!-- wp:heading {"textAlign":"center","level":1,"textColor":"text-inverse"} -->
    <h1 class="wp-block-heading has-text-align-center has-text-inverse-color has-text-color">Headline text from the source hero</h1>
    <!-- /wp:heading -->

    <!-- wp:paragraph {"align":"center","textColor":"text-inverse"} -->
    <p class="has-text-align-center has-text-inverse-color has-text-color">Subhead from the source.</p>
    <!-- /wp:paragraph -->
  </div>
</div>
<!-- /wp:cover -->
```

When no hero background image exists in the source, drop the cover and use `wp:group` with `align: full` and a `backgroundColor` slug.

## Columns

```html
<!-- wp:columns {"verticalAlignment":"top","align":"wide"} -->
<div class="wp-block-columns alignwide are-vertically-aligned-top">
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:heading {"level":3} -->
    <h3 class="wp-block-heading">Card title (from source)</h3>
    <!-- /wp:heading -->

    <!-- wp:paragraph -->
    <p>Card body (from source).</p>
    <!-- /wp:paragraph -->
  </div>
  <!-- /wp:column -->

  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- ... second card ... -->
  </div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->
```

Preserve the column count from the source. `align: wide` for "almost full-bleed"; `align: full` for full-bleed.

## Group (full-bleed section)

```html
<!-- wp:group {"align":"full","backgroundColor":"surface-raised","layout":{"type":"constrained"},"className":"is-style-soft-card"} -->
<div class="wp-block-group alignfull has-surface-raised-background-color has-background is-style-soft-card">
  <!-- wp:heading -->
  <h2 class="wp-block-heading">Section heading</h2>
  <!-- /wp:heading -->

  <!-- wp:paragraph -->
  <p>Section body.</p>
  <!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
```

`backgroundColor` references a palette slug from `theme.json` (defined by `design-foundations`). Never inline a hex.

## Buttons (CTA)

```html
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
  <!-- wp:button {"backgroundColor":"accent-primary","textColor":"text-inverse"} -->
  <div class="wp-block-button">
    <a class="wp-block-button__link has-text-inverse-color has-accent-primary-background-color has-text-color has-background wp-element-button" href="/contact">Book a Demo</a>
  </div>
  <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
```

Pull the button label and `href` from the source `<a>`. Map the visible button color to the closest accent slug (`accent-primary` for the dominant CTA, `accent-warning` for urgent, `accent-warm` for secondary).

## Gallery

```html
<!-- wp:gallery {"linkTo":"none","columns":3} -->
<figure class="wp-block-gallery has-nested-images columns-3 is-cropped">
  <!-- wp:image {"sizeSlug":"large"} -->
  <figure class="wp-block-image size-large"><img src="https://example.com/img-1.jpg" alt="Alt 1"/></figure>
  <!-- /wp:image -->

  <!-- wp:image {"sizeSlug":"large"} -->
  <figure class="wp-block-image size-large"><img src="https://example.com/img-2.jpg" alt="Alt 2"/></figure>
  <!-- /wp:image -->

  <!-- wp:image {"sizeSlug":"large"} -->
  <figure class="wp-block-image size-large"><img src="https://example.com/img-3.jpg" alt="Alt 3"/></figure>
  <!-- /wp:image -->
</figure>
<!-- /wp:gallery -->
```

Reach for `wp:gallery` at 3+ images. Two images side-by-side belong in `wp:columns` instead.

## Details (FAQ / accordion)

```html
<!-- wp:details -->
<details class="wp-block-details">
  <summary>Question text from source</summary>
  <!-- wp:paragraph -->
  <p>Answer text from source.</p>
  <!-- /wp:paragraph -->
</details>
<!-- /wp:details -->
```

Use one `wp:details` per FAQ row. Group multiple inside a `wp:group` with a heading.

## Quote

```html
<!-- wp:quote {"className":"is-style-large"} -->
<blockquote class="wp-block-quote is-style-large">
  <!-- wp:paragraph -->
  <p>"Customer testimonial copy verbatim from source."</p>
  <!-- /wp:paragraph -->
  <cite>Source name from the testimonial</cite>
</blockquote>
<!-- /wp:quote -->
```

## Separator

```html
<!-- wp:separator {"className":"is-style-wide"} -->
<hr class="wp-block-separator has-alpha-channel-opacity is-style-wide"/>
<!-- /wp:separator -->
```

Use sparingly — only when the source has a visible divider between sections that the surface change alone doesn't communicate.
