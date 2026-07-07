---
name: creating-blocks
description: Templates and guidelines for creating new WordPress blocks from scratch — load this before generating block files
disable-model-invocation: true
---

## When to use me

Use this skill when creating a new block from scratch.
Do not use this skill when modifying an existing block.

## Generating Blocks Instructions

- Always use the current folder to generate the block
- Always remove space before the PHP opening tag, nor leave more than one empty new line at the end of any file
- Always use block props to make sure the block is selectable in the canvas
- Always use the lowercase for block name slugs
- Never close the last PHP opening tag, you always leave it open
- Never suggest or generate code outside the specification, such as REST controllers, PHP classes, or other code that is not part of a standard WordPress block
- Prefer building blocks that have the same behaviour on the frontend and the backend, unless the user asks for a block that is specifically different on the frontend
- Do not opt for placeholders in the editor
- Be proactive in adding inspector or block toolbar controls that can make the block more interactive and customizable
- Never redeclare functions in PHP and always guard with function_exists
- Do not create additional markdown files with extense documentations or installation instructions
- Make sure the block is registered correctly so that it renders on the front end
- Use the InnerBlocks component from @wordpress/block-editor as much as possible.

## Interactive Blocks

When the block requires frontend interactivity (clicks, toggles, accordions, modals, carousels, counters, tabs, search filters):
- The block MUST also be dynamic (uses render.php, no save.js)
- Use plain JavaScript with standard DOM APIs (querySelector, addEventListener, classList, etc.) in view.js — never use the WordPress Interactivity API
- In block.json: use `"viewScript": "file:./view.js"` (not `viewScriptModule`)
- In render.php: use standard HTML attributes and CSS classes that your JavaScript targets
- Use `data-*` attributes on the block wrapper to pass server-side values to JavaScript

## Reference Files

Before generating block files, read the relevant references from the `references/` directory next to this skill file.

- **`references/artefact-templates.md`** — REQUIRED: read this FIRST before generating any block files. Contains exact file templates with correct paths, asset references, and build pipeline details. You MUST follow these templates exactly.
- **`references/file-templates.md`** — additional guidelines for each block file type
- **`references/inner-blocks.md`** — read this if the block uses InnerBlocks or child blocks
- **`references/dynamic-vs-static.md`** — read this if you need to decide between a dynamic, static, or interactive rendering approach
- **`references/interactivity-api.md`** — read this when creating an interactive block that needs frontend JavaScript
