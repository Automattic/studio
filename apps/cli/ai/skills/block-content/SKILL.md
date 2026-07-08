---
name: block-content
description: Write editable WordPress block markup for local Studio sites, including core/html limits, block-theme layout rules, full-width sections, validation, and skeleton-first page/CSS recipes.
user-invokable: true
---

# Block Content

Use this skill before writing or editing page content, post content, templates, template parts, patterns, or any other WordPress block markup.

## Core Policy

- Use editable WordPress blocks for content and layout. Prefer `core/group`, `core/columns`, `core/heading`, `core/paragraph`, `core/list`, `core/image`, `core/buttons`, and theme CSS.
- Only use `core/html` blocks for inline SVGs, interaction markup with no block equivalent such as marquee or custom cursor markup, or a single bottom-of-page `<script>` block.
- Never use `core/html` to wrap text content, headings, layout sections, lists, or forms.
- For forms or features core blocks do not cleanly provide, load the `plugin-recommendations` skill and use editable plugin blocks.
- No decorative HTML comments such as `<!-- Hero Section -->` or `<!-- Features -->`. Only WordPress block delimiter comments are allowed.
- No custom class names on inner DOM elements. Put custom classes only on the outermost block wrapper via the block `className` attribute.
- Style buttons via `.wp-element-button` — the inner element WordPress applies the button's padding, background, and border to (shared by the button block and buttons from other blocks). A custom class on a button block sits on the `.wp-block-button` wrapper, so descend to `.your-class .wp-element-button`; never style the wrapper directly, or its padding stacks on top of the default and the button doubles in size.
- No inline `style` attributes or block `style` attributes for styling. Use `className` plus the theme's `style.css`.
- Prefer theme palette colors over hardcoded hex. Apply block colors with palette **slug** attributes — `{"backgroundColor":"accent-1","textColor":"base"}` — and in `style.css` reference palette colors as `var(--wp--preset--color--<slug>)`. Discover the available slugs from the active theme's `theme.json` `settings.color.palette` (for a theme you are building, the palette you defined there); when you want a color the palette lacks, prefer adding it to the palette and referencing its slug. Keeping colors on the palette keeps sections in sync with Global Styles, theme switching, and light/dark variations. A raw hex value is fine for a deliberate one-off, but it should be the exception, not the default.
- Use `core/spacer` for empty spacing elements, not empty `core/group` blocks.
- No emojis anywhere in generated content.

## Layout Cascade

WordPress constrains children of `core/post-content` and any constrained-layout container to `theme.json`'s `settings.layout.contentSize`, which is about 700px by default. Custom CSS such as `.hero { width: 100% }` does not override core layout selectors like `.is-layout-constrained > *:not(.alignwide):not(.alignfull)` because they are more specific.

Use these patterns:

- **Full-bleed section, constrained inner content**: for a full-width hero, banner, or CTA with centered content, use an outer `core/group` with `{"align":"full","layout":{"type":"constrained"}}`, then place normal inner blocks inside it.
- **Full-bleed section, full-bleed inner content**: for image grids, edge-to-edge galleries, and similar layouts, use outer and inner `core/group` blocks with `{"align":"full","layout":{"type":"default"}}`.
- **Standard constrained content**: omit `align` and write normal blocks.

The common failure is a hero or banner that was intended to be full-width but still renders in the narrow content column. Fix that in markup by adding `align: "full"` on the outer group or correcting the inner `layout` type, not by trying to force width in CSS.

## Root Block Gap

WordPress inserts `margin-block-start: var(--wp--style--block-gap)` between the top-level children of the rendered template — between the header template part, the main group, and the footer template part (`.wp-site-blocks > * + *`). Core supplies a default gap (24px) even when the theme's `theme.json` never declares `styles.spacing.blockGap`, so a gap appears there that no markup asked for.

