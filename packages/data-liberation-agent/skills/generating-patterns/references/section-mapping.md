# Section mapping — interaction models → WP block templates

This file has one block markup template per interaction model. The pattern generator (step 10 of `/liberate`) picks the template matching the spec file's `Interaction model` field, fills the `{{placeholders}}` from the spec's `Generation instructions` section, and writes the result to `theme/patterns/section-<n>.php`.

**Every template assumes the `theme/patterns/` directory exists and the theme's `style.css` is present.** Image paths use `<?php echo esc_url( get_theme_file_uri('assets/img-XX.ext') ); ?>` so the deployed theme serves them from `wp-content/themes/<slug>/assets/`. Do NOT curl CDN URLs — reuse media already uploaded to the WP library (uploaded WP URLs) or theme-shipped assets from the pipeline's `<outputDir>/assets/` directory.

## The brightness rule (applies to every template)

Before picking a template, check `analysis.tokens.body.bg` brightness:

```
brightness = (0.299 * R + 0.587 * G + 0.114 * B)
```

- If brightness **≥ 200** (light/near-white base): **do not use `core/cover` as the top-level container.** The cover block forces inner text to white on an overlay, which produces invisible headings on light backgrounds. Use `core/group` with explicit `textColor="contrast"` instead. All templates below marked "⚠ cover-variant" have a paired "light-variant" — pick the right one.
- If brightness **< 200** (dark base): `core/cover` is fine and the cover's default white text reads correctly.

## The gradient rule

**Skip entirely when the spec marks the gradient source as `pageBackground` or `inherited`.** In that case the `<body>` (or a preceding section) already paints the gradient and re-emitting it per-pattern produces visible stripes. Leave the outer `core/group` with no `backgroundColor` and no `style.background`.

If the spec's **Background gradient** field is set AND `effectiveBg.source` is `wrapper` / `ancestor` / `sibling` (i.e. a locally-scoped gradient, not a page-level one), emit the outer `core/group` with `style.background.gradient` set to the captured string verbatim and **omit** `backgroundColor` / the `backgroundColor` slug. Gradients win over flat colors.

Compute brightness against the *dominant stop* (largest-area color) to pick the text color, not against `{{BG_COLOR}}`. For a simple two-stop gradient, pick the stop closer to where headlines sit in the layout — first stop for top-heavy sections, last stop for bottom-heavy.

Example `core/group` opening tag with a gradient:

```html
<!-- wp:group {"align":"full","style":{"background":{"gradient":"{{BG_GRADIENT}}"},"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}}},"textColor":"contrast","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-contrast-color has-text-color" style="background:{{BG_GRADIENT}}">
  <!-- ...inner blocks... -->
</div>
<!-- /wp:group -->
```

When `{{BG_GRADIENT}}` is `n/a`, fall back to `backgroundColor:{{BG_COLOR_SLUG}}` as every template currently does.

## The divider rule

If the spec's **Divider above** field is set, emit this block **before** the pattern's `core/group` opens. If **Divider below** is set, emit it **after** the group closes. Do NOT emit a divider for a section without a captured divider — false-positive rules between sections look worse than missing ones.

```html
<!-- wp:separator {"align":"full","style":{"color":{"background":"{{DIVIDER_COLOR}}"},"spacing":{"margin":{"top":"0","bottom":"0"}}},"className":"is-style-wide"} -->
<hr class="wp-block-separator alignfull has-text-color has-background is-style-wide" style="background-color:{{DIVIDER_COLOR}};color:{{DIVIDER_COLOR}};margin-top:0;margin-bottom:0" />
<!-- /wp:separator -->
```

`{{DIVIDER_COLOR}}` is the `color` field from `sections[i].dividerAbove` / `dividerBelow` (e.g. `rgba(255,255,255,0.15)`). Keep the margin zero so the rule sits flush against the section it brackets.

## The styling rule — block attributes win over theme CSS

**When a pattern needs a layout, padding, background color, gap, or button color that differs from the theme default, emit it as a block attribute — not as a `className` + CSS rule in `theme/style.css`.**

WP's block-library CSS (`.wp-block-group.is-layout-flex`, `.wp-element-button`, `.wp-block-buttons`, …) is loaded on the front end after the theme's stylesheet and carries at least equal specificity to `.your-custom-class`. A rule like `.service-row { display: flex; padding: 1.5rem 2rem; }` in `style.css` will silently lose to `.wp-block-group.is-layout-flow { ... }` and the pattern renders wrong.

Prefer (inline attributes):

```html
<!-- wp:group {"className":"service-row","backgroundColor":"primary","style":{"spacing":{"padding":{"top":"1.5rem","right":"2rem","bottom":"1.5rem","left":"2rem"}}},"layout":{"type":"flex","flexWrap":"wrap","justifyContent":"space-between","verticalAlignment":"center"}} -->
<div class="wp-block-group service-row has-primary-background-color has-background" style="padding:1.5rem 2rem">…</div>
<!-- /wp:group -->
```

Avoid (CSS class + external rule):

```html
<!-- wp:group {"className":"service-row"} -->
<div class="wp-block-group service-row">…</div>
<!-- /wp:group -->
```
```css
/* style.css — silently loses to WP's .wp-block-group.is-layout-flex */
.service-row { display: flex; padding: 1.5rem 2rem; background: #0038ff; }
```

**Pattern cites design.md, not raw captures.** Every template fills `{{...}}` placeholders from two sources: the per-section spec file (content, local image paths, gradient/divider flags) **and** `design.md` (palette slugs, radius scale, shadow stack, typography sizes, button styling). If a spec says `Background gradient: n/a` but `design.md`'s Color Palette & Roles table shows the section sits on a page-wide body gradient, respect the design brief — don't re-paint the gradient per pattern. When the two sources disagree, pause and reconcile before emitting; visual QA will catch it otherwise.

**What `theme/style.css` is still good for:**
- `@font-face` and `@import` font rules
- Element-level tweaks on the unlayered host (`body`, `a:hover` color, smooth scroll)
- Utility classes that are purely visual (not structural) and that tolerate being overridden — e.g. opacity bylines.
- Theme-scoped motion classes (`.clone-reveal`, `.clone-marquee`, hover overlays), always with `prefers-reduced-motion` fallbacks.

**What it is NOT good for:**
- Flex/grid layouts on blocks — use `"layout":{"type":"flex"/"grid"}` in block attributes.
- Padding, margin, gap — use `"style":{"spacing":...}`.
- Background color/gradient — use `"backgroundColor":"<slug>"` or `"style":{"background":...}`.
- Button colors — use `"backgroundColor"` / `"textColor"` on the `core/button`, not CSS descendant selectors.
- Block-specific typography — use `"fontSize":"<slug>"` and `"style":{"typography":...}` on the heading/paragraph block.

If a future Site Editor user changes a block's styling, inline attributes persist through serialization; CSS-class rules get orphaned.

## Header and footer

**Do not re-derive nav or footer blocks from scratch.** Our pipeline ships a dynamic block-header (nav links → local pages, logo, CTA button, overlay-vs-solid treatment derived from the source). Reuse it by referencing our existing `parts/header.html` template part.

- **`nav`** — part of `parts/header.html`. Our existing header emits one `core/navigation-link` per local page from the extracted sitemap. Do not hardcode nav items inside patterns.
- **`footer`** — always a template part (`parts/footer.html`), not a pattern. The footer spec drives the template-part contents (site title, copyright, contact info, social links).

## Template catalog

### ⛔ Every text placeholder is filled SOURCE-VERBATIM — never paraphrased

Across **every** template below, the text placeholders — `{{HEADING}}`, `{{SUBHEADING}}`, `{{BODY}}`, `{{LABEL}}`, `{{BUTTON_LABEL}}`, `{{column.heading}}`, `{{column.body}}`, `{{card.title}}`, `{{review.quote}}`, etc. — are filled with the source's **captured text, reproduced verbatim**, from the section spec:

