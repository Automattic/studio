---
name: creating-blocks
description: Templates and guidelines for creating new WordPress blocks from scratch — load this before generating block files
---

## When to use me

Use this skill when creating a new block from scratch.
Do not use this skill when modifying an existing block.

## Generating Blocks Instructions

- Always use plain JS for the view.js file
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
- Do not create additional markdown files with documentation or installation instructions
- Make sure the block is registered correctly so that it renders on the front end
- Use the InnerBlocks component from @wordpress/block-editor as much as possible.

## Reference Files

Before generating block files, read the relevant references from the `references/` directory next to this skill file.

- **`references/file-templates.md`** — REQUIRED: read this before generating any block files. Contains templates for all 11 block file types (block.json, edit.js, save.js, render.php, etc.)
- **`references/inner-blocks.md`** — read this if the block uses InnerBlocks or child blocks
- **`references/dynamic-vs-static.md`** — read this if you need to decide between a dynamic or static rendering approach
