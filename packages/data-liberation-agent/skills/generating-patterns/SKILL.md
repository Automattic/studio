---
name: generating-patterns
description: Guidelines and examples for generating WordPress block patterns — load this when creating patterns for themes
disable-model-invocation: true
---

## When to use me

Use this skill when generating block patterns for a theme.
Load this skill alongside `creating-themes` or `editing-themes` when patterns are part of the work.

## Page-builder content (Shopify/Replo, Wix, Squarespace, Shogun)

Page-builder storefronts emit **div-soup** markup (no semantic `<section>` tags) and rich, repeated components that are easy to flatten into generic `static`/`columns` blocks. Don't. The section spec's `Interaction model` carries the real shape — honor it and pick the matching template in `references/section-mapping.md`:

- **product-card-row** — repeated cards with image + title + **price** (+ Add-to-Cart). The price is the discriminator vs. `project-card-grid`/`columns`. Keep prices verbatim; link to the local product page or WooCommerce.
- **review-grid** — repeated star-rating + quote + name columns (Okendo/Junip/Yotpo/Replo carousels). Render the rating as a literal `★` glyph run so it survives without a JS widget; render the captured reviews as a static, mobile-safe grid. **Review/testimonial text is NEVER synthesized — source-captured verbatim or placeholdered, full stop.** It is sourced (in order) from `spec.reviews` (the deterministic `review-extract.ts` extractor populates it from the served HTML), the inline carousel markup in the captured HTML, embedded JSON (`schema.org` `Review`, warmup blobs), or the widget's plain-GET JSON API. "The reviews are a JS widget" is usually false — page-builder carousels render every slide inline. Only when ALL of those fail is the band placeholdered + flagged. See the `review-grid` template and *Missing-content fallback* in `references/section-mapping.md`.
- **app-download** — heading + copy beside app-store / Google Play **badge images**. Reuse the captured trademark badges as linked images; never redraw them as text buttons.
- **cover-with-headline (email-capture variant)** — a hero whose CTA is an email signup form ("Get 10% Off" + field + submit). Render a visual `core/search` input+button (forms have no backend in the replica) and stub the real integration in the framework-widget table.

The extractor now captures page-builder CDN imagery (Replo `assets.replocdn.com`, Shogun, image proxies) regardless of host or file extension. The faithful imagery is in the media library — use it. Do not fall back to unrelated product photos for hero/lifestyle/app slots.

## ⛔ Cardinal rule: ALL emitted copy is source-verbatim or placeholdered — NEVER paraphrased

**Every word of visible text a pattern emits — headings, subheads, body paragraphs, list items, button/label text, review quotes — MUST be the source's captured text, reproduced verbatim, OR a clearly-marked missing-content placeholder + run-report flag. Never synthesize, paraphrase, reword, "tighten," "improve," or invent copy to fill a slot.** This is not limited to reviews; it governs *all* prose. Reproducing copy verbatim is the whole point of a replica — paraphrase is a fidelity lie that silently rewrites the source's own words.

Where the source text lives, in order:
- **Headings / labels:** `spec.headings`, `spec.buttonLabels`.
- **Body paragraphs / list items:** `spec.bodyText` (every captured `<p>`/`<li>` text node, verbatim — see `SectionSpec.bodyText`). If a template slot wants body copy that is **not** in `spec.bodyText`, do NOT write your own — re-read the section's captured `html/<slug>.html` and pull the real line. If the source genuinely has no text for that slot, leave the slot out or use the missing-content placeholder; never fabricate.
- **Review/testimonial quotes, authors, categories:** `spec.reviews` → inline carousel HTML → embedded JSON → widget GET API (see `review-grid`).

Allowed differences from the raw source byte stream are **only** mechanical renderings: HTML-entity encoding (`&#8217;`, `&nbsp;`, `&amp;`), whitespace collapse, and typographic-glyph folding (smart quotes ↔ straight, en/em dash ↔ hyphen, ellipsis char ↔ `...`). Anything beyond that — a different word, a reordered clause, a "punchier" rewrite — is paraphrase and is **rejected**.

