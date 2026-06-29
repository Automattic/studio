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

### 1. Open the browser

Call `site_info` to get the site URL — do NOT guess the URL or port.

Use the `open_annotation_browser` tool with the site URL. This opens a headed browser with the Studio annotation inspector injected — a small dark pill in the bottom-right with **"Annotate"** and **"Done"** buttons.

Tell the user:
> The browser is open. Click **Annotate** in the bottom-right toolbar, click any element on the page, type your feedback, then click **Done** when you're finished.

### 2. Wait for the user to submit

Call `wait_for_annotations`. This blocks until the user clicks **Done** and returns the annotations they wrote, captured straight from the page.

Each annotation includes:
- **CSS selector / elementPath** — use to find the element in the theme or via WP-CLI
- **Computed styles** — current CSS values (colors, sizes, spacing)
- **nearbyText** — visible text content of the element
- **User feedback (comment)** — what the user wants changed
- **pathname** — which page of the site the annotation was made on

### 3. Review the annotations

Address the annotations in the order they were submitted. When you reference one for the user, identify the element by what they can see — the tag name plus `nearbyText` — rather than by selector. Selectors are noisy and unreadable; use them only for implementation.

If the user wants to re-annotate, point them back to the open browser and call `wait_for_annotations` again — the inspector keeps working without re-opening the browser.

### 4. Make changes

For each annotation:
	1. **Identify what to change:**
	   - Use the CSS selector to find the element in theme templates or stylesheets
	   - Use `wp_cli` with `post list --post_type=wp_template --format=json` to check if it's in a template override
	   - Use `wp_cli` with `eval "echo wp_get_custom_css();"` to check existing custom CSS
	2. **Apply the change using the right approach:**
	   - For normal block styling (colors, sizes, spacing, width, alignment): prefer block attributes, `theme.json`, or Global Styles settings that remain visible/editable in the editor
	   - Use Global Styles custom CSS only for unsupported selectors, pseudo-elements, responsive glue, plugin cleanup, effects, or quick reversible tweaks that cannot be represented as block settings
	   - For content changes (text, headings, block structure): edit the template or post content via WP-CLI
	   - For block-level changes: identify the WordPress block type from the HTML structure (look for `wp-block-*` classes) and modify accordingly
	   - For behavior changes: load `interactive-frontend` and choose a core/plugin block, custom block, Interactivity API, or progressive-enhancement script
	3. Take a screenshot to verify the change looks correct

### 5. Verify

After all annotations are addressed, take a screenshot and confirm with the user.

The browser window auto-closes about 10 seconds after the user clicks **Done**, so by the time you finish making changes it's already gone. If they want another round, run the skill again from the top — `/annotate` opens a fresh browser. Don't try to "reattach" to the previous window.

## Making changes the WordPress way

Always prefer WordPress APIs over direct file edits or custom plugins.

### Design changes

Use editor-native styling first. For colors, type, spacing, and layout, update block attributes, `theme.json`, or Global Styles where possible. Use **Global Styles custom CSS** only when the editor has no matching control, and never create throwaway plugins:
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
- **Tweaking editor-native styling**: Prefer block attributes or Global Styles controls so the change is visible in the editor; use custom CSS only as the escape hatch
- **Building a theme or new site**: Edit theme files directly — that's the job. Follow Studio's existing guidelines for block themes (theme.json, templates/, style.css)
- **Never**: Modify WordPress core files