- Themes created with `scaffold_theme` already zero this in `style.css` (`.wp-site-blocks > * + * { margin-block-start: 0; }`) — sections butt edge-to-edge and own their vertical rhythm via their own padding. Keep that reset when editing the file.
- When working in a theme without that reset, add the same rule to the theme's `style.css` instead of compensating with negative margins or guessing at the extra space.
- Do not zero the gap by setting `styles.spacing.blockGap: "0"` in `theme.json` — that value cascades as the default gap inside every flow and constrained layout and collapses content rhythm site-wide.
- When you want visible space between top-level sections, add it deliberately (padding on the sections) so the spacing is designed, not inherited.

## Skeleton-First Recipes

For long files over about 200 lines, write a small skeleton first and fill anchors across later `Edit` calls.

### Theme CSS

For `style.css`, start with custom properties and anchor comments only:

```css
:root {
	/* Map section variables onto the theme palette — reference preset slugs,
	   never hardcode hex here. The slugs come from theme.json's color palette. */
	--site-bg: var( --wp--preset--color--base );
	--site-text: var( --wp--preset--color--contrast );
}

/* === reset === */
/* === typography === */
/* === hero === */
/* === sections === */
/* === cta === */
/* === footer === */
/* === responsive === */
```

Keep the skeleton under 2KB. Fill one anchor per `Edit`, using the anchor line as `old_string` and replacing it with the anchor plus the new styles.

When `scaffold_theme` was used, do not `Write` over the scaffolded `style.css`; it already contains the required theme header. Use `Edit` to append the `:root` block and anchor comments below the existing content.

### Page Content

For long page content:

1. Create the page empty:

```text
wp_cli post create --post_content=""
```

2. Write `<site>/tmp/page-<slug>.html`, not a file inside the theme, with small section anchors:

```html
<!-- section:hero -->
<!-- section:features -->
<!-- section:cta -->
```

3. Fill one anchor per `Edit` using editable blocks. Never wrap a section in `core/html`.
4. **Validate before applying (mandatory gate).** Once all anchors are filled, you MUST call `validate_blocks` with `filePath` pointing at `<site>/tmp/page-<slug>.html` and get a passing result — the core/html policy passes and editor validation reports all blocks valid. This is not optional and not a step you can defer to after `wp_cli eval`: the scratch file is block content, so it must be validated as a file while it still lives in a file. If validation reports invalid blocks, fix them in the file and call `validate_blocks` again until it passes. Never apply block content you have not validated.
5. Apply the validated content once:

```text
wp_cli eval '$content = file_get_contents(ABSPATH . "tmp/page-<slug>.html"); wp_update_post(["ID" => <id>, "post_content" => $content]); echo "ok";'
```

Do not use `--post_content-file=<host path>`. `wp_cli` runs inside the PHP-WASM filesystem; the host site directory is mounted at `/wordpress/`, so `ABSPATH === "/wordpress/"`. Host paths are not readable there and can silently update the post to empty content.

## Validation

- Validation is a mandatory gate, not a cleanup step. You MUST call `validate_blocks` and get a passing result for any block content you generate **before** that content reaches the live site — before `wp_cli post create/update`, before `wp_cli eval`, and before importing a scratch file. Never apply, import, or save block content you have not validated. A build that skips validation is incomplete, even if the page renders.
- Run `validate_blocks` after every write or edit that creates or changes block content. Call it with `filePath` whenever the content lives in a file — including scratch files such as `<site>/tmp/page-<slug>.html` that you later import with `wp_cli eval`. The scratch file is the block content; validate the file, not just the eventual post. It first runs a static `core/html` policy check: if that reports invalid `core/html` blocks, editor validation is skipped — rewrite only those blocks as editable core or plugin blocks, then call `validate_blocks` again. Once the policy passes it validates in the live editor and applies safe serialization fixes directly to the file. If it says an auto-fix was applied, do not manually replace markup or call validation again unless you intentionally change block markup afterward. Use the diff only to inspect structural changes for CSS impact. Classes added or removed by the validator can affect layout and styling.