This is enforced deterministically: `liberate_validate_artifacts` checks emitted text against the captured source. Headings must each be contained in a single `spec.expectedText` entry; **body paragraphs must be substantially contained in `spec.expectedText` ∪ `spec.bodyText` — a reworded paragraph HARD-FAILS the gate** (not a warning). You may not bypass that gate. An earlier getsnooz build paraphrased section body copy ("Real fan-powered sound — no loops…", "Your best shut-eye, guaranteed.") and invented three testimonials while the real lines sat in the captured HTML the whole time — exactly the failure this rule and gate exist to stop.

## Missing-content fallback (do NOT fabricate substitutes — images OR text)

If a section spec references an image that could not be captured (cross-origin, 403/expired CDN, rejected content-type), emit a **sized placeholder** that preserves the layout slot, **flag it** in `run-report.json` (`details.provenanceFlags` + bump `summary.provenanceFlags`), and **never** substitute an unrelated image as if it were the source. A confident wrong image hides the extraction failure and produces a plausible-but-wrong replica — the exact mistake behind the first getsnooz build.

The same rule governs **all text** (per the cardinal rule above), **most acutely review/testimonial copy.** Never synthesize, paraphrase, or invent review quotes, author names, ratings, category labels, headings, or body paragraphs. They are source-captured verbatim or rendered as a clearly-marked placeholder (`[review text not captured]`, or for body copy `[copy not captured]`) plus a run-report flag — never fabricated, and never bypass the `liberate_validate_artifacts` provenance gate (text ⊆ captured source). An earlier getsnooz build invented three testimonials AND paraphrased section body copy, and manually skipped that gate; the real text was in the captured HTML the entire time. See *Missing-media fallback*, *Missing-content fallback (review/testimonial text)*, and the `review-grid` sourcing order in `references/section-mapping.md`.

## Pattern Generation Rules

- Place pattern files in the `patterns/` directory
- Each pattern file must start with a PHP comment header registering the pattern
- Use descriptive, kebab-case filenames (e.g., `hero-split.php`, `faq-accordion.php`)
- Never use emojis in any pattern content
- **Copy is source-verbatim, never invented** (see the Cardinal rule above). This overrides any "write realistic placeholder copy" habit from generic landing-page generation: for a *replica*, the copy IS the source's copy, reproduced verbatim from `spec.headings` / `spec.bodyText` / `spec.buttonLabels` / `spec.reviews` (or placeholdered + flagged). Do not write your own headlines, body, or CTAs.
- Alternate between light and dark section backgrounds to create visual rhythm
- Patterns must be self-contained — do not use `<inner-blocks>` or assume external context

## Pattern File Header (required)

Every pattern file must begin with this PHP comment block:

```php
<?php
/**
 * Title: Hero Split
 * Slug: theme-slug/hero-split
 * Categories: featured, banner
 * Keywords: hero, split, cta
 * Block Types: core/template-part/content
 */
?>
```

- `Title`: Human-readable name shown in the inserter
- `Slug`: Must be `theme-slug/pattern-name` using the theme's text domain
- `Categories`: Comma-separated list (use WordPress defaults: `featured`, `banner`, `text`, `gallery`, `call-to-action`, `about`, `team`, `testimonials`, `contact`, `footer`, `header`)
- `Keywords`: Comma-separated search terms for discoverability
- `Block Types`: Optional — restricts where the pattern appears

## Pattern Set for Landing Pages

When generating patterns for a landing page theme, include a varied set that covers the full page flow. Choose patterns that match the site type and audience — not every site needs the same set.

Recommended baseline (adapt per site type):