- `{{HEADING}}` / `{{SUBHEADING}}` / `{{LABEL}}` / `{{BUTTON_LABEL}}` ← `spec.headings`, `spec.buttonLabels`.
- `{{BODY}}` and any paragraph/list text ← `spec.bodyText` (every captured `<p>`/`<li>`, verbatim). If the exact line for a slot isn't in `spec.bodyText`, re-read the captured `html/<slug>.html` and pull it; if the source has no such text, omit the slot or use the missing-content placeholder. **Never write your own body copy.**
- `{{review.*}}` ← `spec.reviews` (see `review-grid`).

Only mechanical renderings may differ from the raw source: HTML-entity encoding, whitespace collapse, and typographic-glyph folding (smart quotes ↔ straight, en/em dash ↔ hyphen, ellipsis ↔ `...`). A reworded `{{BODY}}` **HARD-FAILS** `liberate_validate_artifacts` (body copy must be substantially contained in `spec.expectedText` ∪ `spec.bodyText`) — it is a gate error, not a warning, and must not be bypassed. This is the cardinal rule of the generating-patterns skill; see its SKILL.md.

Each template below takes placeholder variables and emits valid WP block markup. After filling placeholders, wrap the result in the pattern file header:

```php
<?php
/**
 * Title: <human-readable title>
 * Slug: <theme-slug>/section-<n>
 * Categories: featured
 */
?>
<!-- block markup here -->
```

---

### `cover-with-headline` ⚠ cover-variant

A hero with a background image, centered headline, optional subheading, optional CTA button.

**Placeholders:** `{{BG_IMAGE}}` (theme-relative asset path or omit for flat color), `{{BG_COLOR}}`, `{{HEADING}}`, `{{SUBHEADING}}`, `{{BUTTON_LABEL}}`, `{{BUTTON_HREF}}`, `{{MIN_HEIGHT_VH}}`.

**Dark-base variant (brightness < 200):**

```html
<!-- wp:cover {"url":"<?php echo esc_url( get_theme_file_uri('{{BG_IMAGE}}') ); ?>","dimRatio":30,"minHeight":{{MIN_HEIGHT_VH}},"minHeightUnit":"vh","align":"full","overlayColor":"contrast"} -->
<div class="wp-block-cover alignfull" style="min-height:{{MIN_HEIGHT_VH}}vh">
  <span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim"></span>
  <img class="wp-block-cover__image-background" src="<?php echo esc_url( get_theme_file_uri('{{BG_IMAGE}}') ); ?>" alt="" />
  <div class="wp-block-cover__inner-container">
    <!-- wp:heading {"level":1,"textAlign":"center","fontSize":"xx-large"} -->
    <h1 class="wp-block-heading has-text-align-center has-xx-large-font-size">{{HEADING}}</h1>
    <!-- /wp:heading -->
    <!-- wp:paragraph {"align":"center","fontSize":"large"} -->
    <p class="has-text-align-center has-large-font-size">{{SUBHEADING}}</p>
    <!-- /wp:paragraph -->
    <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
    <div class="wp-block-buttons">
      <!-- wp:button -->
      <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{BUTTON_HREF}}">{{BUTTON_LABEL}}</a></div>
      <!-- /wp:button -->
    </div>
    <!-- /wp:buttons -->
  </div>
</div>
<!-- /wp:cover -->
```

**Light-base variant (brightness ≥ 200):** do not use `core/cover`. Use `core/group` with an inline background image via `style.background`:

```html
<!-- wp:group {"align":"full","style":{"background":{"backgroundImage":{"url":"<?php echo esc_url( get_theme_file_uri('{{BG_IMAGE}}') ); ?>","source":"file"},"backgroundSize":"cover","backgroundPosition":"center"},"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}},"minHeight":"{{MIN_HEIGHT_VH}}vh"},"textColor":"contrast","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-contrast-color has-text-color" style="min-height:{{MIN_HEIGHT_VH}}vh">
  <!-- wp:heading {"level":1,"textAlign":"center","fontSize":"xx-large","textColor":"contrast"} -->
  <h1 class="wp-block-heading has-text-align-center has-contrast-color has-text-color has-xx-large-font-size">{{HEADING}}</h1>
  <!-- /wp:heading -->
  <!-- wp:paragraph {"align":"center","fontSize":"large","textColor":"contrast"} -->
  <p class="has-text-align-center has-contrast-color has-text-color has-large-font-size">{{SUBHEADING}}</p>
  <!-- /wp:paragraph -->
  <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
  <div class="wp-block-buttons">
    <!-- wp:button -->
    <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{BUTTON_HREF}}">{{BUTTON_LABEL}}</a></div>
    <!-- /wp:button -->
  </div>
  <!-- /wp:buttons -->
</div>
<!-- /wp:group -->
```

If `{{BG_IMAGE}}` is empty (flat color hero), omit the `backgroundImage` style entirely and set `backgroundColor` to `{{BG_COLOR}}`.

---

### `media-text`

An image beside a headline + paragraph + optional button. Used for "feature" sections that pair one image with copy.

**Placeholders:** `{{IMAGE_PATH}}`, `{{IMAGE_ALT}}`, `{{MEDIA_POSITION}}` (`left` or `right`), `{{HEADING}}`, `{{BODY}}`, `{{BUTTON_LABEL}}`, `{{BUTTON_HREF}}`.

```html
<!-- wp:media-text {"align":"wide","mediaPosition":"{{MEDIA_POSITION}}","mediaLink":"<?php echo esc_url( get_theme_file_uri('{{IMAGE_PATH}}') ); ?>","mediaType":"image"} -->
<div class="wp-block-media-text alignwide is-stacked-on-mobile {{IF_RIGHT}}has-media-on-the-right{{/IF_RIGHT}}">
  <figure class="wp-block-media-text__media"><img src="<?php echo esc_url( get_theme_file_uri('{{IMAGE_PATH}}') ); ?>" alt="{{IMAGE_ALT}}" /></figure>
  <div class="wp-block-media-text__content">
    <!-- wp:heading {"level":2} --><h2 class="wp-block-heading">{{HEADING}}</h2><!-- /wp:heading -->
    <!-- wp:paragraph --><p>{{BODY}}</p><!-- /wp:paragraph -->
    <!-- wp:buttons -->
    <div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{BUTTON_HREF}}">{{BUTTON_LABEL}}</a></div><!-- /wp:button --></div>
    <!-- /wp:buttons -->
  </div>
</div>
<!-- /wp:media-text -->
```

Remove the `<!-- wp:buttons -->` block if the spec file says `{{BUTTON_LABEL}} = n/a`. Replace `{{IF_RIGHT}}...{{/IF_RIGHT}}` with the class only when `mediaPosition=right`.

---

### `columns`

A row of N cards, each with a heading and a paragraph (and optionally an icon/image). Used for feature grids.

**Placeholders:** `{{COLUMN_COUNT}}`, `{{HEADING}}` (section headline above the row), `{{COLUMNS}}` (array of `{ heading, body, image_path?, image_alt? }`), `{{BG_COLOR}}`.

Emit one `<!-- wp:column -->` block per entry in `{{COLUMNS}}`. Pattern:

