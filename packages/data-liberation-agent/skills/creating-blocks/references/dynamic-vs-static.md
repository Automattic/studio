# Dynamic v Static vs. Interactive Blocks

A block can be either dynamic or static:

**Static Block:**
- Output saved in post-content
- Uses save.js
- No render.php
- "render" not in block.json
- Best for fixed content

**Dynamic Block:**
- Output rendered by PHP at runtime
- Uses render.php
- No save.js
- "render": "file:./render.php" in block.json
- Best for live or database-driven content

**Interactive Block:**
- Output rendered by PHP at runtime (always dynamic)
- Uses render.php with standard HTML attributes and CSS classes
- Uses view.js with plain JavaScript and standard DOM APIs (never the WordPress Interactivity API)
- `"viewScript": "file:./view.js"` in block.json
- `"render": "file:./render.php"` in block.json
- No save.js
- Best for: accordions, tabs, modals, toggles, counters, carousels, search filters, and any block needing frontend user interaction
