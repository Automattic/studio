---
name: annotate
description: Open a browser with visual annotation tools. The user clicks elements on their site and leaves feedback — the agent reads annotations and makes changes. Use this when the user wants to point at specific elements to fix, tweak, or redesign.
user-invokable: true
tools: open_annotation_browser
---

# Visual Annotations

`open_annotation_browser` opens the site for the user to click elements and leave notes on them, and returns the notes when the user clicks **Send**. Each note gives the page, the comment, and the element's selector, nearby text, and computed styles.

Address the notes in the order they were sent. To the user, name each element by what they see — its tag and nearby text — not by its selector.

An element is rendered by the page's content or by the active theme — a template, part, or pattern, its theme.json, or its style.css — and its `wp-block-*` classes name its block. Make each change where the element is rendered, then tell the user what changed. Another round is another `open_annotation_browser` call.
