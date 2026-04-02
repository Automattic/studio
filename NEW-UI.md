# New UI Redesign

This branch (`new-app-interface`) is a ground-up redesign of the Studio desktop app interface. The goal is to replace the existing single-sidebar layout with a flexible, modern three-panel architecture while establishing a proper design token system.

## Status

**Proof of Concept** — The panel structure, color system, navigation sidebar, and settings window are functional. The nav panel displays real site data with full site management controls. The primary panel renders the existing SiteContentTabs. The settings window contains all app settings (migrated from the old modal). The secondary panel is still a placeholder.

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

- **Tasks** (top) — Task list with create, archive, and clear-archived controls. See `NEW-AGENT.md` for full details.
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

Settings opens in its own `BrowserWindow` rather than an in-app overlay. The renderer routes between the main app and settings based on a `?view=settings` URL parameter. The old modal-based settings UI has been fully removed — all settings now live in this window.

**Tabs (user-facing):**
- **General** — Appearance (color scheme), language, code editor, terminal, Studio CLI toggle. All settings save instantly on change (no Save/Cancel buttons).
- **Account** — User info with Gravatar, logout, preview site quota/management, AI assistant prompt usage. Shows login prompt when not authenticated.
- **Skills** — Global WordPress skills management (install/remove across all sites).
- **MCP** — MCP server configuration JSON with copy button.

**Tabs (dev-only, development builds):**
- **Automattician** — Platform override for UI testing (replaces the old floating DevController).
- **Colors** — Color token reference documentation.
- **WP Components** — WordPress component library showcase.
- **Studio Components** — Studio component demos with mock data.

**Tab deep-linking:** `openSettingsWindow('skills')` opens the window directly to a specific tab via URL parameter (`?view=settings&tab=skills`). If the window is already open, it reloads to the requested tab and focuses.

**Providers:** The settings window wraps with Redux, I18n, and Auth providers (minimal subset of the main app's provider stack — no site/theme/onboarding providers needed).

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
│       ├── settings-root.tsx        # Settings window with all app settings
│       ├── studio-component-library.tsx # Studio component demos with mock data
│       └── color-system-reference.tsx # Color token docs (in settings)
├── settings-window.ts               # Electron BrowserWindow for settings
├── index.css                        # Color token definitions
└── renderer.ts                      # Entry point with view routing
```

## Dev Tools

Platform switching for UI testing lives in the settings window's **Automattician** tab (dev builds only). Changes propagate to the main window via `localStorage` cross-window events.

## What's Next

- Build out the Tasks section (chat/agent integration)
- Connect the browser preview in the secondary panel
- Add site creation flow to the sidebar
- Port remaining functionality from the legacy UI
