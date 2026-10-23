---
name: annotate
description: Open a browser with visual annotation tools. The user clicks elements on their site and leaves feedback — the agent reads annotations and makes changes. Use this when the user wants to point at specific elements to fix, tweak, or redesign.
user-invokable: true
tools: open_annotation_browser
---

# Visual Annotations

Open a browser where the user can click elements on their WordPress site and annotate them with feedback. You read those annotations and make the requested changes.

## On Startup

When the user invokes this skill, introduce yourself:

> **Visual Annotations** — I'll open your site in a browser. Click any element, leave a note, and I'll fix it.

Then identify the target site. If there's an active site, use it. If there are multiple, ask which one.

## Workflow

### 1. Open the browser

Call `site_info` to get the site URL — do NOT guess the URL or port.

In the same message, tell the user:
> I'm opening your site in a browser. Click any element on the page and leave a note — you can paste images too — then press Enter to save it. Click **Send** when you're finished.

Then call `open_annotation_browser` with the site URL. It opens a headed browser where clicking an element opens a note editor next to it, with a **Cancel** / **Send** bar at the bottom of the page, and waits there until the user is done.

### 2. Read the annotations

When the user clicks **Send**, `open_annotation_browser` returns their annotations in the same format as annotations sent from the Studio preview, with any images they attached. If the user cancels or closes the window instead, it says so. If it times out, the browser is still open with the user's notes: call it again to keep waiting.

Each annotation includes the page, the user's comment, and the element's selector, nearby text and computed styles.

### 3. Review the annotations

Address the annotations in the order they were submitted. When you reference one for the user, identify the element by what they can see — the tag name plus its nearby text — rather than by selector. Selectors are noisy and unreadable; use them only for implementation.

### 4. Make changes

For each annotation:
1. **Identify what to change:**
   - Use the CSS selector to find the element in theme templates or stylesheets
   - Use `wp_cli` with `post list --post_type=wp_template --format=json` to check if it's in a template override
   - Use `wp_cli` with `eval "echo wp_get_custom_css();"` to check existing custom CSS
2. **Apply the change using the right approach:**
   - For style changes (colors, sizes, spacing): use Global Styles custom CSS with the selector from the annotation
   - For content changes (text, headings, block structure): edit the template or post content via WP-CLI
   - For block-level changes: identify the WordPress block type from the HTML structure (look for `wp-block-*` classes) and modify accordingly
3. Take a screenshot to verify the change looks correct

### 5. Verify

After all annotations are addressed, take a screenshot and confirm with the user.

The browser closes when the user clicks **Send**. If they want another round, run the skill again from the top — `/annotate` opens a fresh browser.

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
