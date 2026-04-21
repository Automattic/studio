# Sync Activity Region — Design

Date: 2026-04-21
Branch: `sync-tab-redesign`
Scope: `apps/studio/src/modules/sync/**`, `apps/studio/src/components/app.tsx`

## Context

The Sync tab currently surfaces its lifecycle through three visually-detached UI elements:

1. **`SyncDialog` modal** — opened when the user clicks push/pull. Hosts the file/folder tree selection, warnings, and size meter.
2. **`SyncStatusDock`** (floating, just built) — fixed to the bottom of the viewport, shows progress rows for active syncs.
3. **Errors** — today handled inline in the legacy `SyncConnectedSites` flow; in the new TriangleLayout they would show through the dock.

These three surfaces use three different visual languages (modal, floating dock, inline banner). None matches the rest of Studio's chrome. The user sees the dock across tabs and sites, which works but wasn't the design intent — it created a fourth surface on top of the existing per-site indicators that already exist (sidebar spinner on the site row, "Pulling"/"Pushing" in the site header).

## Goals

Unify setup, progress, and outcome into a single **activity region** inside the Sync tab body, sitting below the triangle. Use the same tokens as the rest of Studio — no new visual language, no new shells. Remove the floating dock and the modal.

## Non-Goals

- No new cross-tab or cross-site indicators. The existing sidebar spinner and site-header "Pulling"/"Pushing" labels already handle that; we don't duplicate.
- Not changing the Redux sync state model. The activity region is a new view on top of existing `pullStates`/`pushStates`.
- Not changing the sync thunks, selectors, or IPC handlers.
- Not rewriting the selection-tree internals of `SyncDialog`. Its inner JSX becomes a shared inline-or-modal component; the legacy modal shell can be deleted once the new region is in use everywhere.
- No retry-with-new-options; retry uses the same options that triggered the original failed sync.

## Decisions

1. **Activity region lives at the bottom of the Sync tab body**, below the triangle. Same box styling as the rest of the app (`bg-frame-surface`, `border-frame-border`, `rounded-lg`). Not floating, not modal.
2. **Sticky on overflow**: when total tab content exceeds the viewport, the activity region gets `position: sticky; bottom: 0` so its rows stay visible while the triangle scrolls behind.
3. **Region is site-scoped**: the Sync tab is already per-site; the region only shows that site's activity. Syncs running on other sites still render their progress when the user switches to those sites.
4. **One setup panel at a time**: clicking a different push/pull arrow while a setup is open replaces the panel. No confirm prompt.
5. **Many active-sync rows allowed**: parallel syncs shown as a vertical stack. No artificial limit.
6. **Errors stay until dismissed**; successes auto-dismiss after ~3s.
7. **Progress bars** use the project's existing `ProgressBar` / `ProgressBarWithAutoIncrement` from `apps/studio/src/components/progress-bar.tsx`. No new progress-bar component.
8. **Retry** reuses the last options set for that stateId. No re-opening the setup form.
9. **Delete `SyncStatusDock`** and its mount in `app.tsx`. Delete the `SyncDialog` modal wrapper after migrating its internals (or earlier — the wrapper only adds the Modal chrome; the content moves inline).

## Region contents, top to bottom

```
┌───────────────────────────────────────────┐
│ Activity region                           │
├───────────────────────────────────────────┤
│ Setup panel (if any — one at a time)      │
│ Active sync row                           │
│ Active sync row                           │
│ Failed sync row                           │
│ …                                         │
└───────────────────────────────────────────┘
```

Setup panel is always on top when present. Active/failed rows sort by start time (newest first). The region is not shown at all when empty.

### Setup panel

Triggered when the user clicks a push or pull arrow. Replaces any other open setup panel.

Contents — reuses the existing `SyncDialog` body JSX (environment breadcrumb, selective-sync tree, warnings, size meter, Cancel / Submit). No change to the selection internals. Header row: "Push to Production" / "Pull from Staging" / etc., with a close `×`.

Max height: `max-h-[60vh]` with `overflow-y-auto` on the tree so the footer is always reachable.

On submit: panel animates out, replaced in-place by a new active-sync row for the same stateId.

### Active sync row

One row per running sync. Compact:

```
┌────────────────────────────────────────────────────────────────┐
│ ↓ Push to Production   Uploading to WordPress.com (42%)  [Cancel]│
│ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░                          │
└────────────────────────────────────────────────────────────────┘
```

- Direction glyph (↓ push / ↑ pull / → copy prod→staging / ← copy staging→prod).
- Destination label.
- `status.message` from the slice. For push `uploading`, interpolate the upload percent via `useSyncStatesProgressInfo().getPushUploadMessage`.
- Cancel button, gated by `canCancelPush` / `canCancelPull` from `src/lib/active-sync-operations`.

