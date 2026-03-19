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

A 4-6px invisible hit area at the sidebar's right edge, between `MainSidebar` and `<main>` in `app.tsx`. No visible divider — only a `col-resize` cursor on hover/drag signals interactivity. In the collapsed state, the existing `!min-w-[10px]` area serves as the grab target so the sidebar can be dragged open again.

## Drag Behavior

A `useSidebarResize` custom hook manages the interaction:

- `mousedown` on the handle starts tracking
- `mousemove` on `document` updates sidebar width in real-time via `requestAnimationFrame`
- `mouseup` on `document` ends tracking and persists the final width
- During drag, a transparent overlay covers the content area to prevent iframes from stealing pointer events
- Width is clamped between 150px and 400px
- If dragged below the snap threshold (~100px), the sidebar collapses fully (same as current toggle)
- Reopening a snapped-closed sidebar (via toggle button or dragging from the collapsed edge) restores the last dragged width
- The `transition-all duration-500` class on the sidebar must be removed during active dragging to prevent lag, and re-applied only for toggle animations

## Persistence

Width is stored in `localStorage` (similar to `LOCAL_STORAGE_CHAT_MESSAGES_KEY` pattern) rather than appdata via IPC. Sidebar width is renderer-only UI state — no need for file locking or Main process round-trips. On launch, the app reads the saved width (falling back to 208px). On drag end (mouseup only, not every frame), the new width is written. Sidebar visibility state (open/collapsed) continues to work independently — persisted width is only applied when the sidebar is visible.

## Integration with Existing Toggle

- Toggle button remains unchanged in UI
- Toggling open uses the persisted width instead of hardcoded 208px
- Toggling closed snaps to the collapsed state
- `SIDEBAR_WIDTH` becomes the default/fallback rather than the fixed width
- The `toggleMinWindowWidth` IPC handler must use the current sidebar width (passed as an argument) instead of the hardcoded `SIDEBAR_WIDTH` constant, so window resize math is correct
- `MAIN_MIN_WIDTH` calculation becomes dynamic: `currentWindowWidth - currentSidebarWidth + 20` instead of using the constant
- Auto-collapse breakpoint logic in `use-sidebar-visibility` uses the persisted width for its calculation (note: a wider sidebar means auto-collapse triggers sooner during window resize — this is correct behavior)

## Style Change

The sidebar currently uses the Tailwind class `basis-52` for its fixed 208px width. This changes to an inline `style={{ flexBasis: width }}` to support dynamic values. The `flex-shrink-0` class remains.

## Files Affected

- `apps/studio/src/components/app.tsx` — add resize handle element, apply dynamic width via inline style, conditionally remove transition during drag
- `apps/studio/src/hooks/use-sidebar-resize.ts` — new hook for drag logic and localStorage persistence
- `apps/studio/src/hooks/use-sidebar-visibility.ts` — use persisted width instead of constant
- `apps/studio/src/ipc-handlers.ts` — update `toggleMinWindowWidth` to accept current sidebar width
- `apps/studio/src/constants.ts` — add min/max/snap-threshold constants
