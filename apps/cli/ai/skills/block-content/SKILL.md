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

WordPress constrains children of `core/post-content` and any constrained-layout container to `theme.json`'s `settings.layout.contentSize`. Custom CSS such as `.hero { width: 100% }` does not override core layout selectors like `.is-layout-constrained > *:not(.alignwide):not(.alignfull)` because they are more specific.

**There is no core default for `contentSize`.** When the active theme's `theme.json` declares neither `settings.layout.contentSize` nor `wideSize`, WordPress omits the `max-width` declaration from those constrained-layout rules altogether — `layout: {"type":"constrained"}` then constrains nothing and every block runs the full width of its container. Themes created with `scaffold_theme` declare both, along with `useRootPaddingAwareAlignments` and `styles.spacing.padding` for the horizontal gutter. Keep all three when you edit `theme.json`; retune the values to suit the design, but do not drop them. In a theme that lacks them, add them there rather than patching widths and padding section by section in CSS.

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
wp_cli eval '$content = file_get_contents(ABSPATH . "tmp/page-<slug>.html"); wp_update_post(wp_slash(["ID" => <id>, "post_content" => $content])); echo "ok";'
```

Do not use `--post_content-file=<host path>`. `wp_cli` runs inside the PHP-WASM filesystem; the host site directory is mounted at `/wordpress/`, so `ABSPATH === "/wordpress/"`. Host paths are not readable there and can silently update the post to empty content.

## Editing Existing Content

The live `post_content` in the site database is the only source of truth for an existing page or post. The user may have edited it in the WordPress editor (for example, replaced placeholder images with real ones) since you last touched it, and applying a stale copy silently destroys those changes. Never start an edit from a `tmp/page-*.html` file left over from an earlier task or session, and never rebuild a page's content from conversation memory. (Building a file across consecutive turns within one task, as in the skeleton-first recipe, is fine.)

Before ANY edit to an existing page or post:

1. Hydrate a fresh working copy from the live content:

```text
wp_cli eval '@mkdir(ABSPATH . "tmp"); $c = get_post_field("post_content", <id>, "raw"); file_put_contents(ABSPATH . "tmp/page-<slug>.html", $c); echo "hydrated " . strlen($c) . " bytes";'
```

If the byte count is 0 and the page is not expected to be empty, stop and re-check the post ID.

2. `Read` the hydrated file and make targeted `Edit`s against it.
3. Validate and apply immediately, in the same work burst, using the same mandatory `validate_blocks` gate and apply step as above. If other work intervened or the user may have touched the page since hydration, hydrate a fresh copy and re-apply your edits to it before applying.

## Validation

- Validation is a mandatory gate, not a cleanup step. You MUST call `validate_blocks` and get a passing result for any block content you generate **before** that content reaches the live site — before `wp_cli post create/update`, before `wp_cli eval`, and before importing a scratch file. Never apply, import, or save block content you have not validated. A build that skips validation is incomplete, even if the page renders.
- Run `validate_blocks` after every write or edit that creates or changes block content. Call it with `filePath` whenever the content lives in a file — including scratch files such as `<site>/tmp/page-<slug>.html` that you later import with `wp_cli eval`. The scratch file is the block content; validate the file, not just the eventual post. It first runs a static `core/html` policy check: if that reports invalid `core/html` blocks, editor validation is skipped — rewrite only those blocks as editable core or plugin blocks, then call `validate_blocks` again. Once the policy passes it validates in the live editor and applies safe serialization fixes directly to the file. If it says an auto-fix was applied, do not manually replace markup or call validation again unless you intentionally change block markup afterward. Use the diff only to inspect structural changes for CSS impact. Classes added or removed by the validator can affect layout and styling.
