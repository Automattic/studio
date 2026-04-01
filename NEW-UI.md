# New UI Redesign

This branch (`new-app-interface`) is a ground-up redesign of the Studio desktop app interface. The goal is to replace the existing single-sidebar layout with a flexible, modern three-panel architecture while establishing a proper design token system.

## Status

**Proof of Concept** — The panel structure, color system, and navigation sidebar are functional. The nav panel displays real site data with full site management controls. The primary panel renders the existing SiteContentTabs. The secondary panel is still a placeholder.

## Architecture

### Three-Panel Layout

The app is built around three resizable panels using `react-resizable-panels`:

- **PanelNavigation** — Left sidebar with Tasks (placeholder) and Sites sections. Shows real site data via `SiteMenu` with drag-and-drop reordering and start/stop controls. Collapsible via `Cmd+B` or by dragging narrow.
- **PanelPrimary** — Main content area. White/frame background. Always visible. Renders `SiteContentTabs` for the selected site.
- **PanelSecondary** — Optional right panel for contextual content (browser preview, agent activity, etc). Collapsible via `Cmd+Shift+B`.

Each panel has min/max width constraints and drag-to-resize handles between them. Collapse/expand is animated. The primary panel toolbar adapts on macOS to make room for traffic lights when the nav panel is collapsed (including when collapsed via drag).

**Panel persistence**: Panel sizes are saved/restored via `react-resizable-panels`' `useDefaultLayout` hook using `localStorage`. Collapsed state is tracked separately under the `panelLayout:collapsed` key so panels restore correctly on reload.

### Navigation Sidebar

The sidebar (`sidebar.tsx`) has two sections:

- **Tasks** (top) — Placeholder section for future task/chat functionality.
- **Sites** (bottom, pinned) — Header with site count and Start all / Stop all toggle. Renders the existing `SiteMenu` component which provides drag-and-drop reordering, context menus, start/stop controls, and spinner states for operations in progress.

### Site Menu Updates

The `SiteMenu` component (`site-menu.tsx`) has been updated for the new UI:

- **Design tokens**: All hardcoded hex colors replaced with `chrome-*` tokens for proper light/dark mode support.
- **Animated drag-and-drop**: Items animate into position during drag using `translateY` transitions. An `orderMap` tracks each site's visual position while a `previewSites` state shows the reordered list. No empty spacer elements needed.

### Toolbar

A shared `Toolbar` component provides three slots -- `start`, `middle`, `end` -- where `middle` is absolutely centered regardless of the other slots' content width. Each panel has its own toolbar:

- **Nav toolbar**: Settings button (end)
- **Primary toolbar**: Nav toggle (start), project name (middle), secondary toggle (end)
- **Secondary toolbar**: Back/forward/refresh (start), URL bar (middle), more options (end)

Toolbars use `@wordpress/components` `Button` with `icon` prop and icons from `@wordpress/icons`.

### Color System

Two token families, both defined as CSS custom properties with light/dark mode variants:

**Chrome tokens** (`--color-chrome-*`) -- For the window background and navigation panel. Light mode uses a warm gray; dark mode uses near-black with white text at varying opacities.

**Frame tokens** (`--color-frame-*`) -- For content panels. These existed before and are unchanged.

All tokens are mapped to Tailwind classes (e.g., `bg-chrome`, `text-chrome-text-secondary`, `bg-frame`, `text-frame-text`). Panel separator handles also use these tokens.

### Settings Window

Settings opens in its own `BrowserWindow` rather than an in-app overlay. The renderer routes between the main app and settings based on a `?view=settings` URL parameter. Tabs: General, Account, Colors (token reference), WP Components, Studio Components.

The **Studio Components** tab renders real Studio components (SiteMenu, Sidebar) with mock data using `MockProviders` that supply a fake `siteDetailsContext`, Redux store, and other required providers.

## Key Files

```
apps/studio/src/
├── components/
│   ├── app.tsx                      # Root -- keyboard shortcuts, panel refs
│   ├── site-menu.tsx                # Site list with drag-and-drop (updated for tokens)
│   └── new-ui/
│       ├── panel-layout.tsx         # Three-panel layout with persistence
│       ├── toolbar.tsx              # Start/middle/end toolbar component
│       ├── sidebar.tsx              # Navigation: Tasks + Sites sections
│       ├── settings-root.tsx        # Settings window with 5 tabs
│       ├── studio-component-library.tsx # Studio component demos with mock data
│       ├── color-system-reference.tsx # Color token docs (in settings)
│       └── dev-controller.tsx       # Dev-only platform switcher
├── settings-window.ts               # Electron BrowserWindow for settings
├── index.css                        # Color token definitions
└── renderer.ts                      # Entry point with view routing
```

## Dev Tools

A floating dev controller (bottom-right, development builds only) lets you switch between macOS and Windows platform modes to test how the UI adapts -- traffic light insets, titlebar behavior, etc.

## What's Next

- Build out the Tasks section (chat/agent integration)
- Connect the browser preview in the secondary panel
- Add site creation flow to the sidebar
- Port remaining functionality from the legacy UI
