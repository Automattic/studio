---
name: accessibility-polish
description: Review and fix WordPress site accessibility for block themes and generated content: landmarks, heading order, semantic blocks, alt text, link/button behavior, keyboard/focus states, color contrast, reduced motion, and editor-visible fallbacks.
user-invokable: true
---

# Accessibility Polish

Use this skill when reviewing or fixing accessibility on a generated or redesigned WordPress site.

## Checklist

- **Structure**: Use semantic blocks for headings, paragraphs, lists, quotes, buttons, navigation, search, and forms. Do not replace semantic content with decorative HTML.
- **Landmarks**: Ensure templates and parts produce a sensible header, main content area, navigation, and footer.
- **Headings**: Use one page-level `h1`, preserve heading order, and do not use heading levels for visual size alone.
- **Images**: Add descriptive alt text for content images and empty `alt=""` for decorative images.
- **Links and buttons**: Use links for navigation and buttons for actions. Avoid empty anchors and icon-only controls without labels.
- **Keyboard and focus**: Interactive controls must be reachable and operable by keyboard with visible focus states.
- **Contrast**: Use palette choices that preserve readable text contrast. Do not disable useful contrast warnings.
- **Motion**: Respect `prefers-reduced-motion`; avoid making content depend on scroll or animation to become visible.
- **Editor fallback**: If frontend JavaScript enhances the experience, the editor must still show meaningful content and layout.

## Fixing Layer

Fix accessibility at the highest appropriate layer:

- Content and heading issues: edit block content.
- Template landmark issues: edit templates and template parts.
- Color contrast and typography defaults: use `theme.json` presets/styles.
- Focus states and unsupported states: use theme CSS.
- Complex custom controls: use a custom block or plugin with accessible markup and behavior.

## Verification

After fixes, run `validate_blocks` for changed block content and use screenshots or DOM inspection to confirm the visible result. For interactive work, manually reason through keyboard order, focus visibility, and reduced-motion behavior.