```html
<!-- wp:group {"align":"wide","backgroundColor":"{{BG_COLOR_SLUG}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide has-{{BG_COLOR_SLUG}}-background-color has-background">
  <!-- wp:heading {"textAlign":"center","level":2} --><h2 class="wp-block-heading has-text-align-center">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- wp:columns -->
  <div class="wp-block-columns">
    <!-- FOREACH column in {{COLUMNS}}: -->
    <!-- wp:column -->
    <div class="wp-block-column">
      <!-- IF column.image_path: -->
      <!-- wp:image {"sizeSlug":"full"} -->
      <figure class="wp-block-image size-full"><img src="<?php echo esc_url( get_theme_file_uri('{{column.image_path}}') ); ?>" alt="{{column.image_alt}}" /></figure>
      <!-- /wp:image -->
      <!-- END IF -->
      <!-- wp:heading {"level":3} --><h3 class="wp-block-heading">{{column.heading}}</h3><!-- /wp:heading -->
      <!-- wp:paragraph --><p>{{column.body}}</p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:column -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

---

### `gallery`

A multi-image grid. Use for any section whose spec lists 4+ images and minimal text.

**Placeholders:** `{{IMAGES}}` (array of `{ path, alt }`), `{{COLUMNS}}` (computed via gallery heuristic below), `{{HEADING}}` (optional section headline).

**Column count heuristic:**

```
columns = clamp(round(sqrt(imageCount)), 2, 6)
```

If images are clearly portrait-oriented (avg h > avg w), reduce by 1.

```html
<!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide">
  <!-- IF {{HEADING}} -->
  <!-- wp:heading {"textAlign":"center","level":2} --><h2 class="wp-block-heading has-text-align-center">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- END IF -->
  <!-- wp:gallery {"columns":{{COLUMNS}},"linkTo":"none","align":"wide"} -->
  <figure class="wp-block-gallery has-nested-images columns-{{COLUMNS}} is-cropped alignwide">
    <!-- FOREACH img in {{IMAGES}}: -->
    <!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
    <figure class="wp-block-image size-large"><img src="<?php echo esc_url( get_theme_file_uri('{{img.path}}') ); ?>" alt="{{img.alt}}" /></figure>
    <!-- /wp:image -->
    <!-- END FOREACH -->
  </figure>
  <!-- /wp:gallery -->
