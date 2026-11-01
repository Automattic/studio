# Layout concepts

One file per concept, from which `scaffold_theme` draws one at random for a new block theme and gives the agent its `title`, `description` and body — a **Build** line and a **Fallback** line. Values in the frontmatter are JSON strings so they can hold colons and quotes.

A concept is about layout only: the spatial structure of the page, how sections relate to the viewport and to each other. Color, typography, and scroll motion belong to the artistic directions. The bar for an entry: a template would never ship it, and a visitor would describe it to a friend. Every concept must be buildable inside a block theme with the tools Studio Code has — `theme.json`, `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Content stays editable in blocks.
