# Block File Templates

### readme.md
Purpose: WordPress plugin readme with metadata and documentation.
- Follow WordPress plugin readme format
- Include the plugin header with Contributors, Tags, License
- Provide Description, Installation, FAQ, Changelog sections

### block-slug.php
Purpose: Main WordPress plugin file that registers the block.
- Include WordPress plugin header
- Guard with ABSPATH check
- Register a block with register_block_type()
- Always guard functions with function_exists()
- Never close the final PHP tag
- No spaces before `<?php` opening tag

### src/block.json
Purpose: Block metadata configuration defining all block properties.
- Use apiVersion: 3
- Name format: namespace/block-{slug}
- Icon must be valid Dashicon slug
- Include supports, editorScript, editorStyle, style
- Dynamic blocks only: Add "render": "file:./render.php"

### src/index.js
Purpose: Entry point that registers the block with WordPress.
- Import registerBlockType from @wordpress/blocks
- Import metadata from ./block.json
- Import Edit component
- Static blocks only: Import and register save function
- Import styles

### src/edit.js
Purpose: Defines block appearance and behavior in the editor.
- Always use useBlockProps() and spread on wrapper element
- Import __() from @wordpress/i18n for translations
- Import useBlockProps from @wordpress/block-editor
- Import ./editor.scss for editor-only styles
- Return JSX for editor display

### src/save.js
Purpose: Defines static HTML saved to post content (static blocks only).
- Only for static blocks (omit for dynamic blocks)
- Always use useBlockProps.save() and spread on wrapper
- Return JSX (serialized to HTML)
- No translations needed (content is static)

### src/render.php
Purpose: Server-side render callback (dynamic blocks only).
- Only for dynamic blocks (omit for static blocks)
- Use get_block_wrapper_attributes() for wrapper
- Use esc_html_e() or esc_html__() for translations
- Access block data via $attributes and $content parameters
- Never close the final PHP tag

### src/style.scss
Purpose: Styles applied to both front-end and editor.
- Use block class: .wp-block-{namespace}-{slug}
- Keep minimal and functional

### src/editor.scss
Purpose: Styles applied only in editor.
- Use same block class
- Visual indicators for editor features

### src/view.js
Purpose: Front-end JavaScript for interactive behavior (optional).
- Plain JavaScript only (no React)
- Use WordPress Interactivity API when possible
- Remove file and viewScript from block.json if not needed

### package.json
Purpose: npm package configuration with build scripts.
- Update name and description only
- Keep all scripts unchanged
- Dependencies managed at project level
