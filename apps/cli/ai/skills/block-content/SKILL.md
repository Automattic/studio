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
- A visual treatment repeated across instances of one block type (cards, outline buttons, framed images) is a registered block style variation, not a shared bare class. Register it in the theme's functions.php — `register_block_style( 'core/group', array( 'name' => 'card', 'label' => 'Card' ) )` — apply it with `"className":"is-style-card"`, and style it in `style.css` via `.is-style-card`. Registered variations appear in the editor's Styles switcher, so users can apply or remove the treatment without touching CSS. Keep bare custom classNames for one-off sections.
- Style buttons via `.wp-element-button` — the inner element WordPress applies the button's padding, background, and border to (shared by the button block and buttons from other blocks). A custom class on a button block sits on the `.wp-block-button` wrapper, so descend to `.your-class .wp-element-button`; never style the wrapper directly, or its padding stacks on top of the default and the button doubles in size.
- No inline `style` attributes or block `style` attributes for styling. Use `className` plus the theme's `style.css`.
- Prefer theme palette colors over hardcoded hex. Apply block colors with palette **slug** attributes — `{"backgroundColor":"accent-1","textColor":"base"}` — and in `style.css` reference palette colors as `var(--wp--preset--color--<slug>)`. Discover the available slugs from the active theme's `theme.json` `settings.color.palette` (for a theme you are building, the palette you defined there); when you want a color the palette lacks, prefer adding it to the palette and referencing its slug. Keeping colors on the palette keeps sections in sync with Global Styles, theme switching, and light/dark variations. A raw hex value is fine for a deliberate one-off, but it should be the exception, not the default.
- Prefer theme font-size presets over raw values, the same way as palette colors. Apply text sizes with slug attributes — `{"fontSize":"large"}` — and in `style.css` reference them as `var(--wp--preset--font-size--<slug>)`. Discover the slugs from the active theme's `theme.json` `settings.typography.fontSizes`; when a size the scale lacks recurs, add it to the scale (e.g. an `x-small` preset) and reference its slug. A raw size is fine for a deliberate one-off, but a value repeated across blocks belongs in the scale.
- Use `core/spacer` for empty spacing elements, not empty `core/group` blocks.
- No emojis anywhere in generated content.

## Layout Cascade

WordPress constrains children of `core/post-content` and any constrained-layout container to `theme.json`'s `settings.layout.contentSize`. Custom CSS such as `.hero { width: 100% }` does not override core layout selectors like `.is-layout-constrained > *:not(.alignwide):not(.alignfull)` because they are more specific.

**There is no core default for `contentSize`.** When the active theme's `theme.json` declares neither `settings.layout.contentSize` nor `wideSize`, WordPress omits the `max-width` declaration from those constrained-layout rules altogether — `layout: {"type":"constrained"}` then constrains nothing and every block runs the full width of its container. Themes created with `scaffold_theme` declare both, along with `useRootPaddingAwareAlignments` and `styles.spacing.padding` for the horizontal gutter. Keep all three when you edit `theme.json`; retune the values to suit the design, but do not drop them. In a theme that lacks them, add them there rather than patching widths and padding section by section in CSS.

Use these patterns:

- **Full-bleed section, constrained inner content**: for a full-width hero, banner, or CTA with centered content, use an outer `core/group` with `{"align":"full","layout":{"type":"constrained"}}`, then place normal inner blocks inside it.
- **Full-bleed section, wide inner content**: for multi-column rows, card grids, feature grids, and galleries, keep the same outer group and add `"align":"wide"` on the inner `core/columns`, `core/group`, or `core/gallery` so it spans `wideSize` instead of the reading column. Without it, a three-column row is squeezed into `contentSize`. Reserve the plain reading column for text-only blocks.
- **Full-bleed section, full-bleed inner content**: for image grids, edge-to-edge galleries, and similar layouts, use outer and inner `core/group` blocks with `{"align":"full","layout":{"type":"default"}}`.
- **Standard constrained content**: omit `align` and write normal blocks.

The common failures are a hero or banner that was intended to be full-width but still renders in the narrow content column, and a columns or grid block left at the reading width when it should be `"align":"wide"`. Fix that in markup by adding `align: "full"` on the outer group or correcting the inner `layout` type, not by trying to force width in CSS.

### Horizontal Padding

WordPress supplies horizontal padding in exactly one place: the root gutter (`styles.spacing.padding`) lands on full-width constrained groups via `.has-global-padding`, and core zeroes it again on constrained groups nested inside them. Every other box gets none — a full-width section with a `default`, `flex`, or `grid` layout, and any group, column, or cover that paints its own background, border, or shadow (a card, a callout, a tinted panel). Block themes do not load core's default `.has-background` padding either. Text sitting flush against its own background, border, or the viewport edge is the most common tell of an unfinished section, so:

- Whenever a block paints its own box, give its class horizontal padding in `style.css` — `.is-style-card { padding: 1.5rem; }`.
- Give a non-constrained full-width section the same gutter as the rest of the page — `padding-inline: var(--wp--style--root--padding-left);` — or place its text inside a constrained inner group, which keeps the gutter when it sits directly in a full-width `default` group.

### Shrink-Wrapped Labels (Eyebrows, Badges, Pills)

