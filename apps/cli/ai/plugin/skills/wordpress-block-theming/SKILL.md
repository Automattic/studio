---
name: wordpress-block-theming
description: WordPress Full Site Editing (FSE) theme architecture. Use when generating theme.json, block templates, template parts, patterns, and functions.php for WordPress block themes.
---

# WordPress Block Theming Skill

Comprehensive knowledge for building WordPress block themes using Full Site Editing (FSE) architecture.

## Related Skills

- **Always load `frontend-design`** alongside this skill. It defines the design quality bar — visual hierarchy, typography pairing, anti-AI-slop rules — that should govern all theme output.
- **Load `wp-interactivity-api`** when the design calls for scroll-triggered animations, dynamic state changes, or any interactivity beyond CSS. The Interactivity API is the WordPress-native way to add JavaScript-driven behavior to block themes.

## Absolute Rules

- **NO HTML BLOCKS**: Never use `<!-- wp:html -->` (the `core/html` block). HTML blocks are opaque blobs in the block editor — users cannot select, style, or rearrange individual elements inside them. Every piece of content MUST use a proper core block (`wp:group`, `wp:heading`, `wp:paragraph`, `wp:columns`, etc.). If you find yourself reaching for `wp:html`, stop and decompose the content into the correct core blocks with `className` attributes and CSS instead.
- **NO DECORATIVE HTML COMMENTS**: Never insert non-block HTML comments like `<!-- Hero Section -->` or `<!-- Features -->` in templates, template parts, or patterns. The only HTML comments allowed are WordPress block delimiters (`<!-- wp:block-name -->` / `<!-- /wp:block-name -->`).
- **NO EMOJIS**: Never use emojis anywhere in generated content - not in headings, paragraphs, button text, or any other text. This applies to all templates, patterns, and content.

## Theme Architecture

### Directory Structure

```
theme-slug/
├── theme.json           # Central configuration file
├── style.css            # Theme metadata + custom CSS
├── functions.php        # Asset enqueuing, pattern registration
├── templates/           # Block templates
│   ├── index.html       # Main/fallback template
│   ├── single.html      # Single post
│   ├── page.html        # Single page
│   ├── archive.html     # Archive listings
│   ├── search.html      # Search results
│   └── 404.html         # Not found
├── parts/               # Reusable template parts
│   ├── header.html      # Site header
│   └── footer.html      # Site footer
└── patterns/            # Block patterns
    ├── hero.php
    ├── features.php
    └── cta.php
```

## theme.json Configuration

The `theme.json` file is the central configuration for block themes. It defines:

### Schema and Version

```json
{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3
}
```

### Settings

Define available options for the editor:

```json
{
  "settings": {
    "appearanceTools": true,
    "layout": { "contentSize": "800px", "wideSize": "1280px" },
    "color": {
      "palette": [ /* 5 colors: primary, secondary, accent, light, dark */ ],
      "defaultPalette": false,
      "defaultGradients": false
    },
    "typography": {
      "fontFamilies": [ /* heading + body font families */ ],
      "fontSizes": [ /* 5-6 step scale: small through huge */ ]
    },
    "spacing": {
      "units": ["px", "em", "rem", "%", "vw", "vh"],
      "spacingSizes": [ /* 6 steps from compact to spacious */ ]
    }
  }
}
```

### Styles

Define default styles for the site and blocks:

```json
{
  "styles": {
    "color": { /* background + text from palette */ },
    "typography": { /* body font family, medium size, line-height 1.5-1.65 */ },
    "elements": {
      "heading": { /* heading font family, appropriate weight, line-height 1.1-1.3 */ },
      "link": { /* accent color */ },
      "button": { /* accent background, light text, border-radius */ }
    }
  }
}
```

## Typography

See `frontend-design` skill for font selection and sizing principles. WordPress-specific implementation:

- Register font families in `settings.typography.fontFamilies` in theme.json. Use Google Fonts enqueued via `functions.php`.
- Define a 6-step font size scale in `settings.typography.fontSizes`. A good scale: 0.875rem / 1rem / 1.25rem / 1.75rem / 2.25rem / clamp(2.5rem, 4vw, 3.5rem).
- **Line height**: Body text: 1.5–1.65. Headings: 1.1–1.3. Never go below 1.0 for any text. Apply via `styles.typography.lineHeight` and `styles.elements.heading.typography.lineHeight` in theme.json.

## Block Templates

Templates use WordPress block markup (HTML comments with JSON attributes).

### Template Structure

```html
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->

<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->
<main class="wp-block-group">
  <!-- Content blocks here -->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
```

