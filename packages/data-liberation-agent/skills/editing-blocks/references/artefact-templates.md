# Block Artefact File Templates

These are the exact file templates you MUST follow when generating block files. Pay close attention to paths, asset references, and the build pipeline relationship.

## Build Pipeline (Critical)

Source files live in `src/`. `wp-scripts build` compiles `src/` → `build/`:
- JS files are bundled (imports resolved into single files)
- SCSS is compiled to CSS
- `src/block.json` is copied to `build/block.json`

**Consequence:** The PHP plugin MUST register the block from `build/`, and `block.json` asset references MUST use compiled filenames (not source filenames).

## {project_slug}.php — Main Plugin File

```php
<?php
/**
 * Plugin Name:       {project_name}
 * Description:       {description}
 * Version:           0.1.0
 * Requires at least: 6.7
 * Requires PHP:      7.4
 * Author:            {author}
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       {project_slug}
 *
 * @package {NamespacePascalCase}
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

/**
 * Registers the block using the metadata loaded from the `block.json` file.
 * Behind the scenes, it registers also all assets so they can be enqueued
 * through the block editor in the corresponding context.
 *
 * @see https://developer.wordpress.org/reference/functions/register_block_type/
 */
if ( ! function_exists( '{namespace_snake_case}_{slug_snake_case}_block_init' ) ) {
	function {namespace_snake_case}_{slug_snake_case}_block_init() {
		register_block_type( __DIR__ . '/build/' );
	}
}
add_action( 'init', '{namespace_snake_case}_{slug_snake_case}_block_init' );
```

**CRITICAL:** `register_block_type()` MUST point to `__DIR__ . '/build/'` — NEVER to `__DIR__ . '/src'`.

## src/block.json — Block Metadata

```json
{
	"$schema": "https://schemas.wp.org/trunk/block.json",
	"apiVersion": 3,
	"name": "{namespace}/block-{project_slug}",
	"version": "0.1.0",
	"title": "{project_name}",
	"category": "{category}",
	"icon": "{dashicon_slug}",
	"description": "{description}",
	"example": {},
	"supports": {
		"html": false
	},
	"textdomain": "{project_slug}",
	"editorScript": "file:./index.js",
	"editorStyle": "file:./index.css",
	"style": "file:./style-index.css",
	"viewScript": "file:./view.js"
}
```

**CRITICAL asset references** — these are the compiled filenames produced by `wp-scripts build`:
- `"editorScript": "file:./index.js"` — bundled JS (from src/index.js)
- `"editorStyle": "file:./index.css"` — compiled CSS (from src/editor.scss)
- `"style": "file:./style-index.css"` — compiled CSS (from src/style.scss)
- `"viewScript": "file:./view.js"` — bundled JS (from src/view.js)

**NEVER** reference `.scss` files directly in block.json — WordPress cannot process SCSS.

For dynamic blocks, add: `"render": "file:./render.php"`
For interactive blocks, add `"viewScript": "file:./view.js"` — use plain JavaScript with standard DOM APIs, never the WordPress Interactivity API.

## src/index.js — Block Registration

```js
import { registerBlockType } from '@wordpress/blocks';
import './style.scss';
import Edit from './edit';
import save from './save'; // static blocks only
import metadata from './block.json';

registerBlockType( metadata.name, {
	edit: Edit,
	save, // static blocks only
} );
```

## src/edit.js — Editor Component

```js
import { __ } from '@wordpress/i18n';
import { useBlockProps } from '@wordpress/block-editor';
import './editor.scss';

export default function Edit() {
	return (
		<p { ...useBlockProps() }>
			{ __( '{project_name}', '{project_slug}' ) }
		</p>
	);
}
```

## src/save.js — Save Function (static blocks only)

```js
import { useBlockProps } from '@wordpress/block-editor';

export default function save() {
	return (
		<p { ...useBlockProps.save() }>
			{'Content here'}
		</p>
	);
}
```

## src/render.php — Server Render (dynamic blocks only)

```php
<?php
/**
 * @see https://github.com/WordPress/gutenberg/blob/trunk/docs/reference-guides/block-api/block-metadata.md#render
 */
?>
<p <?php echo get_block_wrapper_attributes(); ?>>
	<?php esc_html_e( '{project_name}', '{project_slug}' ); ?>
</p>
```

## src/style.scss — Frontend + Editor Styles

```scss
.wp-block-{namespace}-block-{project_slug} {
	/* styles here */
}
```

## src/editor.scss — Editor-Only Styles

```scss
.wp-block-{namespace}-block-{project_slug} {
	/* editor-only styles here */
}
```

## src/view.js — Frontend Script

```js
/**
 * Front-end view script.
 *
 * @see https://developer.wordpress.org/block-editor/reference-guides/block-api/block-metadata/#view-script
 */
```

Remove this file and `viewScript` from block.json if not needed.

## package.json

```json
{
	"name": "{project_slug}",
	"version": "0.1.0",
	"description": "{description}",
	"author": "{author}",
	"license": "GPL-2.0-or-later",
	"main": "build/index.js",
	"scripts": {
		"build": "wp-scripts build",
		"format": "wp-scripts format",
		"lint:css": "wp-scripts lint-style",
		"lint:js": "wp-scripts lint-js",
		"packages-update": "wp-scripts packages-update",
		"plugin-zip": "wp-scripts plugin-zip",
		"start": "wp-scripts start"
	},
	"devDependencies": {
		"@wordpress/scripts": "^30.15.0"
	}
}
```

**CRITICAL:** Always include `@wordpress/scripts` in `devDependencies`. Always include `"main": "build/index.js"`.
