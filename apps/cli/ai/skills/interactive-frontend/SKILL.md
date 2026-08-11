---
name: interactive-frontend
description: Build advanced WordPress frontend behavior with the right layer: core/plugin blocks, custom blocks, Interactivity API, viewScriptModule, enqueued JavaScript, progressive enhancement, editor fallbacks, accessibility, and performance.
user-invokable: true
---

# Interactive Frontend

Use this skill before writing custom JavaScript, reactive UI, animation systems, custom interactive blocks, third-party embed behavior, canvas/WebGL, or any frontend feature that may not be fully represented by block attributes.

## Behavior Ownership Ladder

1. **Core block**: use an existing core block when it already provides the behavior.
2. **Plugin block**: use a plugin block when the feature has durable backend behavior such as forms, ecommerce, booking, LMS, memberships, maps, or integrations.
3. **Custom block**: build a block when the behavior is reusable, content-bearing, configurable, or should appear in the inserter.
4. **Interactivity API**: use for block-owned reactive frontend behavior that needs shared state, directives, navigation without full reloads, counters, toggles, filters, instant search, carts, or coordinated UI.
5. **Plain enqueued JavaScript**: use only for progressive enhancement, animation orchestration, custom cursors, analytics hooks, third-party embeds, canvas/WebGL, or intentionally frontend-only effects.

Do not place important behavior in raw `core/html` scripts. Package it in a theme, plugin, or block asset.

## Interactivity API Path

For reusable reactive block behavior:

- Use `block.json` with `apiVersion: 3`.
- Add `"supports": { "interactivity": true }` when the block uses directives.
- Use `viewScriptModule` for the frontend module.
- Use `@wordpress/interactivity` stores and `data-wp-*` directives.
- Use `render.php` or saved markup that emits valid, semantic HTML before hydration.
- Keep server-rendered content meaningful so the page works before JavaScript runs.

## Plain JavaScript Path

Plain JS is acceptable for effects and integrations that are not editor-native. Requirements:

- Enqueue it from the theme or plugin, not inside page content.
- Scope selectors to a stable wrapper or block class.
- Keep CSS default state visible; JS may add the hidden/animated initial state on the front end.
- Respect `prefers-reduced-motion`.
- Do not make essential text, links, forms, or navigation depend on JavaScript that does not run in the editor.
- Provide a static editor-visible fallback or placeholder when the editor cannot run the behavior.

## Verification

- Validate block content with `validate_blocks`.
- Verify the front end with screenshots or DOM inspection.
- Verify the editor still shows meaningful content and layout.
- Test keyboard/focus behavior for interactive controls.
- Check that assets load only where needed and do not add global frontend weight unnecessarily.