</div>
<!-- /wp:group -->
```

---

### `animated-cover`

Same content model as `cover-with-headline`, but the spec's Motion profile requires a simple preserved entry reveal. Use this only for CSS-only opacity/transform reveals; complex pinned timelines remain `cover-with-headline` plus a notes entry.

**Placeholders:** same as `cover-with-headline`, plus `{{REVEAL_DURATION_MS}}`, `{{REVEAL_DELAY_MS}}`, and `{{REVEAL_TRANSFORM}}`.

Implementation: emit the normal cover/group variant, add class `clone-reveal` to the inner container, and add theme-scoped CSS:

```css
.clone-reveal { animation: clone-reveal {{REVEAL_DURATION_MS}}ms ease both; animation-delay: {{REVEAL_DELAY_MS}}ms; }
@keyframes clone-reveal { from { opacity: 0; transform: {{REVEAL_TRANSFORM}}; } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .clone-reveal { animation: none; opacity: 1; transform: none; } }
```

---

### `horizontal-showcase`

A wide, horizontally-scanned showcase used by portfolio strips, laptop mockup rows, and dark agency case-study ribbons. Prefer this over `gallery` when the source emphasizes lateral movement or oversized cards.

**Placeholders:** `{{HEADING}}`, `{{ITEMS}}` (array of `{ image_path, image_alt, title, body, href }`), `{{BG_COLOR_SLUG}}`, `{{TEXT_COLOR_SLUG}}`.

```html
<!-- wp:group {"align":"full","backgroundColor":"{{BG_COLOR_SLUG}}","textColor":"{{TEXT_COLOR_SLUG}}","className":"clone-horizontal-showcase","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull clone-horizontal-showcase has-{{BG_COLOR_SLUG}}-background-color has-{{TEXT_COLOR_SLUG}}-color has-background has-text-color">
  <!-- IF {{HEADING}} -->
  <!-- wp:heading {"level":2} --><h2 class="wp-block-heading">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- END IF -->
  <!-- wp:group {"align":"wide","className":"clone-horizontal-showcase__track","layout":{"type":"flex","flexWrap":"nowrap"}} -->
  <div class="wp-block-group alignwide clone-horizontal-showcase__track">
    <!-- FOREACH item in {{ITEMS}}: -->
    <!-- wp:group {"className":"clone-horizontal-showcase__item","layout":{"type":"constrained"}} -->
    <div class="wp-block-group clone-horizontal-showcase__item">
      <!-- wp:image {"sizeSlug":"large"} -->
      <figure class="wp-block-image size-large"><img src="<?php echo esc_url( get_theme_file_uri('{{item.image_path}}') ); ?>" alt="{{item.image_alt}}" /></figure>
      <!-- /wp:image -->
      <!-- wp:heading {"level":3,"fontSize":"medium"} --><h3 class="wp-block-heading has-medium-font-size">{{item.title}}</h3><!-- /wp:heading -->
      <!-- wp:paragraph {"fontSize":"small"} --><p class="has-small-font-size">{{item.body}}</p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:group -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:group -->
</div>
<!-- /wp:group -->
```

Add CSS for overflow-x scrolling on small screens. Do not hide off-screen cards on mobile.

---

### `project-card-grid`

A portfolio/case-study grid where each card has an image, title, service/meta text, and optional CTA. Use this instead of generic `columns` for project listings, especially when the source uses hover overlays or full-card links.

**Placeholders:** `{{HEADING}}`, `{{PROJECTS}}` (array of `{ image_path, image_alt, title, meta, href, cta }`), `{{COLUMNS}}`, `{{MOTION_CLASS}}` (`none` or `clone-hover-overlay`).

```html
<!-- wp:group {"align":"wide","className":"clone-project-grid {{MOTION_CLASS}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|70","bottom":"var:preset|spacing|70"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide clone-project-grid {{MOTION_CLASS}}">
  <!-- IF {{HEADING}} -->
  <!-- wp:heading {"level":2} --><h2 class="wp-block-heading">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- END IF -->
  <!-- wp:columns {"className":"clone-project-grid__columns"} -->
  <div class="wp-block-columns clone-project-grid__columns">
    <!-- FOREACH project in {{PROJECTS}}: -->
    <!-- wp:column {"className":"clone-project-card"} -->
    <div class="wp-block-column clone-project-card">
      <!-- wp:image {"sizeSlug":"large","linkDestination":"custom"} -->
      <figure class="wp-block-image size-large"><a href="{{project.href}}"><img src="<?php echo esc_url( get_theme_file_uri('{{project.image_path}}') ); ?>" alt="{{project.image_alt}}" /></a></figure>
      <!-- /wp:image -->
      <!-- wp:heading {"level":3,"fontSize":"medium"} --><h3 class="wp-block-heading has-medium-font-size"><a href="{{project.href}}">{{project.title}}</a></h3><!-- /wp:heading -->
      <!-- wp:paragraph {"fontSize":"small"} --><p class="has-small-font-size">{{project.meta}}</p><!-- /wp:paragraph -->
      <!-- IF {{project.cta}} -->
      <!-- wp:paragraph {"fontSize":"small"} --><p class="has-small-font-size"><a href="{{project.href}}">{{project.cta}}</a></p><!-- /wp:paragraph -->
      <!-- END IF -->
    </div>
    <!-- /wp:column -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

For hover-overlay sources, add CSS in `style.css` scoped to `.clone-project-grid.clone-hover-overlay`; mobile must show the title/meta without hover.

For Wix/Studio portfolio grids where desktop and mobile expose different states, preserve both states instead of choosing one. A common pattern is:

- Desktop: text-only black cells with visible borders or dividers; images are hidden until hover or scroll interaction.
- Mobile: horizontal project strip where the same projects expose their images as static cards.

Model this as `project-card-grid` with a note in the spec's Responsive notes and Motion profile. The generated CSS should hide or dim images on desktop, show them on hover when appropriate, and make images visible by default inside an overflow-x mobile strip. Do not replace the desktop source with always-visible image cards if the desktop screenshot is text-first.

---

### `marquee-strip`

A horizontal moving text/logo strip. Use only when the spec's Motion profile is `marquee`; otherwise render as a normal `logo-strip` or paragraph row.

**Placeholders:** `{{ITEMS}}`, `{{DURATION_SECONDS}}`, `{{DIRECTION}}`.

```html
<!-- wp:group {"align":"full","className":"clone-marquee","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull clone-marquee" style="--clone-marquee-duration:{{DURATION_SECONDS}}s">
  <!-- wp:group {"className":"clone-marquee__track","layout":{"type":"flex","flexWrap":"nowrap"}} -->
  <div class="wp-block-group clone-marquee__track">
    <!-- FOREACH item in {{ITEMS}}: -->
    <!-- wp:paragraph --><p>{{item}}</p><!-- /wp:paragraph -->
    <!-- END FOREACH -->
    <!-- Repeat items once so the CSS loop has no visual gap. -->
    <!-- FOREACH item in {{ITEMS}}: -->
    <!-- wp:paragraph {"ariaHidden":true} --><p aria-hidden="true">{{item}}</p><!-- /wp:paragraph -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:group -->
</div>
<!-- /wp:group -->
```

Required CSS:

```css
.clone-marquee { overflow: hidden; }
.clone-marquee__track { animation: clone-marquee var(--clone-marquee-duration, 24s) linear infinite; min-width: max-content; }
.clone-marquee:hover .clone-marquee__track { animation-play-state: paused; }
@keyframes clone-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .clone-marquee__track { animation: none; transform: none; } }
```

---

### `logo-strip`

A horizontal row of small uniform logos. Used for "as seen in" press callouts and partner lists.

**Placeholders:** `{{LABEL}}` (e.g. "AS SEEN IN"), `{{LOGOS}}` (array of `{ path, alt }`).

Logo strips are different from galleries — logos are small, uniform, and should have equal column widths. Use `core/columns` with fixed small widths, not `core/gallery`:

```html
<!-- wp:group {"align":"wide","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignwide">
  <!-- wp:heading {"textAlign":"center","level":3,"fontSize":"medium"} --><h3 class="wp-block-heading has-text-align-center has-medium-font-size" style="letter-spacing:0.15em;text-transform:uppercase">{{LABEL}}</h3><!-- /wp:heading -->
  <!-- wp:columns {"verticalAlignment":"center"} -->
  <div class="wp-block-columns are-vertically-aligned-center">
    <!-- FOREACH logo in {{LOGOS}}: -->
    <!-- wp:column {"verticalAlignment":"center"} -->
    <div class="wp-block-column is-vertically-aligned-center">
      <!-- wp:image {"sizeSlug":"medium","align":"center"} -->
      <figure class="wp-block-image aligncenter size-medium"><img src="<?php echo esc_url( get_theme_file_uri('{{logo.path}}') ); ?>" alt="{{logo.alt}}" /></figure>
      <!-- /wp:image -->
    </div>
    <!-- /wp:column -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

---

### `testimonial`

A pull quote with attribution.

**Placeholders:** `{{QUOTE}}`, `{{ATTRIBUTION}}`, `{{BG_COLOR_SLUG}}`.

```html
<!-- wp:group {"align":"full","backgroundColor":"{{BG_COLOR_SLUG}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-{{BG_COLOR_SLUG}}-background-color has-background">
  <!-- wp:quote {"align":"center","fontSize":"x-large"} -->
  <blockquote class="wp-block-quote has-text-align-center has-x-large-font-size">
    <p>{{QUOTE}}</p>
    <cite>{{ATTRIBUTION}}</cite>
  </blockquote>
  <!-- /wp:quote -->
</div>
<!-- /wp:group -->
```

---

### `cta`

A single centered call-to-action block — headline + button, no images.

**Placeholders:** `{{HEADING}}`, `{{BODY}}`, `{{BUTTON_LABEL}}`, `{{BUTTON_HREF}}`, `{{BG_COLOR_SLUG}}`.

```html
<!-- wp:group {"align":"full","backgroundColor":"{{BG_COLOR_SLUG}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-{{BG_COLOR_SLUG}}-background-color has-background">
  <!-- wp:heading {"textAlign":"center","level":2,"fontSize":"xx-large"} --><h2 class="wp-block-heading has-text-align-center has-xx-large-font-size">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- wp:paragraph {"align":"center"} --><p class="has-text-align-center">{{BODY}}</p><!-- /wp:paragraph -->
  <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
  <div class="wp-block-buttons">
    <!-- wp:button -->
    <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{BUTTON_HREF}}">{{BUTTON_LABEL}}</a></div>
    <!-- /wp:button -->
  </div>
  <!-- /wp:buttons -->
</div>
<!-- /wp:group -->
```

---

### `blog-card-grid`

A row of N post cards, each with a featured image, a byline/date, and a linked title. Use this instead of generic `columns` whenever the spec's interaction model is a blog/insights/news listing — the byline order and the linked-title wrapping differ from a plain columns template.

**Classification heuristic (step 3):** 3 or more adjacent columns, each containing one `<img>`, one small-font paragraph (< 14 px, often containing "By" or a date), and one larger-font heading/link.

**Placeholders:** `{{HEADING}}` (section headline), `{{CARDS}}` (array of `{ image_path, image_alt, byline, title, href }`).

**Byline ordering:** always *below* the image and *above* the title. Even if the source captured the byline at an unusual position, normalize to this order — it's what every WP theme does for post cards and it reads correctly.

```html
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80","left":"var:preset|spacing|70","right":"var:preset|spacing|70"},"blockGap":"var:preset|spacing|70"}},"textColor":"contrast","layout":{"type":"constrained","wideSize":"1280px"}} -->
<div class="wp-block-group alignfull has-contrast-color has-text-color" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--70)">
<!-- wp:heading {"level":2,"fontSize":"xx-large"} -->
<h2 class="wp-block-heading has-xx-large-font-size">{{HEADING}}</h2>
<!-- /wp:heading -->
<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
<!-- FOREACH card in {{CARDS}}: -->
<!-- wp:column {"className":"insight-card"} -->
<div class="wp-block-column insight-card">
<!-- wp:image {"sizeSlug":"large","linkDestination":"none","style":{"border":{"radius":"4px"}}} -->
<figure class="wp-block-image size-large has-custom-border"><img src="<?php echo esc_url( get_theme_file_uri('{{card.image_path}}') ); ?>" alt="{{card.image_alt}}" style="border-radius:4px" /></figure>
<!-- /wp:image -->
<!-- wp:paragraph {"fontSize":"small","style":{"typography":{"fontStyle":"normal","fontWeight":"400"}},"className":"byline"} -->
<p class="byline has-small-font-size" style="opacity:0.75">{{card.byline}}</p>
<!-- /wp:paragraph -->
<!-- wp:heading {"level":3,"fontSize":"large"} -->
<h3 class="wp-block-heading has-large-font-size"><a href="{{card.href}}">{{card.title}}</a></h3>
<!-- /wp:heading -->
</div>
<!-- /wp:column -->
<!-- END FOREACH -->
</div>
<!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

The `opacity:0.75` on the byline reads as a muted color on any gradient or flat background; avoid shipping a hardcoded `rgba` that will clash with a Site Editor palette swap.

---

### `price-list`

A stack of N horizontal rows, each with a title (left), optional price or meta (center), and a CTA button (right). The row has a solid, typically-branded background color, and the whole stack has spacing between rows. Use this instead of `columns` for services / packages / pricing tiers where each row is a single offer.

**Classification heuristic (step 3):** 2+ horizontally-laid-out groups at the same depth, each containing exactly one heading/title + one CTA button. Extra markers: a currency symbol (`$`, `€`, `£`, `¥`) or a short money-shaped string in each group.

**Placeholders:** `{{HEADING}}` (section headline), `{{ROWS}}` (array of `{ title, price, cta_label, cta_href }`), `{{ROW_BG_SLUG}}` (row background color — usually `primary`), `{{ROW_PAD}}` (padding shorthand, default `1.5rem 2rem`), `{{CTA_BG_SLUG}}` (button bg, usually `base`/`contrast`), `{{CTA_FG_SLUG}}` (button text, usually the complement).

**Rendering guarantees:** emit the row-level `core/group` with `"layout":{"type":"flex","flexWrap":"wrap","justifyContent":"space-between","verticalAlignment":"center"}` — this is the specificity-safe way to get a horizontal row on top of WP's block-library CSS. Use inline `style.spacing.padding` for the row's internal padding. Button colors go on the `core/button` as `backgroundColor`/`textColor` attributes, never as descendant CSS.

```html
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80","left":"var:preset|spacing|70","right":"var:preset|spacing|70"},"blockGap":"var:preset|spacing|50"}},"textColor":"contrast","layout":{"type":"constrained","wideSize":"1280px"}} -->
<div class="wp-block-group alignfull has-contrast-color has-text-color" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--70)">
<!-- wp:heading {"level":2,"fontSize":"xx-large"} -->
<h2 class="wp-block-heading has-xx-large-font-size">{{HEADING}}</h2>
<!-- /wp:heading -->
<!-- FOREACH row in {{ROWS}}: -->
<!-- wp:group {"align":"wide","className":"price-row","backgroundColor":"{{ROW_BG_SLUG}}","style":{"spacing":{"padding":{"top":"1.5rem","right":"2rem","bottom":"1.5rem","left":"2rem"}}},"layout":{"type":"flex","flexWrap":"wrap","justifyContent":"space-between","verticalAlignment":"center"}} -->
<div class="wp-block-group alignwide price-row has-{{ROW_BG_SLUG}}-background-color has-background" style="padding:{{ROW_PAD}}">
<!-- wp:paragraph {"fontSize":"x-large","style":{"typography":{"fontWeight":"500"}}} -->
<p class="has-x-large-font-size" style="font-weight:500">{{row.title}}</p>
<!-- /wp:paragraph -->
<!-- IF {{row.price}}: -->
<!-- wp:paragraph {"fontSize":"medium"} -->
<p class="has-medium-font-size" style="opacity:0.9">{{row.price}}</p>
<!-- /wp:paragraph -->
<!-- END IF -->
<!-- wp:buttons -->
<div class="wp-block-buttons">
<!-- wp:button {"backgroundColor":"{{CTA_BG_SLUG}}","textColor":"{{CTA_FG_SLUG}}","style":{"border":{"radius":"999px"}}} -->
<div class="wp-block-button"><a class="wp-block-button__link has-{{CTA_FG_SLUG}}-color has-{{CTA_BG_SLUG}}-background-color has-text-color has-background wp-element-button" href="{{row.cta_href}}" style="border-radius:999px">{{row.cta_label}}</a></div>
<!-- /wp:button -->
</div>
<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
<!-- END FOREACH -->
</div>
<!-- /wp:group -->
```

If the spec lists more than ~5 rows, consider paginating into a `core/columns` (2 per row) instead — a long vertical stack of full-width price rows reads as a list, not a grid.

---

### `color-block-grid`

A grid where each cell has its own distinct background color (common on bright e-commerce sites). Different from `columns` because each column's background is part of the composition.

**Placeholders:** `{{TILES}}` (array of `{ bg_hex, image_path, image_alt, label? }`).

Emit one `core/cover` per tile inside a `core/columns`:

```html
<!-- wp:columns {"align":"full"} -->
<div class="wp-block-columns alignfull" style="gap:0">
  <!-- FOREACH tile in {{TILES}}: -->
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:cover {"url":"<?php echo esc_url( get_theme_file_uri('{{tile.image_path}}') ); ?>","customOverlayColor":"{{tile.bg_hex}}","dimRatio":0,"minHeight":400,"minHeightUnit":"px"} -->
    <div class="wp-block-cover" style="min-height:400px">
      <span aria-hidden="true" class="wp-block-cover__background has-background-dim-0 has-background-dim" style="background-color:{{tile.bg_hex}}"></span>
      <img class="wp-block-cover__image-background" src="<?php echo esc_url( get_theme_file_uri('{{tile.image_path}}') ); ?>" alt="{{tile.image_alt}}" />
      <div class="wp-block-cover__inner-container">
        <!-- IF {{tile.label}} -->
        <!-- wp:heading {"level":3,"textAlign":"center"} --><h3 class="wp-block-heading has-text-align-center">{{tile.label}}</h3><!-- /wp:heading -->
        <!-- END IF -->
      </div>
    </div>
    <!-- /wp:cover -->
  </div>
  <!-- /wp:column -->
  <!-- END FOREACH -->
</div>
<!-- /wp:columns -->
```

---

### `product-card-row`

A row of N **storefront product cards**, each with a product image, a title, a **price**, and usually an Add-to-Cart / Shop CTA. Common on Shopify/Replo "shop our products" / "Sleep essentials" rows. Use this instead of `project-card-grid` (no price) or `price-list` (no per-card image) whenever the spec's interaction model is `product-card-row`.

**Classification heuristic (step 3):** 2+ adjacent uniform cards, each with one `<img>`, a title, and a money-shaped string (`$99`, `£59`, …). An Add-to-Cart button is common but not required. The price is the discriminator — a titled image grid *without* prices is `project-card-grid`.

**Placeholders:** `{{HEADING}}` (section headline, e.g. "Sleep essentials"), `{{CARDS}}` (array of `{ image_path, image_alt, title, price, cta_label, href }`), `{{COLUMNS}}` (cards per row, usually 2-4).

**Faithfulness rules:**
- Keep the **price verbatim** from the source (currency symbol + amount). Do not invent or round. If the source showed a compare-at / sale price, render both (regular struck-through, then sale) — mirror what the screenshot shows.
- The CTA label is the source's ("Add to Cart", "Shop SNOOZ Original →"). Link `href` to the local product page when one was extracted, else `#`.
- Prefer linking the WP-library product attachment already uploaded by the pipeline; only fall back to a theme asset path when the image is theme-shipped.

```html
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80","left":"var:preset|spacing|70","right":"var:preset|spacing|70"},"blockGap":"var:preset|spacing|60"}},"layout":{"type":"constrained","wideSize":"1280px"}} -->
<div class="wp-block-group alignfull" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--70)">
  <!-- IF {{HEADING}} -->
  <!-- wp:heading {"textAlign":"center","level":2,"fontSize":"xx-large"} --><h2 class="wp-block-heading has-text-align-center has-xx-large-font-size">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- END IF -->
  <!-- wp:columns {"align":"wide","className":"clone-product-row"} -->
  <div class="wp-block-columns alignwide clone-product-row">
    <!-- FOREACH card in {{CARDS}}: -->
    <!-- wp:column {"className":"clone-product-card"} -->
    <div class="wp-block-column clone-product-card">
      <!-- wp:image {"sizeSlug":"large","linkDestination":"custom","style":{"border":{"radius":"8px"}}} -->
      <figure class="wp-block-image size-large has-custom-border"><a href="{{card.href}}"><img src="{{card.image_path}}" alt="{{card.image_alt}}" style="border-radius:8px" /></a></figure>
      <!-- /wp:image -->
      <!-- wp:heading {"level":3,"fontSize":"medium"} --><h3 class="wp-block-heading has-medium-font-size"><a href="{{card.href}}">{{card.title}}</a></h3><!-- /wp:heading -->
      <!-- wp:paragraph {"fontSize":"large","style":{"typography":{"fontWeight":"600"}}} --><p class="has-large-font-size" style="font-weight:600">{{card.price}}</p><!-- /wp:paragraph -->
      <!-- IF {{card.cta_label}} -->
      <!-- wp:buttons -->
      <div class="wp-block-buttons">
        <!-- wp:button {"style":{"border":{"radius":"999px"}}} -->
        <div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="{{card.href}}" style="border-radius:999px">{{card.cta_label}}</a></div>
        <!-- /wp:button -->
      </div>
      <!-- /wp:buttons -->
      <!-- END IF -->
    </div>
    <!-- /wp:column -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

`{{card.image_path}}` is the uploaded WP-library URL (preferred) or a `<?php echo esc_url( get_theme_file_uri('assets/img-XX.ext') ); ?>` theme path. Never curl a CDN URL at render time. If a card's image could not be captured, follow the **missing-media fallback** rule (below) — emit a sized placeholder + a provenance flag, do NOT substitute an unrelated product photo.

---

### `review-grid`

Repeated **customer-review columns**, each with a **star rating**, a quote, and an attribution (name / location). Distinct from the single-quote `testimonial` (one block). Page builders (Replo) and review widgets (Okendo/Junip/Yotpo/Stamped/Loox) render these — often as a carousel — frequently with no `<blockquote>` and anonymous-path star SVGs.

**Classification heuristic (step 3):** 2+ repeated columns, each carrying a star rating (★ glyphs, an "out of 5" / "N reviews" text, a rating-class/widget marker, or a tight uniform row of 4-6 small SVG/img stars) **and** quote-shaped text. A flat (un-columned) widget with a star rating + a quote still maps here.

**Placeholders:** `{{HEADING}}` (e.g. "Why people love sleeping with SNOOZ"), `{{REVIEWS}}` (array of `{ rating, quote, attribution, category? }`, `rating` = integer 1-5), `{{COLUMNS}}` (usually 3), `{{BG_COLOR_SLUG}}`.

**⛔ NEVER synthesize, paraphrase, or invent review text. This is the cardinal rule of this template.** Review/testimonial quotes, author names, and category labels MUST be source-captured verbatim or left as a clearly-marked placeholder. Do NOT write plausible-sounding quotes, do NOT invent "Jess T. — Verified Buyer" attributions, do NOT lightly reword a captured quote. A fabricated testimonial is a fidelity lie *and* a trust/legal problem (it puts invented words in a real customer's mouth). This is the exact mistake an earlier getsnooz build made: it assumed the reviews were JS-only, invented three quotes, and bypassed the provenance gate. The reviews were in the captured HTML the whole time.

**Where the real reviews live (check IN THIS ORDER before ever concluding they're unreachable):**
1. **The `{{REVIEWS}}` array in the spec.** The deterministic extractor (`src/lib/replicate/review-extract.ts`, wired into `liberate_section_extract`) parses the served HTML and emits `spec.reviews` with verbatim `quote` + `category` + `stars` + `author`. **If `spec.reviews` is present, USE IT VERBATIM and stop here** — the sourcing is already done and provenance-clean.
2. **Inline in the captured `html/<slug>.html`.** Page-builder review carousels (Replo, and similar) render *every slide* — quote + star run + byline — directly into the served markup; only the animation is JS. So "the reviews are a JS widget" is usually FALSE. Grep the captured HTML for a review quote fragment, `data-replo-carousel`, `★`, `out of 5`, or the widget container; the slides are right there. Re-run `liberate_section_extract` (or `extractReviewsFromHtml`) on the saved HTML.
3. **Embedded JSON in the served HTML** — `schema.org` `Review` / `aggregateRating`, an `__INITIAL_STATE__` / warmup blob, or a `<script type="application/json">`.
4. **The review widget's data endpoint, fetched via plain GET** — Okendo/Junip/Yotpo/Stamped/Loox/Redo widgets expose a JSON API keyed by shop + product/widget id. Mirror the Wix Pro Gallery `extractGalleryFromHtml` pattern in `src/adapters/wix/gallery.ts` — a GET + parse, no headless browser.

**Only if 1-4 all genuinely fail** does a review band become missing-content. Then use the **missing-content fallback** (below): render the grid structure with placeholdered slots (`[review text not captured]`) and flag it in `run-report.json`. Never paper over the gap with invented prose.

**Faithfulness rules (when reviews ARE captured):**
- Render the rating as the literal star count from the source (default 5 ONLY if the widget explicitly showed "5 stars"; never guess a rating to fill a slot). Use the `★`/`☆` glyph run so it survives without a JS widget — `★★★★★` for 5.
- Keep the quote **verbatim** (including its surrounding quote marks and any nested-bolded opening sentence) and the attribution (name, "Verified Buyer", location) and the category label (e.g. "TRAVEL", "TINNITUS") **exactly** as captured. Every emitted review string must pass the `liberate_validate_artifacts` provenance check (text ⊆ captured source) — and you must NOT bypass that gate.
- If the source is a carousel, render the captured reviews as a static grid (mobile-safe); note the carousel in the spec's Motion profile — do not ship a JS slider. Render all captured reviews (wrap into multiple `wp:columns` rows if there are more than ~4).

```html
<!-- wp:group {"align":"full","backgroundColor":"{{BG_COLOR_SLUG}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80","left":"var:preset|spacing|70","right":"var:preset|spacing|70"},"blockGap":"var:preset|spacing|60"}},"layout":{"type":"constrained","wideSize":"1280px"}} -->
<div class="wp-block-group alignfull has-{{BG_COLOR_SLUG}}-background-color has-background" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--70)">
  <!-- IF {{HEADING}} -->
  <!-- wp:heading {"textAlign":"center","level":2,"fontSize":"xx-large"} --><h2 class="wp-block-heading has-text-align-center has-xx-large-font-size">{{HEADING}}</h2><!-- /wp:heading -->
  <!-- END IF -->
  <!-- wp:columns {"align":"wide"} -->
  <div class="wp-block-columns alignwide">
    <!-- FOREACH review in {{REVIEWS}}: -->
    <!-- wp:column {"className":"clone-review"} -->
    <div class="wp-block-column clone-review">
      <!-- wp:paragraph {"className":"clone-review__stars","fontSize":"medium","style":{"typography":{"letterSpacing":"2px"}}} --><p class="clone-review__stars has-medium-font-size" style="letter-spacing:2px;color:#f5a623">{{review.stars_glyphs}}</p><!-- /wp:paragraph -->
      <!-- wp:paragraph --><p>{{review.quote}}</p><!-- /wp:paragraph -->
      <!-- wp:paragraph {"fontSize":"small","style":{"typography":{"fontWeight":"600"}}} --><p class="has-small-font-size" style="font-weight:600">{{review.attribution}}</p><!-- /wp:paragraph -->
    </div>
    <!-- /wp:column -->
    <!-- END FOREACH -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

