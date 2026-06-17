---
name: custom-blocks
description: Authoring a brand-new custom WordPress block type — block.json, edit/save/render, dynamic vs static, the Interactivity API, and InnerBlocks. Load only when a site genuinely needs a bespoke block that core or plugin blocks cannot provide.
user-invokable: false
---

# Custom Blocks

Use this skill only when a site genuinely needs a **bespoke block type** that core or plugin blocks cannot provide. For ordinary pages composed from existing blocks, use `block-content`; for the surrounding theme structure (and for wiring a finished block into a theme), use `theme-development`.

Author normal `src/` files — Studio compiles them. Do not avoid or hand-roll the build; just write correct source.

## File structure and build convention

A block is a small set of files:

- `block.json` — metadata. Use `"apiVersion": 3` and a theme-namespaced `name` (`mytheme/block-name`, never a third-party namespace).
- `src/index.js` — registers the block, importing metadata, `Edit`, and (for static blocks) `save`.
- `src/edit.js` — the editor component; spread `useBlockProps()` onto the wrapper and translate strings with `@wordpress/i18n`.
- `src/save.js` — **static blocks only**; return markup via `useBlockProps.save()`.
- `src/render.php` — **dynamic blocks only**; emit the wrapper with `get_block_wrapper_attributes()`.
- `src/style.scss` (front end + editor) and `src/editor.scss` (editor only).
- `src/view.js` — optional front-end script.

Build convention (this is how the compiled output must be referenced — Studio runs the build that produces `build/`):

- The PHP that registers the block must point at **`build/`**, never `src/`.
- `block.json` asset fields reference **compiled** filenames: `"editorScript": "file:./index.js"`, `"editorStyle": "file:./index.css"`, `"style": "file:./style-index.css"`, `"viewScript": "file:./view.js"`. Never reference a `.scss` file in `block.json` — WordPress cannot process SCSS.
- Dynamic blocks add `"render": "file:./render.php"`.

General rules: always spread block props so the block is selectable in the editor; use lowercase slugs; keep the editor and front-end render consistent; be proactive with inspector and toolbar controls; guard PHP functions with `function_exists()`.

## Dynamic vs static vs interactive

Choose the rendering model first — it determines which files you write:

- **Static**: output is saved into post content. Write `save.js`. No `render.php`, no `"render"` in `block.json`.
- **Dynamic**: output is rendered by PHP at request time. Write `render.php`. No `save.js`; add `"render": "file:./render.php"`.
- **Interactive**: always dynamic. Add `"interactivity": true` to `supports`, reference the view script as `"viewScriptModule": "file:./view.js"` (not `"viewScript"`), and drive behavior with `data-wp-*` directives. Use this for accordions, tabs, modals, toggles, carousels, and filters.

## Interactivity API

For interactive blocks, use the Interactivity API rather than custom event listeners:

- Markup directives: `data-wp-interactive="namespace/slug"` on the root, `data-wp-context` for local state, `data-wp-on--<event>` / `data-wp-on-async--<event>` for handlers, `data-wp-bind--<attr>`, `data-wp-class--<name>`, `data-wp-text`, and `data-wp-each`.
- In `view.js`, register the store: `store( 'namespace/slug', { state, actions, callbacks } )`.
- **Asynchronous logic must use generators** (`function*` with `yield`) — `async`/`await` is not supported inside the store.
- On the PHP side, seed state with `wp_interactivity_state( $namespace, $state )` and local context with `wp_interactivity_data_wp_context( $context )`. Pre-render the initial state server-side to avoid layout shift, and keep derived state consistent between PHP and JS.

## InnerBlocks

To let users nest blocks inside yours:

- Import `InnerBlocks` and `useInnerBlocksProps` from `@wordpress/block-editor`.
- Allow at most **one** `InnerBlocks` area per block.
- Call `useBlockProps()` **before** `useInnerBlocksProps()` — calling them in the wrong order leaves `blockProps` empty.
- Templates use the form `[ name, attributes, [ children ] ]`. `templateLock` accepts `"all"`, `"insert"`, `"contentOnly"`, or `false`.
- For a dynamic block with inner blocks, `save.js` returns `<InnerBlocks.Content />`, and `render.php` receives `$content` **already sanitized** — do not run it through `wp_kses_post` again.
- Silent-failure traps: a dynamic `save` that returns `null` yields empty `$content`; a save/edit structure mismatch drops the block into recovery mode; a missing `useBlockProps` loses the `data-block` attributes.