## Template Parts

### Header Requirements
- Constrained layout group with site-appropriate background
- Flex row: `site-title` (level:0 — renders `<p>` not `<h1>`) + `navigation`
- Appropriate padding using spacing presets

### Footer Requirements
- Constrained layout group, matching or complementing header style
- Content varies by site type (copyright, social links, contact info, etc.)
- Include footer margin reset in style.css

### Page Title
A page title template should be included by default, and should reflect in some way the design of the main landing page. If each page added shares the same page title template then the site will feel more cohesive and polished. It should use the `<!-- wp:post-title /-->` block so the page title is dynamic and reflects the actual page/post title.

## Block Patterns

Patterns are PHP files that register reusable block content.

### Pattern Registration

```php
<?php
/**
 * Title: Hero Section
 * Slug: theme-slug/hero
 * Categories: featured
 */
?>
<!-- wp:group {"backgroundColor":"primary","textColor":"light","layout":{"type":"constrained"}} -->
...
<!-- /wp:group -->
```

## functions.php

Keep functions.php minimal. Primary uses:

### Google Fonts Enqueuing

**IMPORTANT:** Always use `enqueue_block_assets` hook (not `wp_enqueue_scripts`) to ensure fonts load in BOTH the front-end AND block editor.

```php
<?php
/**
 * Theme functions and definitions
 */

// Enqueue Google Fonts and theme stylesheet for both front-end and block editor
function theme_slug_enqueue_assets() {
    wp_enqueue_style(
        'theme-slug-fonts',
        'https://fonts.googleapis.com/css2?family=Clash+Display:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&display=swap',
        array(),
        null
    );

    wp_enqueue_style(
        'theme-slug-style',
        get_stylesheet_uri(),
        array( 'theme-slug-fonts' ),
        wp_get_theme()->get( 'Version' )
    );
}
add_action( 'enqueue_block_assets', 'theme_slug_enqueue_assets' );

// Register block patterns
function theme_slug_register_patterns() {
    register_block_pattern_category(
        'theme-slug',
        array( 'label' => __( 'Theme Patterns', 'theme-slug' ) )
    );
}
add_action( 'init', 'theme_slug_register_patterns' );
```

## Security in Generated Code

- When `functions.php` outputs any user-derived value, use WordPress escaping functions:
  - HTML context: `esc_html()`
  - Attribute context: `esc_attr()`
  - URL context: `esc_url()`
- Never use `eval()`, `create_function()`, `shell_exec()`, `exec()`, or `system()` in generated theme code
- Static block themes with hardcoded content (the default) do not need escaping — WordPress core blocks handle this. Escaping matters only if generating PHP that renders dynamic data.

## style.css

The style.css file contains theme metadata and custom CSS.
**Important**: Always bring across custom CSS from the design into style.css that is not achievable via theme.json, especially for layout and composition techniques that are critical to the design's aesthetics such as animation/motion.

```css
/*
Theme Name: Theme Name
Theme URI: https://example.com
Author: Author Name
Author URI: https://example.com
Description: A beautiful WordPress block theme
Version: 1.0.0
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
License: GNU General Public License v2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html
Text Domain: theme-slug
*/
```

## Animation & Motion in Block Themes

Animation brings life to block themes, but WordPress block markup requires a specific pattern to connect CSS animations to blocks.

### The className Pattern

Add animation classes to blocks via the `className` JSON attribute. WordPress renders this as a class on the wrapper div:

```html
<!-- wp:group {"className":"fade-up","align":"full","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull fade-up">
  <!-- content -->
</div>
<!-- /wp:group -->
```

This works on any block — groups, columns, headings, paragraphs, buttons, images:

```html
<!-- wp:heading {"className":"slide-in-left"} -->
<h2 class="wp-block-heading slide-in-left">Features</h2>
<!-- /wp:heading -->

<!-- wp:columns {"className":"stagger-children","align":"wide"} -->
<div class="wp-block-columns alignwide stagger-children">
  ...
</div>
<!-- /wp:columns -->
```

### Animation Classes in style.css

Generate and adapt these classes (these are examples only, do not limit yourself to these) in each theme's `style.css`:

**Entrance animations:**
```css
.fade-up {
  opacity: 0;
  transform: translateY(30px);
  animation: fadeUp 0.6s ease forwards;
}
.fade-in {
  opacity: 0;
  animation: fadeIn 0.6s ease forwards;
}
.slide-in-left {
  opacity: 0;
  transform: translateX(-40px);
  animation: slideIn 0.7s ease forwards;
}
.slide-in-right {
  opacity: 0;
  transform: translateX(40px);
  animation: slideIn 0.7s ease forwards;
}

@keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { to { opacity: 1; } }
@keyframes slideIn { to { opacity: 1; transform: translateX(0); } }
```