`{{review.stars_glyphs}}` = `rating` filled stars + `(5 - rating)` empty (e.g. rating 5 → `★★★★★`, rating 4 → `★★★★☆`). The inline `color:#f5a623` (amber) is the conventional star color; swap to the source's star color if the screenshot shows a different hue.

---

### `app-download`

An **app-download block**: a heading + copy beside an app screenshot, with **app-store / google-play badge images** as the CTA. Common as a "Get the app" / "Smarter sleep starts here" section on D2C storefronts.

**Classification heuristic (step 3):** a section heading plus one or more store-badge images (alt/src/filename matching `app store`, `google play`, `download on the`, `get it on`, `play store`), usually paired with a phone/app screenshot.

**Placeholders:** `{{HEADING}}`, `{{BODY}}`, `{{APP_SHOT_PATH}}` (app screenshot, optional), `{{APP_SHOT_ALT}}`, `{{BADGES}}` (array of `{ image_path, image_alt, href }`, e.g. App Store + Google Play), `{{BG_COLOR_SLUG}}`, `{{MEDIA_POSITION}}` (`left`/`right`).

**Faithfulness rules:**
- Keep the official store badges as **images** linking to the source's store URLs (`href`). The badges are trademarked artwork — capture and reuse them; do not redraw as text buttons.
- If a badge image could not be captured, follow the **missing-media fallback** rule below (sized placeholder + flag) rather than substituting a generic button.

