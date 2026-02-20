# Dynamic vs Static Blocks

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
