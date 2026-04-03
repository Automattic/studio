# New Site Creation Flow

## Overview

The site creation flow has been moved from a fullscreen modal in the main window to its own dedicated Electron window. This follows the same pattern as the settings window.

## Vision

Studio is being repositioned as a tool for building anything with WordPress — not just "sites." A WordPress project could be a blog, a book club, a baseball team, a cafe, a business, a portfolio, a community hub, anything. The creation flow uses "project" language throughout to reinforce this broader framing.

## Flow

### Step 1: Choose Path
Two options presented as cards:
- **Create new** → goes to chat-based creation
- **Bring existing** → goes to import source picker

### Step 2a: New Project (Chat-based)
A centered chat input where the user describes what they want to build. The prompt is open-ended: "A portfolio site for a photographer, a blog about hiking, a site for my local bakery..." Studio will use AI to set up the project based on the description.

### Step 2b: Import Existing Project
Four import sources presented as a vertical list:
- **WordPress.com** — pull from a connected wp.com account
- **Pressable** — pull from Pressable hosting
- **Jetpack Backup** — restore from a Jetpack backup archive
- **WordPress Export** — import from a .xml or .zip export file

## Architecture

### Window Creation (Main Process)

- **`src/add-site-window.ts`** — Creates and manages the add-site BrowserWindow. Singleton pattern (reuses existing window if already open). 900x600 default size with platform-specific titlebar handling.
- **IPC handlers** — `openAddSiteWindow` and `closeAddSiteWindow` added to `src/ipc-handlers.ts`, exposed via `src/preload.ts`.

### Renderer Routing

`src/renderer.ts` routes based on the `?view=` query param:
- No param → main app (`Root`)
- `?view=settings` → settings window (`SettingsRoot`)
- `?view=add-site` → add site window (`AddSiteRoot`)

### Components

- **`src/components/new-ui/add-site-root.tsx`** — Root component for the add-site window. Providers (Redux, i18n, Auth) and DotGrid background.
- **`src/components/new-ui/create-project/create-project-flow.tsx`** — Flow orchestrator with step routing. Contains the choose step, new project chat step, and choice card component.
- **`src/components/new-ui/create-project/import-project-step.tsx`** — Import source picker (wp.com, Pressable, Jetpack, WP export).

### Sidebar Integration

The "+ Add site" button in the sidebar (`src/components/new-ui/sidebar.tsx`) calls `getIpcApi().openAddSiteWindow()` to open the dedicated window. It lives inside the collapsible Projects section, below the site list.

## What Changed

| File | Change |
|---|---|
| `src/add-site-window.ts` | New — Electron window creation |
| `src/ipc-handlers.ts` | Added `openAddSiteWindow`, `closeAddSiteWindow` |
| `src/preload.ts` | Exposed new IPC methods |
| `src/renderer.ts` | Added `add-site` view routing |
| `src/components/new-ui/add-site-root.tsx` | New — window root with DotGrid background |
| `src/components/new-ui/create-project/create-project-flow.tsx` | New — flow orchestrator + choose/new steps |
| `src/components/new-ui/create-project/import-project-step.tsx` | New — import source picker |
| `src/components/new-ui/sidebar.tsx` | "+ Add site" button opens window via IPC |
| `src/components/new-ui/panel-layout.tsx` | Removed hidden `<AddSite>` modal mount |

## Terminology

- Use **"project"** instead of "site" in user-facing copy within the new creation flow
- Internal code (variable names, IPC channels, file names) keeps existing naming for now to avoid churn
- The sidebar already uses "Projects" as the section header