**Staggered children** — delays applied via nth-child:
```css
.stagger-children > * {
  opacity: 0;
  transform: translateY(20px);
  animation: fadeUp 0.5s ease forwards;
}
.stagger-children > *:nth-child(1) { animation-delay: 0.1s; }
.stagger-children > *:nth-child(2) { animation-delay: 0.2s; }
.stagger-children > *:nth-child(3) { animation-delay: 0.3s; }
.stagger-children > *:nth-child(4) { animation-delay: 0.4s; }
```

**Interactive transitions:**
```css
.hover-lift {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.hover-lift:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0,0,0,0.15);
}
.hover-glow {
  transition: box-shadow 0.3s ease;
}
.hover-glow:hover {
  box-shadow: 0 0 20px rgba(var(--wp--preset--color--accent-rgb, 0,0,0), 0.3);
}
```

**Continuous ambient motion:**
```css
.float {
  animation: float 3s ease-in-out infinite;
}
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
.pulse-subtle {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

### Scroll-Triggered Reveals via functions.php

> For advanced scroll-driven interactivity (parallax, counters, dynamic content loading, state-driven animations), use the **`wp-interactivity-api` skill** instead of raw IntersectionObserver. The pattern below is a lightweight CSS-only approach suitable for simple reveal animations.

The most impactful animation pattern — sections revealing as the user scrolls — requires a small IntersectionObserver script. Add this to `functions.php`:

```php
// Scroll animation observer — outputs inline script
function theme_slug_scroll_animations() {
    ?>
    <script>
    document.addEventListener('DOMContentLoaded', function() {
        var els = document.querySelectorAll('.animate-on-scroll');
        if (!els.length) return;
        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });
        els.forEach(function(el) { observer.observe(el); });
    });
    </script>
    <?php
}
add_action( 'wp_footer', 'theme_slug_scroll_animations' );
```

Then in `style.css`, pair with CSS that starts elements hidden and animates them when `.is-visible` is added:

```css
.animate-on-scroll {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}
.animate-on-scroll.is-visible {
  opacity: 1;
  transform: translateY(0);
}
```

Use `className: "animate-on-scroll"` on section-level Group blocks:

```html
<!-- wp:group {"className":"animate-on-scroll","align":"full","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull animate-on-scroll">
  <!-- section content -->
</div>
<!-- /wp:group -->
```

### prefers-reduced-motion (Required)

Every theme MUST include this in `style.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
  /* Elements that start hidden for entrance animations must become visible */
  .animate-on-scroll,
  .fade-up,
  .fade-in,
  .slide-in-left,
  .slide-in-right,
  .scale-up {
    opacity: 1 !important;
    transform: none !important;
  }
}
```

### Editor Visibility (Required)

The theme's `style.css` loads in both the front-end and the WordPress block editor (via `enqueue_block_assets`). However, the IntersectionObserver script that triggers scroll reveals runs only on the front-end (`wp_footer`), not inside the editor iframe. This means any block with an entrance animation class that sets `opacity: 0` will be **invisible in the block editor**.

WordPress wraps all editor content inside `<div class="editor-styles-wrapper">`. This class does not exist on the front-end, so it is the correct selector for editor-only overrides.

Every theme MUST include a block like this in `style.css`, covering **every** entrance animation class used in the theme:

```css
/* === Editor: keep animated content visible while editing === */
.editor-styles-wrapper .fade-up,
.editor-styles-wrapper .fade-in,
.editor-styles-wrapper .slide-in-left,
.editor-styles-wrapper .slide-in-right,
.editor-styles-wrapper .scale-up,
.editor-styles-wrapper .animate-on-scroll,
.editor-styles-wrapper .stagger-children > * {
  opacity: 1 !important;
  transform: none !important;
  animation: none !important;
  transition: none !important;
}
```

If the theme uses any custom animation class that sets `opacity: 0` or uses `transform` as an initial hidden state, add a corresponding `.editor-styles-wrapper` selector to this block. The rule is simple: every class that hides content for animation purposes needs an editor override that makes it visible.

### How Much Animation

Not every element needs animation. Prioritize:
- **Hero section entrance** — the first impression (fade-up, scale, or slide)
- **Section reveals on scroll** — major content blocks with `animate-on-scroll`
- **Interactive elements** — cards with `hover-lift`, buttons with transitions
- **1-2 decorative ambient animations** — a floating shape, gradient shift, or pulsing accent

Avoid animating every heading, paragraph, and button individually — it creates visual noise rather than delight.

## Card Layouts in Rows

For equal-height, equal-width cards (with optional bottom-aligned CTAs), use this structure unless the user specifies otherwise:

```
Columns (className: "equal-cards")
  └── Column
        verticalAlignment: "stretch"
        width: "X%" where X = 100 / number_of_cards (e.g., 2 cards = 50%, 3 cards = 33.33%, 4 cards = 25%)
        └── Group [card wrapper]
              └── [content: headings, paragraphs, images*, lists]
              └── (optional) Buttons (className: "cta-bottom")
