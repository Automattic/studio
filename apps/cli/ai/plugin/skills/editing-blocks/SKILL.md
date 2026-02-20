---
name: editing-blocks
description: Guidelines for modifying existing WordPress blocks — load this before editing block files
---

## When to use me

Use this skill when modifying an existing block (files already exist in the workspace).
Do not use this skill when creating a new block from scratch.

## Editing Guidelines

- Read all existing block files before making changes — understand the current architecture, attributes, and rendering approach
- Make minimal, targeted changes — only modify what the user requested
- Only touch files that need to change — do not rewrite unrelated files
- Use the `edit` tool for targeted changes; only use `write` when replacing more than 50% of a file
- Do not convert between static and dynamic blocks, or change the block name/slug, unless the user explicitly asks
- When adding or modifying attributes, update all relevant files (block.json, edit.js, and save.js or render.php)
- After changes, verify the block is still registered correctly and renders on the front end
- Use the InnerBlocks component from @wordpress/block-editor as much as possible.

## Reference Files

Before editing block files, read the relevant references from the `references/` directory next to this skill file.

- **`references/inner-blocks.md`** — read this if the block uses InnerBlocks or child blocks