```html
<!-- wp:group {"align":"full","backgroundColor":"{{BG_COLOR_SLUG}}","style":{"spacing":{"padding":{"top":"var:preset|spacing|80","bottom":"var:preset|spacing|80","left":"var:preset|spacing|70","right":"var:preset|spacing|70"}}},"layout":{"type":"constrained","wideSize":"1280px"}} -->
<div class="wp-block-group alignfull has-{{BG_COLOR_SLUG}}-background-color has-background" style="padding-top:var(--wp--preset--spacing--80);padding-right:var(--wp--preset--spacing--70);padding-bottom:var(--wp--preset--spacing--80);padding-left:var(--wp--preset--spacing--70)">
  <!-- wp:columns {"verticalAlignment":"center","align":"wide"} -->
  <div class="wp-block-columns alignwide are-vertically-aligned-center">
    <!-- COLUMN A (text) — emit FIRST when {{MEDIA_POSITION}} is right, else SECOND -->
    <!-- wp:column {"verticalAlignment":"center"} -->
    <div class="wp-block-column is-vertically-aligned-center">
      <!-- wp:heading {"level":2,"fontSize":"xx-large"} --><h2 class="wp-block-heading has-xx-large-font-size">{{HEADING}}</h2><!-- /wp:heading -->
      <!-- wp:paragraph {"fontSize":"medium"} --><p class="has-medium-font-size">{{BODY}}</p><!-- /wp:paragraph -->
      <!-- wp:buttons {"layout":{"type":"flex"}} -->
      <div class="wp-block-buttons">
        <!-- FOREACH badge in {{BADGES}}: -->
        <!-- wp:image {"width":"160px","sizeSlug":"medium","linkDestination":"custom","className":"clone-store-badge"} -->
        <figure class="wp-block-image size-medium is-resized clone-store-badge"><a href="{{badge.href}}"><img src="{{badge.image_path}}" alt="{{badge.image_alt}}" style="width:160px" /></a></figure>
        <!-- /wp:image -->
        <!-- END FOREACH -->
      </div>
      <!-- /wp:buttons -->
    </div>
    <!-- /wp:column -->
    <!-- COLUMN B (app screenshot) -->
    <!-- IF {{APP_SHOT_PATH}} -->
    <!-- wp:column {"verticalAlignment":"center"} -->
    <div class="wp-block-column is-vertically-aligned-center">
      <!-- wp:image {"sizeSlug":"large","align":"center"} -->
      <figure class="wp-block-image aligncenter size-large"><img src="{{APP_SHOT_PATH}}" alt="{{APP_SHOT_ALT}}" /></figure>
      <!-- /wp:image -->
    </div>
    <!-- /wp:column -->
    <!-- END IF -->
  </div>
  <!-- /wp:columns -->
</div>
<!-- /wp:group -->
```