1. **Hero section** — the first thing visitors see; must set the tone and include a primary CTA
2. **Social proof / logos** — build trust early with client logos or partner badges
3. **Feature grid** — highlight key offerings or services
4. **Content with media** — pair text with imagery to explain the value proposition
5. **Testimonials or case studies** — reinforce credibility
6. **FAQ** — address common objections
7. **Final CTA** — closing section with a clear conversion action

## Header patterns (replica): source logo + nav, NEVER page-list

If a pattern reconstructs the site header (or a header part), it MUST mirror the SOURCE header:

- Use the source's real **logo image** (`core/image` / `core/site-logo`), not `core/site-title` text and not a product image.
- Use explicit `core/navigation-link`s for the source's **top-level primary menu only** (label + href). NEVER use `core/page-list` — it dumps every published WP page (Sample Page, Checkout, account, recall pages) as junk that does not reflect the source's menu.
- Drop mega-menu sub-links, the mobile-drawer duplicate, and social/account/cart/search affordances.
- Preserve the source's top **announcement/utility bar** when present.
- Apply the site's **self-hosted source fonts** (e.g. the heading typeface), not a system fallback — see the scaffold's font-capture (`@font-face` → `assets/fonts/` → `theme.json` fontFamilies).

## CTA Guidelines

- Every landing page must have at least two CTA patterns: one in the hero, one as a closing section
- Use `wp:buttons` with clear, action-oriented text ("Get Started", "Book a Demo", "View Portfolio")
- Style CTAs to stand out — use the theme's accent color, generous padding, and prominent placement
- Avoid vague labels like "Click Here" or "Learn More" when a specific action is available
- For sticky CTAs, use a full-width Group with a fixed position class and high z-index

## Layout Examples

### Hero with left text / right image

Two-column split: heading + paragraph + CTA button on the left, full-height image on the right. Use `wp:columns` with a 55/45 or 60/40 split. The text column gets vertical centering; the image column uses `object-fit: cover` at full height.

```
Columns (align: full)
  └── Column (width: 55%, verticalAlignment: center)
  │     └── Heading (h1)
  │     └── Paragraph
  │     └── Buttons
  └── Column (width: 45%)
        └── Image (style: height 100%, object-fit: cover)
```

### Z-pattern layout

Alternate the position of text and image across consecutive sections to create a natural Z reading flow. Odd sections place text left / image right; even sections flip to image left / text right.

```
Section 1 — Columns (align: wide)
  └── Column (text) | Column (image)

Section 2 — Columns (align: wide)
  └── Column (image) | Column (text)

Section 3 — Columns (align: wide)
  └── Column (text) | Column (image)
```

Use alternating background colors (light/dark) between sections to reinforce separation.

### 3-column feature grid

Three equal-width columns, each containing an icon or image, a heading, a paragraph, and an optional CTA. Use the `equal-cards` pattern from the card-layouts reference.

```
Columns (className: "equal-cards", align: wide)
  └── Column (width: 33.33%, verticalAlignment: stretch)
  │     └── Group
  │           └── Image (icon or illustration)
  │           └── Heading (h3)
  │           └── Paragraph
  │           └── Buttons (className: "cta-bottom") [optional]
  └── Column (width: 33.33%, verticalAlignment: stretch)
  │     └── Group
  │           └── ...
  └── Column (width: 33.33%, verticalAlignment: stretch)
        └── Group
              └── ...
```

### Alternating light/dark sections

Wrap each section in a `wp:group` with a contrasting background color. Pull colors from the theme palette — use `has-{color}-background-color` classes or inline `backgroundColor` attributes. Alternate between the theme's base and contrast colors.

```
Group (align: full, backgroundColor: base)
  └── [section content]

Group (align: full, backgroundColor: contrast)
  └── [section content with inverted text color]

Group (align: full, backgroundColor: base)
  └── [section content]
```

### Sticky CTA button

A fixed-position bar at the bottom of the viewport with a single CTA. Use a full-width Group with custom CSS class for sticky positioning.

