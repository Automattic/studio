# Studio 2.0 UI Design Spec

## Goal

Create a new branch that turns the current Agentic UI into **Studio 2.0** by adding the global Desks experience as a sidebar destination. Studio 2.0 replaces the separate user-facing Agentic UI and Desks UI mode options.

## Product Direction

Studio 2.0 is not a third independent shell. It is the current Agentic UI, renamed, with Desk added as a first-class view.

The default Studio UI remains available as the stable/current experience. Studio 2.0 becomes the single experimental next-generation experience. Users should no longer see separate **Agentic UI** and **Desks UI** choices in Settings or switcher menus.

## User Experience

When Studio 2.0 is active, the existing Agentic sidebar remains the primary navigation surface. The sidebar should include:

- Chat
- Desk
- Settings
- Skills

Clicking **Desk** opens the global user desk by default. It does not infer a site-specific desk from the current session or selected site.

The Desk view replaces only the right-side content area of the Agentic shell. The Agentic sidebar remains visible and usable. The embedded Desk keeps the full Desks experience:

- Desk toolbar
- Desk create menu
- Desk settings
- Desk canvas
- Desk widget toolbar
- Desk chat panel
- User desk persistence

The standalone Desks UI can remain in code as reusable internals, but it should no longer be exposed as a top-level user-facing mode.

## Mode Model

The app should expose two user-facing UI modes:

- Default Studio UI
- Studio 2.0

The persisted Studio 2.0 mode should use a stable internal key, recommended: `studio2`.

Legacy stored values should be treated as compatibility aliases:

- `agentic` resolves to `studio2`
- `desks` resolves to `studio2`
- `studio2` resolves to `studio2`
- `default` resolves to `default`
- invalid or missing values resolve to `default`

New writes should persist only normalized values. If a user selects Studio 2.0, config should store `desks.defaultUiMode: "studio2"`, not `agentic` or `desks`.

Renderer launch URLs should use `studio-ui-mode=studio2` for Studio 2.0. Legacy query values `agentic` and `desks` should still launch the Studio 2.0 shell for compatibility.

## Architecture

Studio 2.0 should reuse the current Agentic shell by rendering `ClassicUiApp`. The existing `ClassicUiApp` router already owns the Agentic sidebar layout and right-side content area, so the Desk integration should be route-based inside that router.

Add a new route under the existing dashboard layout:

- Path: `/desk`
- Parent: `dashboardLayoutRoute`
- Component: a small wrapper that renders the global Desks `<Desk />` without a `siteId`

This route should inherit `SidebarLayout`, so the Desk surface appears in the Agentic right-side panel while the sidebar remains visible.

The route should import the reusable Desks `Desk` component from `apps/ui/src/ui-desks/desk`. It should not mount `DesksUiApp`, because that would create a second top-level router and app shell inside the Agentic shell.

## Component Boundaries

Primary files expected to change:

- `tools/common/types/desk.ts`: add the normalized `studio2` mode while preserving legacy type handling where needed.
- `apps/studio/src/main-window.ts`: normalize stored UI mode and load the Studio 2.0 renderer path/query.
- `apps/studio/src/modules/desks/lib/ipc-handlers.ts`: normalize mode reads and writes, including legacy values.
- `apps/studio/src/modules/user-settings/components/preferences-tab.tsx`: show Studio 2.0 as the single next-generation option instead of separate Desks and Agentic buttons.
- `apps/ui/src/app/use-ui-mode.ts`: map `studio2`, `agentic`, and `desks` launch params to the Agentic shell mode.
- `apps/ui/src/components/sidebar-nav/index.tsx`: add the Desk sidebar item.
- `apps/ui/src/ui-classic/router/router.tsx`: register the new Desk route.
- `apps/ui/src/ui-classic/router/route-desk/index.tsx`: render the embedded global Desk.

Tests should live near the affected code, following the repo's current patterns.

## Data Flow

Settings calls `setStudioUiMode( "studio2" )`. The main process validates and normalizes the value, persists it under `userData.desks.defaultUiMode`, and reloads the renderer.

At app launch, the main process reads `userData.desks.defaultUiMode`, normalizes it, and selects the renderer:

- `default`: existing default renderer
- `studio2`, `agentic`, or `desks`: Desks renderer bundle with `studio-ui-mode=studio2`

Inside the Desks renderer bundle, `useUiMode()` treats `studio2`, `agentic`, and `desks` as the Agentic shell. The `/desk` route is then responsible for embedding the global Desk within that shell.

## Error Handling

Invalid mode values should never break startup. They should fall back to `default`.

Legacy values should not be destructive. Reading `agentic` or `desks` should launch Studio 2.0 even before the next settings write normalizes the stored value.

The embedded Desk route should use the existing global Desk behavior. If Desk data is still loading, existing Desks loading and placeholder states should render unchanged.

## Accessibility And Interaction

The Desk sidebar item should behave like the existing Chat and Settings items:

- Uses the existing `SidebarButton` pattern
- Has an icon and localized label
- Supports active route styling
- Works with keyboard navigation through the existing link/button semantics

The embedded Desk should keep its existing accessible labels, toolbar controls, and modal behavior. The integration should not add a second app-level sidebar inside the Desk content.

## Testing Plan

Add or update unit tests for mode normalization:

- `default` stays `default`
- `studio2` stays `studio2`
- stored `agentic` resolves to `studio2`
- stored `desks` resolves to `studio2`
- invalid values fall back to `default`
- `setStudioUiMode( "studio2" )` persists `studio2`

Add UI/router coverage for the Agentic shell:

- Sidebar includes Chat, Desk, Settings, and Skills
- Clicking Desk navigates to `/desk`
- `/desk` renders the global Desk surface
- The sidebar remains visible while Desk is shown

Manual verification:

- Launch with `ENABLE_DESKS_UI_SWITCH=true`
- Confirm Settings shows Studio 2.0, not separate Agentic UI and Desks UI choices
- Switch to Studio 2.0
- Click Desk in the sidebar
- Confirm the full Desk toolbar and Desk chat panel remain available
- Restart the app and confirm Studio 2.0 is restored
- Force stored config values `agentic` and `desks`, then confirm both open Studio 2.0

## Out Of Scope

This branch should not:

- Merge all Desks routes into the Agentic router
- Add site-specific Desk routing from the sidebar item
- Remove the standalone Desks code paths if they are still needed as reusable internals
- Redesign Desk chrome or Agentic chrome beyond the new sidebar item and mode labels
- Change Desk widget behavior, site map behavior, or Desk chat behavior

## Open Risks

The main risk is duplicated chat surfaces: Agentic already has chat-oriented navigation, and the embedded Desk keeps its own Desk chat panel. This is intentional for this branch because the requirement is to keep the full Desks experience. If it proves noisy in practice, it should be evaluated in a follow-up branch rather than folded into this initial integration.

The second risk is route/search interaction. The Desks chat provider uses route search params for chat state. The new `/desk` route should preserve those search params through the existing packaged router history. Tests should cover navigation enough to catch obvious regressions.