The store-badge `core/image` blocks live inside `core/buttons` only for horizontal flex layout convenience; if that produces invalid nesting in your WP version, wrap them in a `core/group` with `"layout":{"type":"flex"}` instead. Badges sit side-by-side on desktop and stack on mobile.

---

### `cover-with-headline` — email-capture variant

A hero whose CTA is an **email-capture form** ("Get 10% Off" + email field + submit) rather than a link button. Use the base `cover-with-headline` template, but replace the `core/buttons` block with an email form. We do **not** ship a working form backend in the replica, so render a faithful **visual** form (input + button) and stub the submission with an explicit comment.

**Extra placeholders (on top of `cover-with-headline`):** `{{FORM_HEADING}}` (e.g. "Get 10% Off"), `{{INPUT_PLACEHOLDER}}` (e.g. "Enter your email"), `{{SUBMIT_LABEL}}` (e.g. "Sign Up").

Replace the `<!-- wp:buttons ... -->` region of the chosen `cover-with-headline` variant with:

```html
<!-- wp:group {"className":"clone-email-capture","layout":{"type":"flex","flexWrap":"wrap","justifyContent":"center"}} -->
<div class="wp-block-group clone-email-capture">
  <!-- IF {{FORM_HEADING}} -->
  <!-- wp:paragraph {"align":"center","fontSize":"medium","style":{"typography":{"fontWeight":"600"}}} --><p class="has-text-align-center has-medium-font-size" style="font-weight:600">{{FORM_HEADING}}</p><!-- /wp:paragraph -->
  <!-- END IF -->
  <!-- The replica ships no form backend — visual fidelity only. wp:html is
       banned project-wide, so use core/search: it renders an input + adjacent
       submit button without any custom HTML. -->
  <!-- wp:search {"label":"","showLabel":false,"placeholder":"{{INPUT_PLACEHOLDER}}","buttonText":"{{SUBMIT_LABEL}}","buttonPosition":"button-outside","style":{"border":{"radius":"999px"}}} /-->
</div>
<!-- /wp:group -->
```

`core/search` is the closest core block that renders an input + adjacent submit button without custom HTML (which is banned — see `block-policy.ts`). It is non-functional as a signup form but is pixel-faithful to a rounded email-capture field. Note the real integration (Klaviyo / Mailchimp / etc.) in the spec's framework-widget stub table so a human can wire it up.

---

## Framework-specific widgets → stub with explicit comment

For each of these, emit an **explicit HTML comment** in the generated pattern rather than silently dropping the feature. A human reading the theme later must know what was removed. Add rows here as new frameworks are encountered; the existing rows cover the frameworks seen so far.

| Source widget | Action | Comment to emit |
| --- | --- | --- |
| Wix Stores (shop, product, cart) | stub + WooCommerce note | `<!-- Wix Stores removed — install WooCommerce and replace this group with product blocks -->` |
| Wix Bookings | stub + link to `#booking` | `<!-- Wix Bookings removed — install a booking plugin and wire up the CTA -->` |
| Wix Forms / contact form | placeholder paragraph | `<!-- Wix Forms removed — install Contact Form 7, WPForms, or Gravity Forms -->` |
| Wix Members area | stub | `<!-- Wix Members area removed — consider BuddyPress or a membership plugin -->` |
| Wix Chat popup | drop | `<!-- Wix Chat removed — add a live-chat plugin if needed -->` |
| Squarespace Commerce product block | stub + WooCommerce note | `<!-- Squarespace product block removed — install WooCommerce and replace with product blocks -->` |
| Squarespace Events / Calendar | stub | `<!-- Squarespace Events removed — install The Events Calendar or a calendar plugin -->` |
| Webflow CMS Collection list | stub | `<!-- Webflow CMS Collection removed — register a WP custom post type and a Query Loop block to replace -->` |
| Webflow Ecommerce block | stub + WooCommerce note | `<!-- Webflow Ecommerce block removed — install WooCommerce and replace with product blocks -->` |
| Cargo gallery widget | keep image list, drop effects | `<!-- Cargo gallery effects dropped — images preserved in core/gallery -->` |
| Shopify embed (buy button, product card) | stub + WooCommerce note | `<!-- Shopify embed removed — install WooCommerce or use the Shopify Buy Button WP plugin -->` |
| Replo Add-to-Cart / dynamic price | `product-card-row` template; cart wired to WooCommerce | `<!-- Replo Add-to-Cart removed — link to the WooCommerce product page or wire a Woo add-to-cart -->` |
| Shopify/Replo review widget (Okendo/Junip/Yotpo/Stamped/Loox) | `review-grid` template with captured reviews | `<!-- Review widget reduced to a static review-grid — install a WP reviews plugin to make it dynamic -->` |
| Email-capture / signup form (Klaviyo, Mailchimp, Privy) | `cover-with-headline` email-capture variant (visual only) | `<!-- Email signup form is visual-only — wire up Klaviyo/Mailchimp/Newsletter plugin -->` |
| App-store / Google Play download badges | `app-download` template; badges as linked images | `<!-- App-download badges link to the source app-store URLs -->` |
| Marquee / scrolling text strip | `marquee-strip` when simple; static paragraph otherwise | `<!-- Marquee reduced to static strip — complex source timing not reproduced -->` |
| Parallax background | static bg image; simple fixed attachment only when spec approves | `<!-- Parallax reduced — static bg retained -->` |
| Lottie / complex scroll-triggered animations | static poster or placeholder | `<!-- Animation reduced — source framework timeline not reproduced -->` |
| Video background on cover | `core/cover` with poster image | `<!-- Video background reduced to poster image -->` |

