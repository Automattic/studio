# Resizable Sidebar

## Summary

Make the sidebar continuously draggable so users can adjust its width. Width persists between sessions. Dragging below a snap threshold collapses the sidebar. No external dependencies — custom drag handler only.

## Constraints

- **Min width**: 150px (site names still visible)
- **Max width**: 400px
- **Snap-to-close threshold**: ~100px (below this, sidebar collapses fully)
- **Default width**: 208px (current `SIDEBAR_WIDTH` constant, used as fallback)
- Internal layout rebalances only — no Electron window resizing on drag

## Resize Handle

A 4-6px invisible hit area at the sidebar's right edge, between `MainSidebar` and `<main>` in `app.tsx`. No visible divider — only a `col-resize` cursor on hover/drag signals interactivity.

## Drag Behavior

A `useSidebarResize` custom hook manages the interaction:

- `mousedown` on the handle starts tracking
- `mousemove` on `document` updates sidebar width in real-time via `requestAnimationFrame`
- `mouseup` on `document` ends tracking and persists the final width
- During drag, a transparent overlay covers the content area to prevent iframes from stealing pointer events
- Width is clamped between 150px and 400px
- If dragged below the snap threshold (~100px), the sidebar collapses fully (same as current toggle)
- Reopening a snapped-closed sidebar restores the last dragged width, not the default 208px

## Persistence

Width is stored via the existing `user-settings` module. On launch, the app reads the saved width (falling back to 208px). On drag end, the new width is written. Sidebar visibility state (open/collapsed) continues to work independently — persisted width is only applied when the sidebar is visible.

## Integration with Existing Toggle

- Toggle button remains unchanged
- Toggling open uses the persisted width instead of hardcoded 208px
- Toggling closed snaps to the collapsed state
- `SIDEBAR_WIDTH` becomes the default/fallback rather than the fixed width
- Auto-collapse breakpoint logic in `use-sidebar-visibility` uses the persisted width for its calculation

## Files Affected

- `apps/studio/src/components/app.tsx` — add resize handle element, apply dynamic width
- `apps/studio/src/hooks/use-sidebar-resize.ts` — new hook for drag logic
- `apps/studio/src/hooks/use-sidebar-visibility.ts` — use persisted width instead of constant
- `apps/studio/src/modules/user-settings/` — add sidebar width to persisted settings
- `apps/studio/src/constants.ts` — add min/max/snap-threshold constants
