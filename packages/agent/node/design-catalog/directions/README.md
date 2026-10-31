# Artistic directions

One file per direction, from which `create_theme` draws one at random for a new block theme and gives the agent its `title`, `description` and body — the **Palette**, **Type**, **Surface**, **Shapes**, **Imagery**, **Motion**, and **Avoid** lines. Values in the frontmatter are JSON strings so they can hold colons and quotes.

A direction is everything a layout concept leaves open: color, type, surfaces, shapes, how imagery is treated, how things move. Any direction must be able to dress any concept, and the description should say what the site feels like and who it suits. Same buildability bar as the concepts: `theme.json`, `style.css`, patterns, a small vanilla script; no external libraries, no sourced media.