Constrained layouts keep children in the content column with `max-width` plus `margin-left/right: auto !important`. Auto margins only work on block-level boxes, so setting `display: inline-block` (or any `inline-*` value) on a block's wrapper class detaches it from the content column — it aligns to the edge of the full-width section instead. `width: fit-content` fails differently: the auto margins always center it, so it cannot sit left or right within the column.

Never change the `display` of a block wrapper inside a constrained layout. To make a label hug its text — an eyebrow, badge, tag, or pill — wrap it in a flex row group and let flex do the shrink-wrapping:

```html
<!-- wp:group {"layout":{"type":"flex"}} -->
<div class="wp-block-group"><!-- wp:paragraph {"className":"hero-eyebrow"} -->
<p class="hero-eyebrow">New for 2026</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->
```

The group's `justifyContent` (`left`/`center`/`right`) controls where the label sits, and stays editable in the editor. Inside the flex row the label already shrink-wraps — flex items size to their content — so the label class never needs a `display` rule:

```css
/* Wrong — never an inline-level display on a block wrapper class */
.hero-eyebrow { display: inline-block; }
```

This holds even when it looks harmless: inside a flex row an `inline-block` or `inline-flex` declaration changes nothing (flex items blockify), but it becomes a live alignment bug the moment the user moves the block out of the wrapper in the editor. If the class already carries a `display` rule from an earlier pass, remove it when adding the wrapper.

## Root Block Gap

WordPress inserts `margin-block-start: var(--wp--style--block-gap)` between the top-level children of the rendered template — between the header template part, the main group, and the footer template part (`.wp-site-blocks > * + *`). Core supplies a default gap (24px) even when the theme's `theme.json` never declares `styles.spacing.blockGap`, so a gap appears there that no markup asked for.

- Themes created with `scaffold_theme` already zero this in `style.css` (`.wp-site-blocks > * + * { margin-block-start: 0; }`) — sections butt edge-to-edge and own their vertical rhythm via their own padding, and `main` gets its padding back through the `.wp-site-blocks main` rule next to it so templates the theme does not author (plugin templates) still clear the header and footer. Keep both rules when editing the file.
- When working in a theme without that reset, add the same rules to the theme's `style.css` instead of compensating with negative margins or guessing at the extra space.
- Do not zero the gap by setting `styles.spacing.blockGap: "0"` in `theme.json` — that value cascades as the default gap inside every flow and constrained layout and collapses content rhythm site-wide.
- When you want visible space between top-level sections, add it deliberately (padding on the sections) so the spacing is designed, not inherited.

## Page Titles

`templates/page.html` renders `core/post-title` as the page's `h1`, above `core/post-content`. Page content must not repeat that title — a designed hero with its own heading stacked under the template's title gives the page a stray "Home" above the hero and **two `h1` elements**, which is an accessibility and SEO problem, not just a visual duplication.

Pick one of the two per page:

- **Ordinary page** (Privacy Policy, Terms, a plain About): let the template's title stand and start the page content at `h2`.
- **Designed page** whose hero carries its own heading (home, landing, anything built from sections): assign the no-title template. Themes from `scaffold_theme` ship `templates/page-no-title.html`, registered in `theme.json` under `customTemplates`. Assign it to the page after creating it:

```text
wp_cli post meta update <id> _wp_page_template page-no-title
```

Do **not** solve this by deleting `core/post-title` from `page.html` — every ordinary page then renders untitled, and a missing `h1` is worse than a duplicated one. In a theme with no no-title template, add one (a copy of `page.html` without the title group) and register it in `customTemplates` rather than stripping the title.

A site's home page is the usual case for this: with a static front page and no `front-page.html`, WordPress falls through to `page.html`, so the page least likely to want a title block gets one by default.

**Do not add a `front-page.html` to solve it.** That template overrides *every* other template for the front page — the hierarchy is `front-page → home → index` — and it applies whether the front page shows a static page or the latest posts. One containing `core/post-content` therefore breaks a blog-first site, whose front page belongs to `home.html`/`index.html`. Assigning `page-no-title` to the home page achieves the same result with no hierarchy side effects. Add a `front-page.html` only when the front page needs a structure that genuinely differs from a page's, and the site's front page is definitely static.

## Anchor Links in Shared Parts

Header and footer template parts render on **every** template — blog posts, archives, search results, the 404 page — not just the front page, even on a one-page site. A bare-hash link such as `"url":"#contact"` resolves against whatever URL the visitor is on, so it works on the front page and silently does nothing everywhere else.

- In template parts and any other shared markup, write anchor links home-relative: `<!-- wp:navigation-link {"label":"Contact","url":"/#contact"} /-->`.
- Give each target section an `anchor` attribute on its outermost block — `{"anchor":"contact","align":"full"}` renders `id="contact"` — rather than hand-writing an `id` in `core/html`.
- A bare hash is fine only for a link living in the same page's own content, such as a hero button scrolling to a section further down that page.

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

Keep the skeleton under 2KB. Fill one anchor per `Edit`, using the anchor line as `old_string` and replacing it with the anchor plus the new styles. When filling section styles, never set `display` or width on a class used as a block `className` — alignment and shrink-wrapping belong in block markup (see Shrink-Wrapped Labels).

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
