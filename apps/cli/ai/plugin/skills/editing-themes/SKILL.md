---
name: editing-themes
description: Guidelines for modifying existing WordPress block themes — load this before editing theme files
---

## When to use me

Use this skill when modifying an existing theme (files already exist in the workspace).
Do not use this skill when creating a new theme from scratch.

## Editing Guidelines

- Read theme.json, style.css, and functions.php before making changes — understand the current configuration, design tokens, and registered assets
- Make minimal, targeted changes — only modify what the user requested
- Only touch files that need to change — do not rewrite unrelated templates or patterns
- Use the `edit` tool for targeted changes; only use `write` when replacing more than 50% of a file
- When modifying colors, typography, or spacing, update theme.json — not CSS — unless the change cannot be expressed in theme.json
- When adding or modifying template parts, ensure they are registered in theme.json if needed
- Preserve the theme's existing design direction and aesthetic unless the user explicitly asks to change it
- After changes, verify templates still reference valid template parts and patterns
