# WordPress Block HTML Rules

These rules are **mandatory** for all block markup in templates, template parts, and patterns. Violating them causes "Block contains unexpected or invalid content" errors in the WordPress editor.

## Rule 1: One HTML Element Per Block

Each WordPress block outputs exactly **ONE root HTML element** between its opening and closing comments. Never nest elements of the same type.

**WRONG** (two `<p>` tags nested — INVALID):
```html
<!-- wp:paragraph {"align":"center","textColor":"cream"} -->
<p class="has-cream-color"><p class="has-text-align-center" style="font-family:serif">Text</p></p>
<!-- /wp:paragraph -->
```

**WRONG** (real nested paragraph — INVALID):
```html
<p class="has-charcoal-color has-text-color" style="margin-bottom:var(--wp--preset--spacing--40)"><p class="has-text-align-center has-charcoal-color has-text-color" style="font-size:1rem">Text</p></p>
```

**CORRECT** (ONE element with all classes and styles merged):
```html
<!-- wp:paragraph {"align":"center","textColor":"cream"} -->
<p class="has-text-align-center has-cream-color has-text-color" style="font-family:serif">Text</p>
<!-- /wp:paragraph -->
```

When generating paragraph blocks: write the opening `<p>`, add ALL the classes (alignment, colors, etc.) and ALL styles to that ONE tag, then the text content, then `</p>`. Never create a second element inside.

## Rule 2: Block Comment JSON Must Match HTML

The JSON attributes in the `<!-- wp:block-name {...} -->` comment **must exactly correspond** to the CSS classes and inline styles on the HTML element. WordPress validates this match — any mismatch triggers the "unexpected or invalid content" error.

### Color attributes → CSS classes
```html
<!-- wp:paragraph {"textColor":"cream","backgroundColor":"dark"} -->
<p class="has-cream-color has-dark-background-color has-text-color has-background">Text</p>
<!-- /wp:paragraph -->
```
- `"textColor":"cream"` → `has-cream-color has-text-color`
- `"backgroundColor":"dark"` → `has-dark-background-color has-background`

### Alignment → CSS classes
```html
<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center">Text</p>
<!-- /wp:paragraph -->
```
- `"align":"center"` → `has-text-align-center`

### Block alignment → CSS classes
```html
<!-- wp:group {"align":"full"} -->
<div class="wp-block-group alignfull">...</div>
<!-- /wp:group -->
```
- `"align":"full"` → `alignfull`
- `"align":"wide"` → `alignwide`

### Style attributes → inline styles
```html
<!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem"}}}} -->
<div class="wp-block-group" style="padding-top:2rem;padding-bottom:2rem">...</div>
<!-- /wp:group -->
```

### Font size → class or inline style
```html
<!-- wp:paragraph {"fontSize":"large"} -->
<p class="has-large-font-size">Text</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.2rem"}}} -->
<p style="font-size:1.2rem">Text</p>
<!-- /wp:paragraph -->
```
- Preset `"fontSize":"large"` → `has-large-font-size` class
- Custom `"style":{"typography":{"fontSize":"1.2rem"}}` → `style="font-size:1.2rem"`

### Common block class patterns
| Block | Base class |
|-------|-----------|
| Group | `wp-block-group` |
| Columns | `wp-block-columns` |
| Column | `wp-block-column` |
| Image | `wp-block-image` |
| Cover | `wp-block-cover` |
| Buttons | `wp-block-buttons` |
| Button | `wp-block-button` |
| Heading | `wp-block-heading` |
| Paragraph | *(no base class)* |

## Rule 3: Image Block Structure

Standard image block:
```html
<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large"><img src="theme:./assets/feature.png" alt="AI_IMAGE: description | style | aspect-ratio"/></figure>
<!-- /wp:image -->
```
- `"sizeSlug":"large"` → `size-large` class on `<figure>`
- The `<figure>` is the root element, `<img>` is inside it

Full-width image:
```html
<!-- wp:image {"align":"full","sizeSlug":"full"} -->
<figure class="wp-block-image alignfull size-full"><img src="theme:./assets/hero.png" alt="AI_IMAGE: description | style | landscape"/></figure>
<!-- /wp:image -->
```

## Rule 4: Cover Block Structure

Cover blocks have a specific internal structure that must be followed exactly:
```html
<!-- wp:cover {"url":"theme:./assets/hero.png","dimRatio":50} -->
<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-50 has-background-dim"></span><img class="wp-block-cover__image-background" alt="AI_IMAGE: description | photorealistic | landscape" src="theme:./assets/hero.png" data-object-fit="cover"/><div class="wp-block-cover__inner-container">
        <!-- Inner blocks go here -->
</div></div>
<!-- /wp:cover -->
```

Required elements (in this exact order inside the root div):
1. `<span>` with `wp-block-cover__background` class (overlay)
2. `<img>` with `wp-block-cover__image-background` class and `data-object-fit="cover"` attribute
3. `<div>` with `wp-block-cover__inner-container` wrapping all inner content

CRITICAL: The `<span>` overlay MUST come before `<img>`, and `<img>` MUST have `data-object-fit="cover"`. Missing or reordering these causes block validation failure.

## Rule 5: Button Block Structure

```html
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
    <!-- wp:button {"backgroundColor":"accent","textColor":"contrast"} -->
    <div class="wp-block-button"><a class="wp-block-button__link has-contrast-color has-accent-background-color has-text-color has-background wp-element-button">Button Text</a></div>
    <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
```

- `wp-block-button` on the wrapper `<div>`
- `wp-block-button__link` on the `<a>` element
- `wp-element-button` always present on the `<a>`
- Color classes on the `<a>`, not the wrapper

## Rule 6: No `<style>` Tags in Templates

Do **NOT** output `<style>` tags in templates, template parts, or patterns. The build process strips them, leaving blocks unstyled and mismatching their JSON attributes. Use:
- `theme.json` for global styles
- `style.css` for custom CSS
- Inline `style` attributes for per-element styling

## Rule 7: No `<inner-blocks>` in Templates

Do **not** use `<inner-blocks>` placeholder tags. Output the full expanded block markup. Every block must have its complete HTML between its comment tags.

## Rule 8: CSS Variable Syntax

Use WordPress CSS variable syntax for preset values in inline styles:
```
style="padding-top:var(--wp--preset--spacing--30)"
style="font-size:var(--wp--preset--font-size--large)"
style="color:var(--wp--preset--color--accent)"
```

The pattern is: `var(--wp--preset--{category}--{slug})`
