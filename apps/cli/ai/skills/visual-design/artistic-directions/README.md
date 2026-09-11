# Artistic directions

One file per direction, read by the `visual-design` skill and the `pick_design` tool. The frontmatter `title` and `description` are what the agent sees when choosing; the body — the **Palette**, **Type**, **Surface**, **Shapes**, **Imagery**, **Motion**, and **Avoid** lines — is only returned for the entries that get drawn. Values in the frontmatter are JSON strings so they can hold colons and quotes.

A direction is everything a layout concept leaves open: color, type, surfaces, shapes, how imagery is treated, how things move. Any direction must be able to dress any concept, and the description should say what the site feels like and who it suits. Same buildability bar as the concepts: `theme.json`, `style.css`, patterns, a small vanilla script; no external libraries, no sourced media.