```
Group (align: full, className: "sticky-cta")
  └── Buttons (layout: center)
        └── Button ("Get Started Now")
```

Required CSS (style.css):
```css
.sticky-cta {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  padding: 1rem;
}
```

### Accordion FAQ

Use the `wp:details` block for collapsible FAQ items inside a constrained-width Group.

```
Group (align: wide, layout: constrained)
  └── Heading (h2, "Frequently Asked Questions")
  └── Details (summary: "Question one?")
  │     └── Paragraph (answer)
  └── Details (summary: "Question two?")
  │     └── Paragraph (answer)
  └── Details (summary: "Question three?")
        └── Paragraph (answer)
```

### Logos as social proof

A single row of client or partner logos. Use a `wp:columns` block with evenly spaced columns, each containing a centered image. Keep logos grayscale or muted to avoid visual clutter.

```
Group (align: wide)
  └── Paragraph (align: center, "Trusted by leading companies")
  └── Columns (align: wide)
        └── Column (width: 16.66%) → Image (logo, centered)
        └── Column (width: 16.66%) → Image (logo, centered)
        └── Column (width: 16.66%) → Image (logo, centered)
        └── Column (width: 16.66%) → Image (logo, centered)
        └── Column (width: 16.66%) → Image (logo, centered)
        └── Column (width: 16.66%) → Image (logo, centered)
```

## Site-Type Pattern Suggestions

Not every site needs the same patterns. Adapt the set to the context:

- **Portfolio**: Hero with full-bleed image, project gallery grid, about/bio section, contact CTA
- **SaaS / Product**: Hero split, logo bar, feature grid, pricing table, testimonials, FAQ, final CTA
- **Restaurant / Local**: Hero with cover image, menu highlights, hours/location, reservation CTA, gallery
- **Agency / Studio**: Hero with reel or case study, services grid, case study cards, team, contact
- **Blog / Magazine**: Hero with featured post, category grid, newsletter signup, recent posts
- **E-commerce**: Hero with product showcase, category grid, bestsellers, testimonials, promo banner

## Return envelope (orchestrator-internal)

When invoked as a builder subagent by the `/liberate` or `/replicate-with-blocks` orchestrator, you MUST return your output as a structured JSON envelope — not free-form prose:

```json
{
  "patterns": [
    { "slug": "theme-slug/hero-split", "php": "<?php\n/**\n * Title: Hero Split\n * ...\n */\n?>\n<!-- wp:group ... -->" }
  ],
  "sitewideFlags": [],
  "notes": []
}
```

- `patterns` — array of objects with `slug` (the pattern's registered slug, matching the file header) and `php` (the full pattern file contents as a string, including the PHP comment header).
- `sitewideFlags` — optional array of strings naming sitewide concerns (e.g. `"commercial-font-reckless"`, `"missing-mobile-hero-image"`).
- `notes` — optional array of strings with builder observations or deferred items.

Section markup comes from the `references/section-mapping.md` catalog. Emit all source-derived **text** as literal, pre-escaped HTML in the markup itself — HTML-entity-escape `&`, `<`, `>` (and quotes inside attributes) at authoring time. Do **not** wrap visible text in `<?php echo esc_html(…) ?>` / `esc_attr(…)`: `liberate_validate_artifacts` sanctions exactly TWO PHP forms — the pattern's doc-comment header and `<?php echo esc_url( get_theme_file_uri('assets/…') ); ?>` for theme-shipped asset paths (see `section-mapping.md`) — and treats ANY other `<?php`, including `esc_html('literal')`, as injection. So: visible text → literal escaped HTML; theme-asset URLs → `esc_url( get_theme_file_uri(…) )`; nothing else emits PHP. The result must pass `liberate_validate_artifacts` (escaping/injection + provenance). A malformed or partial return — missing `patterns`, wrong types, raw `<?php` outside the two sanctioned forms — is treated as a builder failure and triggers a retry or sequential fallback. Never return partial results silently.