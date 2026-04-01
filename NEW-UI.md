# New UI Redesign

This branch (`new-app-interface`) is a ground-up redesign of the Studio desktop app interface. The goal is to replace the existing single-sidebar layout with a flexible, modern three-panel architecture while establishing a proper design token system.

## Status

**Proof of Concept** — The panel structure, color system, and component scaffolding are in place. Content panels are placeholders. None of the existing site management functionality is wired up yet.

## Architecture

### Three-Panel Layout

The app is built around three resizable panels using `react-resizable-panels`:

- **PanelNavigation** — Left sidebar for project/chat navigation. Transparent background (shows the chrome/window color). Collapsible via `Cmd+B`.
- **PanelPrimary** — Main content area. White/frame background. Always visible. Shows the active view for the selected project.
- **PanelSecondary** — Optional right panel for contextual content (browser preview, agent activity, etc). Collapsible via `Cmd+Shift+B`.

Each panel has min/max width constraints and drag-to-resize handles between them. Collapse/expand is animated. The primary panel toolbar adapts on macOS to make room for traffic lights when the nav panel is collapsed.

### Toolbar

A shared `Toolbar` component provides three slots — `start`, `middle`, `end` — where `middle` is absolutely centered regardless of the other slots' content width. Each panel has its own toolbar:

- **Nav toolbar**: Settings button (end)
- **Primary toolbar**: Nav toggle (start), project name (middle), secondary toggle (end)
- **Secondary toolbar**: Back/forward/refresh (start), URL bar (middle), more options (end)

Toolbars use `@wordpress/components` `Button` with `icon` prop and icons from `@wordpress/icons`.

### Color System

Two token families, both defined as CSS custom properties with light/dark mode variants:

**Chrome tokens** (`--color-chrome-*`) — For the window background and navigation panel. Light mode uses a warm gray; dark mode uses near-black with white text at varying opacities.

**Frame tokens** (`--color-frame-*`) — For content panels. These existed before and are unchanged.

All tokens are mapped to Tailwind classes (e.g., `bg-chrome`, `text-chrome-text-secondary`, `bg-frame`, `text-frame-text`).

### Settings Window

Settings now opens in its own `BrowserWindow` rather than an in-app overlay. The renderer routes between the main app and settings based on a `?view=settings` URL parameter. Tabs: General, Account, Colors (token reference).

## Key Files

```
apps/studio/src/
├── components/
│   ├── app.tsx                      # Root — keyboard shortcuts, panel refs
│   └── new-ui/
│       ├── panel-layout.tsx         # Three-panel layout with react-resizable-panels
│       ├── toolbar.tsx              # Start/middle/end toolbar component
│       ├── sidebar.tsx              # Navigation panel content (placeholder)
│       ├── site-details.tsx         # Primary panel content (placeholder)
│       ├── browser-panel.tsx        # Secondary panel content (placeholder)
│       ├── settings-root.tsx        # Settings window root
│       ├── color-system-reference.tsx # Color token docs (in settings)
│       └── dev-controller.tsx       # Dev-only platform switcher
├── settings-window.ts               # Electron BrowserWindow for settings
├── index.css                        # Color token definitions
└── renderer.ts                      # Entry point with view routing
```

## Dev Tools

A floating dev controller (bottom-right, development builds only) lets you switch between macOS and Windows platform modes to test how the UI adapts — traffic light insets, titlebar behavior, etc.

## What's Next

- Wire up site data to the navigation panel
- Build out the primary panel views (site details, chat)
- Connect the browser preview in the secondary panel
- Port remaining functionality from the legacy UI