```

**Width rule**: All cards in a row MUST have equal width. Calculate each column's width as `100% / number_of_cards` (e.g., 3 cards = 33.33% each). The sum of all column widths must equal exactly 100% - never exceed the parent element width.

*Images in cards: `style="height:200px;object-fit:cover;width:100%"`

**Required CSS** (style.css):
```css
.equal-cards > .wp-block-column {
  display: flex;
  flex-direction: column;
  flex-grow: 0;
}
.equal-cards > .wp-block-column > .wp-block-group {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}
```
If present, ensure bottom-aligned CTAs unless otherwise specified:
```css
.equal-cards .cta-bottom {
  margin-top: auto;
  justify-content: center;
}
```
Always add the following CSS to reset the footer top margin:
```css
.wp-site-blocks > footer {
  margin-block-start: 0;
}
```

## Landing Page Composition

When generating homepage block markup, think like a landing page designer, not a template assembler. Every section should be a visually distinct, full-width band that creates rhythm and visual impact as the user scrolls.

### Section Architecture

- **Section margin reset**: Add `"style":{"spacing":{"margin":{"top":"0"}}}` to every top-level Group block that wraps a landing page section. This overrides WordPress's default top margin on direct children of `.wp-site-blocks` and can be easily adjusted by users in the editor.
- **Section layout widths**: Hero sections, header groups, cover blocks, and feature grids should use `"align":"wide"` or `"align":"full"` rather than defaulting to narrow content width. Only use default (content) alignment for text-heavy reading sections.
- Do **not** use `<inner-blocks>`; output the full expanded markup inside each block.
- **Columns alignment**: ALWAYS set `"align":"wide"` on `wp:columns` blocks (and add the `alignwide` class on the wrapper div) unless specifically instructed otherwise.
- **No decorative HTML comments**: Never insert section-labeling comments like `<!-- Hero Section -->` or `<!-- Services Section -->` in templates, template parts, or patterns. Only WordPress block comments (`<!-- wp:block-name -->`) are allowed.
- **No HTML blocks**: Never use `<!-- wp:html -->`. See Common Block Mistakes below.

### Common Block Mistakes

These are the most frequent errors when generating block markup. Every example shows the **wrong** approach and the **correct** decomposition into core blocks.

**1. Complex layout dumped into an HTML block**

WRONG — opaque blob, not editable in the block editor:
```html
<!-- wp:html -->
<div class="features-grid">
  <div class="feature">
    <h3>Fast</h3>
    <p>Lightning-quick load times.</p>
  </div>
  <div class="feature">
    <h3>Secure</h3>
    <p>Enterprise-grade security.</p>
  </div>
</div>
<!-- /wp:html -->
```

RIGHT — each element is a selectable, editable core block:
```html
<!-- wp:columns {"align":"wide","className":"features-grid"} -->
<div class="wp-block-columns alignwide features-grid">
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:heading {"level":3} -->
    <h3 class="wp-block-heading">Fast</h3>
    <!-- /wp:heading -->
    <!-- wp:paragraph -->
    <p>Lightning-quick load times.</p>
    <!-- /wp:paragraph -->
  </div>
  <!-- /wp:column -->
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:heading {"level":3} -->
    <h3 class="wp-block-heading">Secure</h3>
    <!-- /wp:heading -->
    <!-- wp:paragraph -->
    <p>Enterprise-grade security.</p>
    <!-- /wp:paragraph -->
  </div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->
```

**2. Styled heading in an HTML block**

WRONG:
```html
<!-- wp:html -->
<h2 class="gradient-text section-title">Our Services</h2>
<!-- /wp:html -->
```

RIGHT — use `className` on the core heading block, define `.gradient-text` and `.section-title` in `style.css`:
```html
<!-- wp:heading {"className":"gradient-text section-title"} -->
<h2 class="wp-block-heading gradient-text section-title">Our Services</h2>
<!-- /wp:heading -->
```

**3. Entire styled section in an HTML block**

WRONG:
```html
<!-- wp:html -->
<section class="cta-band" style="background:#1a1a2e;padding:4rem 2rem;text-align:center;">
  <h2 style="color:#fff;font-size:2rem;">Ready to get started?</h2>
  <p style="color:#ccc;">Join thousands of happy customers.</p>
  <a href="#" class="cta-button">Sign Up Free</a>