Progress bar: `ProgressBar` for discrete states (those with real `status.progress` ticks). `ProgressBarWithAutoIncrement` for quiet phases (`in-progress` pull, `creatingRemoteBackup` push, `applyingChanges` push) — these have long quiet middles where wpcom reports no sub-progress; the auto-incrementer keeps the bar alive up to 95% of the step's ceiling.

On success: row persists for ~3s showing "Push complete" / "Pull complete" at 100%, then the `clearPushState` / `clearPullState` action fires and the row is removed. Users already get a system notification separately (`showNotification` in the cancel/finish thunks).

### Failed sync row

Same general footprint as active, but styled as an error:

- `border-l-4 border-frame-error` on the row.
- The thunk's rejection message (title + body — currently surfaced via toast; we render it inline instead).
- `[Retry]` button: dispatches the same push/pull with the options recorded at start time.
- `[Dismiss]` button: fires `clearPushState` / `clearPullState`.

Retry options storage: current `useSyncActions` doesn't persist the options between submit and rejection. Add a small wire-up — when the dialog submits, store the options in the sync-operations slice alongside the state (`lastOptions: SyncOption[]`). Retry rereads them.

## Cross-tab / cross-site visibility

Existing indicators handle this. No new indicators:

- `apps/studio/src/components/site-menu.tsx` and `site-management-actions.tsx` already change the site-header start/stop button to "Pulling"/"Pushing" during sync, and the sidebar site row shows a spinner.
- The activity region only renders on the Sync tab. From other tabs, the user relies on the existing indicators and clicks back to Sync to see details.

## File layout

**New:**

- `apps/studio/src/modules/sync/components/activity-region/activity-region.tsx` — the exported root component. Renders the setup panel + active/failed rows. Subscribes to Redux.
- `apps/studio/src/modules/sync/components/activity-region/setup-panel.tsx` — the inline setup form. Extracted from `SyncDialog`'s body.
- `apps/studio/src/modules/sync/components/activity-region/active-row.tsx` — progress row.
- `apps/studio/src/modules/sync/components/activity-region/failed-row.tsx` — error row.

**Modified:**

- `apps/studio/src/modules/sync/components/sync-dialog.tsx` — extract the body content into `setup-panel.tsx`. The existing modal wrapper becomes a thin adapter (or gets removed once all consumers migrate — out of scope for this spec).
- `apps/studio/src/modules/sync/components/triangle/triangle-layout.tsx` — render the `<ActivityRegion>` at the bottom of the diagram branch. Remove the `<SyncDialog>` mount (the activity region owns setup now); wire arrow-button clicks to set the active setup state.
- `apps/studio/src/components/app.tsx` — remove the `<SyncStatusDock />` mount.
- `apps/studio/src/stores/sync/sync-operations-slice.ts` — add `lastOptions?: SyncOption[]` to `SyncBackupState` and `SyncPushState`. Persist when the thunk starts, read when retrying.
- `apps/studio/src/modules/sync/hooks/use-sync-actions.ts` — add a `retry` function that dispatches push/pull thunks with the stored `lastOptions`.

**Deleted:**

- `apps/studio/src/modules/sync/components/sync-status-dock/sync-status-dock.tsx` — no longer used. The activity region replaces it.

## State model changes

Add optional `lastOptions: SyncOption[]` to both `SyncBackupState` and `SyncPushState` so the failed-row Retry button can re-run with the same selection. Store on initial thunk dispatch; read on retry.

No other slice changes.

## Testing

Existing tests stay green — these are UI changes around the same Redux state.

New tests:

- `activity-region.test.tsx` — renders nothing when there are no states; renders setup panel when opened; renders active and failed rows by state.
- `active-row.test.tsx` — cancel button disabled when `canCancelPush/Pull` returns false; message interpolates upload percentage for `uploading` state.
- `failed-row.test.tsx` — retry dispatches the push/pull thunk with `lastOptions`; dismiss clears the state.

Not tested: ProgressBar pixel behavior (rely on `@wordpress/components`).

## Open questions

- Should the Retry button also reappear on a cancelled sync, or only on failure? Lean: only failure. Cancel is deliberate; retrying a cancel is equivalent to starting fresh from the setup panel.
- For the `creatingRemoteBackup` push phase, should `ProgressBarWithAutoIncrement` cap at `applyingChanges.progress` (60) or stay at the phase's own ceiling (50)? Lean: stay at own ceiling, so the jump to 60 happens when the phase key actually changes.

## References

- Existing progress info: `apps/studio/src/stores/sync/sync-operations-slice.ts:80-123` — do NOT alter these. The new copy we shipped last week is the canonical source.
- Existing cancel gates: `apps/studio/src/lib/active-sync-operations.ts` — `canCancelPush`, `canCancelPull`.
- Existing retry pattern: none today. New.
- Existing progress bars: `apps/studio/src/components/progress-bar.tsx` — reuse, don't re-create.
