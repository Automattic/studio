---
name: editing-themes
description: Guidelines for modifying existing WordPress block themes — load this before editing theme files
disable-model-invocation: true
---

## When to use me

Use this skill when modifying an existing theme (files already exist in the workspace).
Do not use this skill when creating a new theme from scratch.

## Absolute Rules

- **NEVER recreate or overwrite files the user did not ask you to change.** If the user asks to "add a newsletter template", you add the new template/pattern files and update the index template to include it — nothing else.
- **NEVER rewrite theme.json, functions.php, or style.css** unless the user's request specifically requires changes to them (e.g., adding a new color, changing fonts, registering a new asset).
- **NEVER change the theme's topic, branding, or content direction.** If the theme is for a dance studio, new additions must be contextually appropriate for a dance studio — not generic placeholder content.
- **NEVER delete existing patterns, templates, or template parts** unless the user explicitly asks to remove them.

## Editing Guidelines

- Read theme.json, style.css, and functions.php before making changes — understand the current configuration, design tokens, and registered assets
- Make minimal, targeted changes — only modify what the user requested
- Only touch files that need to change — do not rewrite unrelated templates or patterns
- Use the `edit` tool for targeted changes; only use `write` when replacing more than 50% of a file
- When modifying colors, typography, or spacing, update theme.json — not CSS — unless the change cannot be expressed in theme.json
- When adding or modifying template parts, ensure they are registered in theme.json if needed
- Preserve the theme's existing design direction and aesthetic unless the user explicitly asks to change it
- New content (patterns, templates) must match the theme's existing topic, tone, and visual style
- After changes, verify templates still reference valid template parts and patterns

## Reference Files

Before editing theme files, read the relevant references from the `creating-themes/references/` directory.

- **`creating-themes/references/block-html.md`** — REQUIRED: read this FIRST. Block HTML validity rules, block comment ↔ HTML matching, image/cover/button block structure. Violating these causes "unexpected or invalid content" errors.
- **`creating-themes/references/design-direction.md`** — REQUIRED: read this before generating any theme files. Contains guidelines and good design directions.
- **`creating-themes/references/navigation.md`** — read this before generating any header template part, covers `wp:navigation` block markup, overlay (hamburger menu)
- **`creating-themes/references/query-loop.md`** — read this if the theme must display dynamic content (blog posts, archives, search results) in templates or patterns
