---
name: block-content
description: Write editable WordPress block markup and theme files for local Studio sites — read the WordPress source the markup depends on, keep content editable, validate it with validate_blocks, and use the skeleton-first recipes for long page and CSS files.
---

# Block Content

Use this skill before writing or editing page content, post content, templates, template parts, patterns, or any other WordPress block markup, and before changing an existing theme's files.

## Read the source first

The site's WordPress install is on disk, and it is the reference for how blocks, layouts, and themes behave. Before writing markup or CSS that depends on WordPress behavior, read the code that produces it:

- A block's attributes, supports, and wrapper classes: `wp-includes/blocks/<block>/block.json`, and `render_block_core_*` in `wp-includes/blocks/<block>.php` for dynamic blocks.
- What a block support renders (layout, spacing, color, typography, alignment): `wp-includes/block-supports/<support>.php`.
- What `theme.json` keys do and what core supplies by default: `wp-includes/class-wp-theme-json.php` and `wp-includes/theme.json`.
- Which template renders a page: `wp-includes/template.php` and `wp-includes/block-template-utils.php`.
- The active theme: its `theme.json`, `style.css`, `templates/`, `parts/`, and `functions.php`. A template saved in the Site Editor lives in the database (`wp_cli post list --post_type=wp_template,wp_template_part`) and wins over the file.

Grep for the class, attribute, or function you are about to rely on and read the matching code. When the rendered result surprises you, `inspect_design` shows what WordPress actually emitted; the source tells you why.

## Principles

- **Editable**: content and layout are editable blocks, styled through the most structured channel that fits — block attributes and presets, then `theme.json`, then a registered block style variation, then `style.css` for what those cannot express.
- **Update-safe**: installed third-party themes and plugins are overwritten on update, so customize them through a child theme (`scaffold_theme` with `parentTheme`) or a plugin, never by editing their files. Themes Studio Code scaffolded ("scaffolded by Studio Code" in style.css) are the site's own and safe to edit. New themes are block themes.
- **Consistent**: colors, font sizes, and spacing come from the theme's presets; extend the presets rather than scattering raw values.

## core/html policy

`validate_blocks` enforces this. Use `core/html` only for inline SVG, interaction markup with no block equivalent (marquee, custom cursor), or a single bottom-of-page `<script>` block. Text, headings, layout sections, lists, and forms are editable core or plugin blocks; for features core blocks do not provide, load the `plugin-recommendations` skill.

## Skeleton-first recipes

For files over about 200 lines, write a small skeleton with anchor comments first, then fill the anchors with `Edit` — one `edits[]` entry per anchor, several per call, under ~8KB of new text per call. When `scaffold_theme` made the theme, `Edit` its `style.css` instead of overwriting it; the file carries the theme header.

For long page content:

1. Create the page empty: `wp_cli post create --post_type=page --post_title="<Title>" --post_content=""`.
2. Write `<site>/tmp/page-<slug>.html` with section anchors (`<!-- section:hero -->`) and fill them with `Edit`.
3. Validate the file with `validate_blocks` (`filePath`) until it passes.
4. Apply it once: `wp_cli eval '$c = file_get_contents(ABSPATH . "tmp/page-<slug>.html"); wp_update_post(["ID" => <id>, "post_content" => $c]); echo "ok";'`

## Validation

Every piece of block content passes `validate_blocks` before it reaches the site: scratch page files before they are applied, and theme `templates/*.html` and `parts/*.html` right after each write, since they are live as soon as they exist. It runs the `core/html` policy, then the live editor's block validation, and applies safe serialization fixes to the file itself. When it reports an auto-fix, the file is already corrected; read the diff for classes that affect your CSS.
