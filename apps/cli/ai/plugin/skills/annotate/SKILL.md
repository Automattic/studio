---
name: annotate
description: Open a browser with visual annotation tools. The user clicks elements on their site and leaves feedback — the agent reads annotations and makes changes. Use this when the user wants to point at specific elements to fix, tweak, or redesign.
user-invokable: true
---

# Visual Annotations

Open a browser where the user can click elements on their WordPress site and annotate them with feedback. You read those annotations and make the requested changes.

## On Startup

When the user invokes this skill, introduce yourself:

> **Visual Annotations** — I'll open your site in a browser with an annotation toolbar. Click any element, type your feedback, and I'll fix it.

Then identify the target site. If there's an active site, use it. If there are multiple, ask which one.

## Workflow

### 1. Clear old annotations

Before opening the browser, dismiss all pending annotations from previous sessions so you start fresh. Use `agentation_get_all_pending`, then `agentation_dismiss` on each one.

### 2. Open the browser

Call `site_info` to get the site URL — do NOT guess the URL or port.

**First, check for cmux** by running `test -S /tmp/cmux.sock && echo "cmux" || echo "no cmux"`.

**If cmux is available**, use it for a side-by-side browser pane:

```bash
cmux browser open "<URL>"
```
Capture `surface:NN` from output, then:
```bash
cmux browser surface:NN wait --load-state complete --timeout-ms 15000
cmux browser surface:NN eval 'import("https://esm.sh/react@18").then(function(R) { return import("https://esm.sh/react-dom@18/client?deps=react@18").then(function(RD) { return import("https://esm.sh/agentation@3?deps=react@18,react-dom@18").then(function(Ag) { var c = document.createElement("div"); c.id = "__agentation-root"; document.body.appendChild(c); RD.createRoot(c).render(R.default.createElement(Ag.PageFeedbackToolbarCSS, { endpoint: "http://localhost:4747" })); }); }); }); "ok"'
```

**If cmux is NOT available**, use the `open_annotation_browser` tool with the site URL. This opens a standalone Playwright browser with Agentation injected.

Tell the user:
> The browser is open. Click the **circle icon** in the bottom-right corner to activate the toolbar, then click any element to annotate it. Let me know when you're done.

### 3. Read annotations

Use `agentation_get_all_pending` to get unresolved annotations. Filter results:
- **Only** act on annotations whose `url` matches the current site URL
- **Only** act on annotations the user just created in this session — check timestamps and ignore old ones
- Ask the user to confirm the list before making changes if there are annotations you didn't expect

Each annotation includes:
- **CSS selector / elementPath** — use to find the element in the theme or via WP-CLI
- **Computed styles** — current CSS values (colors, sizes, spacing)
- **nearbyText** — visible text content of the element
- **User feedback (comment)** — what the user wants changed

### 4. Make changes

For each annotation:
1. Use `agentation_acknowledge_annotation` to signal you're working on it
2. **Identify what to change:**
   - Use the CSS selector to find the element in theme templates or stylesheets
   - Use `wp_cli` with `post list --post_type=wp_template --format=json` to check if it's in a template override
   - Use `wp_cli` with `eval "echo wp_get_custom_css();"` to check existing custom CSS
3. **Apply the change using the right approach:**
   - For style changes (colors, sizes, spacing): use Global Styles custom CSS with the selector from the annotation
   - For content changes (text, headings, block structure): edit the template or post content via WP-CLI
   - For block-level changes: identify the WordPress block type from the HTML structure (look for `wp-block-*` classes) and modify accordingly
4. Take a screenshot to verify the change looks correct
5. Use `agentation_resolve_annotation` with a summary of what was changed

### 5. Verify

After all annotations are addressed, take a screenshot and confirm with the user.

## Making changes the WordPress way

Always prefer WordPress APIs over direct file edits or custom plugins.

### CSS / design changes

Use **Global Styles custom CSS** — never create throwaway plugins:
```
wp eval 'echo wp_get_custom_css();'   → read current custom CSS
wp eval 'wp_update_custom_css_post("CSS HERE");'   → update custom CSS
```

### Template changes

Create **template overrides via the database**, not file edits:
```
wp post create --post_type=wp_template --post_name="theme-slug//template-name" --post_content="BLOCK MARKUP" --post_status=publish
```

### When to use what

- **Tweaking an existing site**: Prefer Global Styles custom CSS and template overrides in the database — these are non-destructive and easy to revert
- **Building a theme or new site**: Edit theme files directly — that's the job. Follow Studio's existing guidelines for block themes (theme.json, templates/, style.css)
- **Never**: Modify WordPress core files
