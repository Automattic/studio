---
name: editing-blocks
description: Guidelines for modifying existing WordPress blocks — load this before editing block files
disable-model-invocation: true
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
- When adding interactivity to an existing block, convert it to dynamic first if it isn't already (add render.php, remove save.js, add `"render": "file:./render.php"` to block.json)
- When converting a block to interactive: add `"viewScript": "file:./view.js"` to block.json, write view.js using plain JavaScript with standard DOM APIs (querySelector, addEventListener, classList, etc.) — never use the WordPress Interactivity API

## Reference Files

Before editing block files, read the relevant references from the `references/` directory next to this skill file.

- **`references/artefact-templates.md`** — read this to verify correct file structure, paths, and asset references (especially register_block_type path and block.json asset filenames)
- **`references/file-templates.md`** — additional guidelines for each block file type
- **`references/inner-blocks.md`** — read this if the block uses InnerBlocks or child blocks
- **`references/interactivity-api.md`** — read this when adding interactive behavior to a block that needs frontend JavaScript
