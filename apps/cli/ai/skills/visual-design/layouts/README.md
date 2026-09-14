# Layout concepts

One file per concept, read by the `visual-design` skill and the `pick_design` tool. The frontmatter `title` and `description` are what the agent sees when choosing; the body — a **Build** line and a **Fallback** line — is only returned for the entries that get drawn. Values in the frontmatter are JSON strings so they can hold colons and quotes.

A concept is about layout only: the spatial structure of the page, how sections relate to the viewport and to each other. Color, typography, and scroll motion belong to the artistic directions. The bar for an entry: a template would never ship it, and a visitor would describe it to a friend. Every concept must be buildable inside a block theme with the tools Studio Code has — `theme.json`, `style.css`, patterns, and a small vanilla script enqueued from `functions.php`. No external libraries or CDNs, no WebGL or canvas, no sourced media. Content stays editable in blocks.