---

## Missing-media fallback (referenced image could not be captured)

A section spec may reference an image (hero photo, product shot, app screenshot, store badge) that the extractor **failed to capture** — a cross-origin asset, a 403/expired CDN URL, a content-type the downloader rejected, or a lazy asset that never loaded. When the spec marks an image slot as missing (no local path / WP-library URL), you MUST:

1. **Emit a sized placeholder** that preserves the layout slot's dimensions, so the section reflows the same as the source and responsive@390 still passes. Use a neutral `core/group` (or `core/image` with the placeholder) at the captured width/height ratio:

```html
<!-- wp:group {"className":"clone-missing-media","style":{"color":{"background":"#e9e9ee"},"dimensions":{"minHeight":"{{SLOT_HEIGHT}}px"}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group clone-missing-media has-background" style="background-color:#e9e9ee;min-height:{{SLOT_HEIGHT}}px" aria-label="Image unavailable: {{IMAGE_ALT}}">
  <!-- wp:paragraph {"align":"center","fontSize":"small","textColor":"contrast"} --><p class="has-text-align-center has-small-font-size has-contrast-color has-text-color" style="opacity:0.5">Image unavailable</p><!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
```

2. **Flag it in the run-report.** Add a provenance flag to `run-report.json` `details.provenanceFlags` (and bump `summary.provenanceFlags`) naming the section, the slot, and the source URL that failed — e.g. `"homepage section 2 (hero): source image https://assets.replocdn.com/... could not be captured — placeholder emitted"`. The gate counts these; a non-zero count is a `warn`, not a silent pass.

3. **NEVER silently substitute an unrelated image as if it were the source.** Do not drop in a product photo, a stock image, or another section's asset to fill a missing hero/lifestyle/app slot. A faithful gap (placeholder + flag) is correct; a confident wrong image is a fidelity lie that hides the extraction failure. This is the exact mistake that produced the first getsnooz replica — the Replo hero/app imagery wasn't captured, so stand-in product photos were dropped in and the result looked plausible but wrong. If the image matters to the section's identity (hero, product card, app screenshot), the placeholder + flag is the honest output; the fix belongs upstream in capture, not in fabricated substitution.

The pipeline now captures page-builder CDN imagery (Replo `assets.replocdn.com`, etc.) regardless of host or file extension, so genuine misses should be rare — but when one happens, surface it, don't paper over it.

---

## Missing-content fallback (text could not be captured — body copy, reviews, headings)

All visible copy is the highest-risk place for fabrication, because invented prose *reads* plausible. The rule is absolute: **all text — headings, body copy, labels, and most acutely review/testimonial text — must be source-captured verbatim or placeholdered, NEVER synthesized or paraphrased.**

**Body copy / headings:** the captured text is in `spec.bodyText` (paragraphs/list items) and `spec.headings`. If a template's `{{BODY}}`/`{{HEADING}}` slot has no matching captured line, re-read the section's `html/<slug>.html` and pull the real text. If the source genuinely has no text for that slot, either omit the slot (when the layout allows) or emit a clearly-marked `[copy not captured]` placeholder + a `run-report.json` provenance flag — never write your own line to fill it. A reworded paragraph hard-fails `liberate_validate_artifacts`; an honest placeholder + flag passes as a `warn`.

**Reviews / testimonials:** first exhaust every sourcing path in the `review-grid` template above (`spec.reviews` → inline HTML carousel → embedded JSON → widget GET API). Only if all of them genuinely fail — no review text is reachable in any static or plain-GET form — do you use the review fallback below. When that happens, you MUST:

1. **Render the section structure with clearly-placeholdered review slots.** Keep the heading and the grid shape (so the section reflows and responsive@390 still passes), but put an explicit, obviously-not-real marker in each slot — `[review text not captured]` for the quote and `[author not captured]` for the attribution. Do NOT write a realistic-sounding quote or a plausible name. The placeholder must be visibly a placeholder.

```html
<!-- wp:column {"className":"clone-review clone-review--missing"} -->
<div class="wp-block-column clone-review clone-review--missing">
  <!-- wp:paragraph {"align":"center","textColor":"text-muted","fontSize":"small"} --><p class="has-text-align-center has-text-muted-color has-text-color has-small-font-size" style="opacity:0.6">[review text not captured]</p><!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
```

2. **Flag it in the run-report.** Add a provenance flag to `run-report.json` `details` (a `reviewProvenance` record or a `details.provenanceFlags` entry) and bump `summary.provenanceFlags`, naming the section and why capture failed — e.g. `"homepage review band: reviews are rendered only by the <widget> JS API which requires auth; no static/GET source found — placeholdered, not synthesized"`. A non-zero `provenanceFlags` count makes the run a `warn`, not a silent pass.

3. **NEVER synthesize, paraphrase, or "fill in" review prose.** Do not invent quotes, authors, ratings, or categories to make the band look complete. A fabricated testimonial puts words in a real (or imagined) customer's mouth — it is a fidelity lie and a trust/legal problem. An honest placeholder + flag is the correct output; the fix belongs upstream in capture/sourcing, not in invented copy. This rule is what the earlier getsnooz build violated.

---

## What NOT to do

- **Do not emit a pattern without real content from the spec file.** If `{{HEADING}}` is missing in the spec, stop and re-read the section spec to find what heading text was captured. Do not write "Your headline here" or "Placeholder heading" as a fallback.
- **Do not paraphrase, reword, or invent ANY copy — headings, subheads, body paragraphs, list items, labels, or CTAs.** All emitted text is source-verbatim (`spec.headings` / `spec.bodyText` / `spec.buttonLabels` / `spec.reviews`) or a clearly-marked placeholder + run-report flag. Reworded `{{BODY}}` HARD-FAILS `liberate_validate_artifacts` (it is a gate error, not a warning). This is the cardinal rule — see the SKILL.md and the catalog header above. An earlier getsnooz build invented section body copy ("Real fan-powered sound — no loops…") while the real source line ("Recordings loop. Speakers hiss. SNOOZ's natural and seamless sound…") sat in the captured HTML.
- **Do not use `core/cover` on light-background sections.** Use the `core/group` variant. The brightness rule above is not optional.
- **Do not inline CDN URLs or curl remote assets.** Always `get_theme_file_uri('assets/img-XX.ext')` for theme-shipped assets. For media already uploaded to the WP library, use the uploaded WP URL directly. The pipeline handles media upload; patterns must not fetch from CDNs.
- **Do not reuse one template for every section.** The spec file's `Interaction model` dictates the template. A logo strip is not a columns block. A media-text is not a gallery. A product-card row (image + title + **price**) is not a generic `columns` block — use `product-card-row`.
- **Do not re-derive the header or footer.** Reference our existing dynamic block-header and footer template parts.
- **Do not substitute an unrelated image for a missing one.** If a referenced source image (hero, product, app screenshot, badge) wasn't captured, emit a sized placeholder and flag it (see *Missing-media fallback*). A confident wrong image is worse than an honest gap.
- **Do not synthesize, paraphrase, or invent review / testimonial text — EVER.** Quotes, author names, ratings, and category labels in a `review-grid` (or single `testimonial`) MUST be source-captured verbatim (`spec.reviews` → inline carousel HTML → embedded JSON → widget GET API) or rendered as a clearly-marked placeholder + run-report flag (see *Missing-content fallback*). Do not write plausible-sounding reviews to fill the band, and do not bypass the provenance gate. This is the cardinal rule — fabricated testimonials are the worst kind of fidelity lie.
