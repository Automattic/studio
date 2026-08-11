---
name: theme-layering
description: Decide whether WordPress site styling and composition belong in block attributes, theme.json presets/styles, patterns/templates, CSS, custom blocks, or JavaScript. Use for style ownership warnings, editor/front-end parity issues, and block-theme architecture choices.
user-invokable: true
---

# Theme Layering

Use this skill when deciding where a visual or structural change belongs in a WordPress block theme.

## Ownership Ladder

Choose the highest layer that can represent the change while staying editable:

1. **Block attributes**: page-specific color, background, font size, spacing, dimensions, layout, alignment, and block-specific settings.
2. **theme.json settings**: palettes, gradients, font sizes, spacing scale, layout widths, border/shadow presets, and other editor controls.
3. **theme.json styles**: site-wide defaults for typography, colors, spacing, blocks, and elements.
4. **Patterns/templates/template parts**: reusable composition, repeated sections, headers, footers, and query layouts.
5. **CSS**: unsupported selectors, pseudo-elements, responsive glue, scroll offsets, plugin cleanup, animation engines, and visual effects the editor cannot express.
6. **Custom blocks or JavaScript**: reusable interactive behavior, frontend-only effects, third-party integrations, canvas/WebGL, and behavior that cannot be represented by blocks alone.

If a lower layer duplicates a higher layer, move it up. A custom class that sets color, font size, spacing, gap, or width for a normal block usually belongs in block attributes or `theme.json`.

## Common Mappings

| Goal | Use | Avoid |
| --- | --- | --- |
| Page-specific text/background color | `textColor`, `backgroundColor`, `gradient` slugs | CSS color rules on section classes |
| Site-wide palette/type/spacing | `theme.json` `settings` presets | hardcoded values scattered through content |
| Narrow content column | parent group `layout.contentSize` | child `max-width` rules |
| Section spacing | block `style.spacing` or `theme.json` spacing presets | per-section CSS margins |
| Global button defaults | `theme.json` block/element styles first, `.wp-element-button` only for gaps | wrapper padding on `.wp-block-button` |
| Reusable section | pattern or template part | duplicated page markup |
| Decorative overlay | CSS pseudo-element | extra wrapper HTML or `core/html` |
| Reactive reusable behavior | custom block + Interactivity API | one-off script in page content |

## When validate_blocks Warns

Treat style ownership warnings as a review gate:

1. Read each warning's selector and properties.
2. Move editor-native properties to block attributes or `theme.json` when possible.
3. Keep CSS when the selector is genuinely an effect, state, plugin cleanup, responsive workaround, or progressive enhancement.
4. Re-run `validate_blocks` after changing block content.

## Parity Check

A design is not complete until the block editor shows the same key decisions a user should be able to see or adjust: color, type scale, spacing, alignment, and content width. If the front end looks designed but the editor looks plain, the styling is in the wrong layer.
