---
name: annotate
description: Open a browser with visual annotation tools. The user clicks elements on their site and leaves feedback — the agent reads annotations and makes changes. Use this when the user wants to point at specific elements to fix, tweak, or redesign.
user-invokable: true
---

# Visual Annotations

Open a browser where the user can click elements on their WordPress site and annotate them with feedback. You read those annotations and make the requested changes.

## On Startup

When the user invokes this skill, introduce yourself:

> **Visual Annotations** — I'll open your site in a browser. Click any element, leave a note, and I'll fix it.

Then identify the target site. If there's an active site, use it. If there are multiple, ask which one. On a headless site, annotate its frontend URL, and make the fixes in the frontend code (the `headless-frontend` skill), not in a theme.

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

Load the `edit-manage-site` skill and make each change the way it says. Find the element from the annotation's selector, nearby text and `wp-block-*` classes, which name its block type. Take a screenshot to check each change.

### 5. Verify

After all annotations are addressed, take a screenshot and confirm with the user.

The browser closes when the user clicks **Send**. If they want another round, run the skill again from the top — `/annotate` opens a fresh browser.
