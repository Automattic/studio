# UI Desks Architecture

This folder documents the structural decisions for `apps/ui/src/ui-desks`.

## Folder Rules

Use these rules when adding or moving files:

- UI component: create a folder with `index.tsx`, `style.module.css`, and optional `index.test.tsx`.
- Logic module with tests: create a folder with `index.ts` and `index.test.ts`.
- Small one-off file with no styles or tests: keep it flat.
- Shared feature with multiple files: create a folder, even if it is not a component.

The goal is that medium and large things are easy to scan by folder name, while small one-off utilities do not create unnecessary nesting.

## Top-Level Boundaries

- `desk`: canvas runtime, provider state, tldraw integration, drawing tools, selection toolbar, and desk-local context menu behavior.
- `focus-mode`: generic focused-widget sessions, including the focused root widget and transient focus desk records that should not persist.
- `annotations`: annotation workflow on top of focus mode, including inspector injection, temporary annotation widgets, comment UI, and chat prompt formatting.
- `chrome`: app-level desk controls around the canvas, such as header, toolbar rows, menus, settings, site-map title, and link dialogs.
- `widgets`: widget types only. Each child folder represents a widget type and owns its component, definition, types, styles, and widget-local helpers.
- `widget-actions`: cross-widget behavior such as creation, edit actions, file handling, paste handling, geometry, URL helpers, post status, and feature availability.
- `chats`: desk chat UI, session surfaces, composer UI, and widget context rendering for chat.
- `components`: shared primitive UI components used by ui-desks.
- `controls`: reusable widget control renderers.
- `site-map`: site-map desk config and hooks.
- `stacks`: stack behavior, stack canvas helpers, and stack badges.
- `shapes`: tldraw shape definitions for desk widgets.
- `site-desk` and `user-desk`: route-level entry points for specific desk modes.

## Widget Folder Boundary

The `widgets` folder should stay focused on widget types. Do not place generic widget workflows such as creation, toolbar actions, file/paste handlers, or URL helpers at the root of `widgets`.

Use this pattern for widget type folders:

```text
widgets/<type>/
  component/
    index.tsx
    style.module.css
  definition.ts
  types.ts
  optional-widget-local-helper.ts
```

Use nested folders for tested logic modules inside widget types:

```text
widgets/<type>/<logic-module>/
  index.ts
  index.test.ts
```

## Chrome vs Desk

Use `chrome` for controls around the desk experience: headers, menus, toolbar layout, settings, and dialogs launched from the surrounding UI.

Use `desk` for canvas behavior and state that depends on tldraw or direct desk interactions: canvas rendering, context menu state, selection toolbar, provider state, and tldraw adapters.

If a feature is launched from chrome but mutates widgets, keep the UI in `chrome` and place reusable widget mutation logic in `widget-actions`.

## Shared Logic

Prefer shared modules when the same behavior is needed by chrome, context menus, providers, and tests. For example, widget availability, existing content picking, paste handling, and post status formatting live under `widget-actions` instead of being duplicated across UI folders.

Tested shared logic should use the `index.ts` and `index.test.ts` folder shape.
