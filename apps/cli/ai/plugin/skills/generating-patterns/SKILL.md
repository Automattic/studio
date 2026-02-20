---
name: generating-patterns
description: Guidelines and examples for generating WordPress block patterns — load this when creating patterns for themes
---

## When to use me

Use this skill when generating block patterns for a theme.
Load this skill alongside `creating-themes` or `editing-themes` when patterns are part of the work.

## Pattern Generation Rules

- Place pattern files in the `patterns/` directory
- Each pattern file must start with a PHP comment header registering the pattern
- Use descriptive, kebab-case filenames (e.g., `hero-split.php`, `faq-accordion.php`)
- Never use emojis in any pattern content
- Keep copy realistic but placeholder-friendly — never reference real clients or brands
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

## CTA Guidelines

- Every landing page must have at least two CTA patterns: one in the hero, one as a closing section
- Use `wp:buttons` with clear, action-oriented text ("Get Started", "Book a Demo", "View Portfolio")
- Style CTAs to stand out — use the theme's accent color, generous padding, and prominent placement
- Avoid vague labels like "Click Here" or "Learn More" when a specific action is available

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

## Site-Type Pattern Suggestions

Not every site needs the same patterns. Adapt the set to the context:

- **Portfolio**: Hero with full-bleed image, project gallery grid, about/bio section, contact CTA
- **SaaS / Product**: Hero split, logo bar, feature grid, pricing table, testimonials, FAQ, final CTA
- **Restaurant / Local**: Hero with cover image, menu highlights, hours/location, reservation CTA, gallery
- **Agency / Studio**: Hero with reel or case study, services grid, case study cards, team, contact
- **Blog / Magazine**: Hero with featured post, category grid, newsletter signup, recent posts
- **E-commerce**: Hero with product showcase, category grid, bestsellers, testimonials, promo banner