</section>
<!-- /wp:html -->
```

RIGHT — use `wp:group` with `className`, define `.cta-band` styles in `style.css`:
```html
<!-- wp:group {"className":"cta-band","align":"full","backgroundColor":"primary","textColor":"light","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull cta-band has-primary-background-color has-light-color has-text-color has-background">
  <!-- wp:heading {"textAlign":"center"} -->
  <h2 class="wp-block-heading has-text-align-center">Ready to get started?</h2>
  <!-- /wp:heading -->
  <!-- wp:paragraph {"align":"center"} -->
  <p class="has-text-align-center">Join thousands of happy customers.</p>
  <!-- /wp:paragraph -->
  <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
  <div class="wp-block-buttons">
    <!-- wp:button -->
    <div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Sign Up Free</a></div>
    <!-- /wp:button -->
  </div>
  <!-- /wp:buttons -->
</div>
<!-- /wp:group -->
```

**4. Decorative HTML comments**

WRONG:
```html
<!-- Hero Section -->
<!-- wp:group {"align":"full"} -->
...
<!-- /wp:group -->

<!-- Features Section -->
<!-- wp:group {"align":"full"} -->
...
<!-- /wp:group -->
```

RIGHT — remove the non-block comments entirely:
```html
<!-- wp:group {"align":"full"} -->
...
<!-- /wp:group -->

<!-- wp:group {"align":"full"} -->
...
<!-- /wp:group -->
```

**Every major homepage section must be `alignfull`** — edge-to-edge across the viewport. Content inside can be constrained, but the section wrapper fills the screen width. This is the **full-bleed wrapper, constrained content** pattern:

`<!-- wp:group {"align":"full","backgroundColor":"...","layout":{"type":"constrained"}} -->`

**Never use bare `{"layout":{"type":"constrained"}}` without `"align":"full"` for homepage sections.** Without `alignfull`, sections render at `contentSize` (800px) and the page looks narrow and lifeless.

**YOU DECIDE** which sections best serve this specific site. Do not follow a rigid template. Consider the site type, audience, and primary goal:

- A portfolio needs a full-bleed project gallery
- A SaaS needs feature grids with clear value props
- A restaurant needs appetizing imagery and menu sections
- An agency needs case study cards and social proof
- An escape room needs atmosphere and immersion

### Visual Rhythm

Alternate between visual treatments to create rhythm as the user scrolls:

| Technique | WordPress Implementation |
|-----------|------------------------|
| Alternating backgrounds | Alternate `backgroundColor` between `background` and `surface` (or `primary`/`secondary` for bold sections) |
| Full-bleed imagery | Cover blocks with `"align":"full"` and `overlayColor` from the brand palette |
| Edge-to-edge media-text | `wp:media-text` with `"align":"full"` for alternating image/content sides |
| Bold CTA bands | Full-width group with `primary` or `accent` background, centered text |
| Spacer breaks | `wp:spacer` between sections for breathing room |

Every section should feel visually distinct from its neighbors. If two adjacent sections have the same background color and layout pattern, the page feels monotonous — change the background, flip the image side, switch from grid to single-column, or add a cover block break.

## Image Handling

ONLY add user provided images/image URLs to the initial site build. Stock image urls often fail to load in the block editor and break the design.
Look at any user supplied images carefully and include them in the design if appropriate, but do not force them in if they do not fit the design.

### Creating Visual Richness Without Images

Since only user provided images/image URLs can be used, if none are available convey atmosphere and visual interest through:

- **CSS Gradients**: Linear, radial, and conic gradients for depth and color
- **Color Blocks**: Bold use of background colors to create visual hierarchy
- **Typography as Design**: Large, distinctive headings; creative font pairing; varied text sizes and weights
- **CSS Patterns**: Repeating backgrounds using CSS gradients (stripes, dots, grids)
- **Shadows & Depth**: Box-shadow, text-shadow, and drop-shadow for dimension
- **Borders & Frames**: Creative use of borders, outlines, and decorative frames
- **Spacing & Layout**: Generous whitespace or controlled density to create mood
- **CSS Pseudo-elements**: ::before and ::after for decorative visual elements
- **Color Overlays**: Layered divs with transparency for atmospheric effects
