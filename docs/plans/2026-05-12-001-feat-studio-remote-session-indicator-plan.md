---
date: 2026-05-12
status: active
type: feat
topic: studio-remote-session-indicator
origin: docs/brainstorms/stu-1717-studio-remote-session-indicator-requirements.md
linear: https://linear.app/a8c/issue/STU-1717
---

# feat: Studio Remote-Session Indicator and Start/Stop Toggle

## Summary

Add a top-bar indicator + click-toggle that reflects the remote-session daemon's state and lets a logged-in user start or stop it. Studio main polls the existing CLI PID file every ~5s, pushes state transitions to the renderer via an IPC event, and reuses the CLI's `getDaemonStatus` / `startDaemon` / `stopDaemon` helpers — with explicit `execPath` + `cliEntry` overrides so the spawn targets the Node CLI, not the Electron binary. Whole surface is gated behind a new `enableRemoteSessionUi` feature flag.

---

## Problem Frame

The remote-session daemon runs as a detached background process, driven from Telegram. When alive it's only visible in two places: the CLI REPL's bottom-bar indicator (when one is running) and the Telegram chat itself. Studio — where most users live — gives no signal that anything is happening. Users have to attach a terminal to the daemon's log stream, run `studio code remote-session status`, or check Telegram to know whether the agent is reachable.

The daemon is global (not site-scoped), so an indicator belongs in the top-level chrome, not inside a site tab. The on-disk truth (`~/.studio/remote-session.pid`) and the lifecycle helpers (`apps/cli/remote-session/daemon.ts`) already exist; what's missing is a Studio surface that mirrors them.

---

## Requirements Traceability

Carried forward from `docs/brainstorms/stu-1717-studio-remote-session-indicator-requirements.md`:

| Origin ID | Carried into |
|---|---|
| R1 (new flag) | U1 |
| R2 (gated visibility) | U1, U5 |
| R3 (right cluster placement) | U5 |
| R4 (two visual states) | U5 |
| R5 (single click target + tooltip) | U5 |
| R6 (reuse `getDaemonStatus` semantics) | U2, U3 |
| R7 (reuse `startDaemon`/`stopDaemon`) | U2 |
| R8 (~5s main-process poll + initial check) | U3 |
| R9 (logout does NOT stop daemon) | U3, U5 |
| R10 (transient error notice on start failure) | U2, U5 |
| AE1, AE2 (visibility gates) | U5 test scenarios |
| AE3 (toggle on → green within one poll) | U3, U5 test scenarios |
| AE4 (externally-started daemon → green) | U3 test scenarios |
| AE5 (visible regardless of site selection) | U5 test scenarios |
| AE6 (Stop goes through helper → Telegram detach) | U2 test scenarios |
| AE7 (start failure → error dialog, indicator stays off) | U2, U5 test scenarios |

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                                    Electron Main                                 Renderer
                                    ────────────                                 ──────────
                                                                                 
  ~/.studio/                ┌────────────────────────┐                          ┌──────────────────────┐
  remote-session.pid <───── │ daemon-status-poller   │                          │ TopBar               │
       (truth)              │  - setInterval 5s      │                          │  RemoteSessionInd.   │
                            │  - unref()             │                          │   (gated on flag +   │
                            │  - initial sync tick   │                          │    isAuthenticated)  │
                            │  - state-transition    │                          │                      │
                            │    push only           │                          │                      │
                            └──────┬─────────────────┘                          └──────────┬───────────┘
                                   │  sendIpcEventToRenderer                              │
                                   │   ('remote-session-status', { running, pid })        │
                                   └─────────────────────────────────────────►  useIpcListener
                                                                                          │
                            ┌────────────────────────┐                          ┌─────────▼────────────┐
                            │ ipc-handlers.ts        │                          │ useRemoteSessionStatus│
                            │  getRemoteSessionDaemo │◄─── window.ipcApi ────── │  - subscribes        │
                            │    nStatus             │                          │  - calls get* on mnt │
                            │  startRemoteSessionDae │                          │  - exposes start/stop │
                            │    mon (passes explicit│                          └─────────┬────────────┘
                            │    execPath+cliEntry)  │                                    │
                            │  stopRemoteSessionDaem │                          ┌─────────▼────────────┐
                            │    on                  │                          │ click handler        │
                            └──────┬─────────────────┘                          │  → catch error       │
                                   │                                            │  → showErrorMessageBox│
                            ┌──────▼─────────────────┐                          └──────────────────────┘
                            │ cli/remote-session/    │
                            │   daemon.ts            │
                            │  (imported via new     │
                            │   `cli` main alias)    │
                            │  getDaemonStatus       │
                            │  startDaemon           │
                            │  stopDaemon            │
                            └────────────────────────┘
```

Key wires:
- **Status truth** — `getDaemonStatus()` reading the PID file. One source for CLI REPL, `studio code remote-session status`, and Studio. The Studio main poller is the only new reader.
- **Spawn safety** — `startDaemon` is called from Electron main, so `process.execPath` would be the Electron binary. We pass `execPath: getBundledNodeBinaryPath()` and `cliEntry: getCliPath()` (already used by `studio-code-process.ts` for identical reasons).
- **Transition-only push** — the poller diffs the last-pushed state and emits an IPC event only when `running` flips. Avoids re-rendering the indicator every 5s for no reason.

---

## Implementation Units

### U1. Add `enableRemoteSessionUi` feature flag

**Goal:** Register the new Studio feature flag end-to-end so main and renderer can both read it.

**Requirements:** R1, R2 (gating mechanism).

**Dependencies:** none.

**Files:**
- `apps/studio/src/lib/feature-flags.ts` (add entry to `FEATURE_FLAGS`)
- `apps/studio/src/ipc-types.d.ts` (add property to `FeatureFlags` interface)
- `apps/studio/src/hooks/tests/use-feature-flags.test.tsx` (extend if a flag-list assertion exists; otherwise no new test file)

**Approach:**
- Add a `FEATURE_FLAGS.enableRemoteSessionUi` entry mirroring `enableStudioCodeUi`: `env: 'ENABLE_REMOTE_SESSION_UI'`, `flag: 'enableRemoteSessionUi'`, `default: false`, label "Enable Remote-Session UI".
- Add the matching property to the global `FeatureFlags` interface in `apps/studio/src/ipc-types.d.ts`.
- The existing `buildFeatureFlags()` and `getAppGlobals` plumbing will surface it through `window.appGlobals` automatically; no further wiring needed.

**Patterns to follow:** `enableStudioCodeUi` and `enableBlueprints` entries in `apps/studio/src/lib/feature-flags.ts`.

**Test scenarios:**
- `buildFeatureFlags()` returns `enableRemoteSessionUi: false` when `ENABLE_REMOTE_SESSION_UI` is unset.
- `buildFeatureFlags()` returns `enableRemoteSessionUi: true` when the env var is exactly `'true'`.
- `buildFeatureFlags()` returns `enableRemoteSessionUi: false` for any other env-var value (`'1'`, `'TRUE'`, `'yes'`) — matches the strict-canonical rule already enforced for sibling flags.

**Verification:** TypeScript compiles; the new flag appears in `window.appGlobals` after restart with the env var set; the existing flag-related tests still pass.

---

### U2. Bridge Studio main to the CLI daemon helpers

**Goal:** Make the CLI daemon helpers callable from Studio main, and expose them to the renderer through three new IPC handlers.

**Requirements:** R6, R7, R10.
**Covers AE6, AE7** (start/stop go through the existing helpers).

**Dependencies:** U1.

**Files:**
- `apps/studio/electron.vite.config.ts` (add `cli` alias to `main.resolve.alias`)
- `apps/studio/src/ipc-handlers.ts` (add `getRemoteSessionDaemonStatus`, `startRemoteSessionDaemon`, `stopRemoteSessionDaemon`)
- `apps/studio/src/preload.ts` (add three `ipcRendererInvoke` bridge lines)
- `apps/studio/src/tests/ipc-handlers/remote-session.test.ts` (new — co-located with sibling IPC handler tests if that pattern exists, otherwise nested under `apps/studio/src/tests/`)

**Approach:**
- Mirror the renderer-side `cli` alias (`apps/studio/electron.vite.config.ts:73`) in the `main.resolve.alias` block so `import { getDaemonStatus, startDaemon, stopDaemon } from 'cli/remote-session/daemon'` resolves at build time. Confirm that `externalizeDepsPlugin` does not externalize `cli/...` — the existing exclusion of `@studio/common` is the precedent. If it would externalize, add the appropriate `exclude` entry.
- `getRemoteSessionDaemonStatus`: calls `getDaemonStatus()` and returns the `DaemonStatus` object. No options needed — defaults to `getRemoteSessionPidPath()` from `@studio/common/lib/well-known-paths`.
- `startRemoteSessionDaemon`: calls `startDaemon({ execPath: getBundledNodeBinaryPath(), cliEntry: getCliPath() })` — pulling these from `apps/studio/src/storage/paths.ts` exactly as `studio-code-process.ts` does. Rethrows `DaemonAlreadyRunningError` and `DaemonStartTimeoutError` so the renderer can present the right copy.
- `stopRemoteSessionDaemon`: calls `stopDaemon()` and returns the result. The CLI helper already handles `SIGTERM` → `SIGKILL` escalation and PID-file cleanup.
- Add the matching three lines to `preload.ts` (the typing for `window.ipcApi` is derived from `typeof import('./ipc-handlers')` so no extra type changes are needed beyond `preload.ts`).

**Patterns to follow:**
- `studio-code-process.ts:57-58` for `getBundledNodeBinaryPath()` / `getCliPath()` retrieval.
- Other async handlers in `ipc-handlers.ts` for the `export async function handlerName(event, ...): Promise<…>` shape.
- `preload.ts:23-234` for the `ipcRendererInvoke` bridge line shape.

**Test scenarios:**
- `getRemoteSessionDaemonStatus` returns `{ running: false }` when no PID file exists. (Mock `fs` or use a tmp dir.)
- `getRemoteSessionDaemonStatus` returns `{ running: true, pid }` when the PID file points to a live process.
- `startRemoteSessionDaemon` invokes the underlying `startDaemon` with `execPath` set to `getBundledNodeBinaryPath()` and `cliEntry` set to `getCliPath()`. **This is the key regression guard for the "Electron spawns itself" bug.**
- `startRemoteSessionDaemon` rethrows `DaemonAlreadyRunningError` unchanged when one is in flight.
- `startRemoteSessionDaemon` rethrows `DaemonStartTimeoutError` when the spawn never writes its PID file (covers AE7's "indicator stays off" path).
- `stopRemoteSessionDaemon` invokes `stopDaemon` and returns the result; no special handling beyond pass-through (covers AE6).

**Verification:** `npm run typecheck` passes; the new handlers appear on `window.ipcApi`; manual smoke from a DevTools console can fetch status, start, and stop the daemon.

---

### U3. Main-process status poller + IPC push channel

**Goal:** Keep Studio's view of the daemon live by polling the PID file every ~5s and pushing state transitions to the renderer.

**Requirements:** R6, R8, R9 (poller does not stop the daemon on app quit or logout).
**Covers AE3, AE4** (live update from internal toggle and from external start).

**Dependencies:** U2.

**Files:**
- `apps/studio/src/modules/remote-session/daemon-status-poller.ts` (new)
- `apps/studio/src/modules/remote-session/tests/daemon-status-poller.test.ts` (new)
- `apps/studio/src/ipc-utils.ts` (add `'remote-session-status'` entry to `IpcEvents`)
- `apps/studio/src/index.ts` (start the poller after `app.on('ready')`; stop on `app.on('will-quit')`)

**Approach:**
- New module `daemon-status-poller.ts` exports a `startRemoteSessionStatusPolling()` function shaped like `apps/cli/ai/daemon-status-poll.ts`:
  - Early-return a no-op if `getFeatureFlagFromEnv('enableRemoteSessionUi')` is false.
  - Capture the last pushed `running` state. Each tick reads `getDaemonStatus()`; if `running` flipped, call `sendIpcEventToRenderer('remote-session-status', status)`.
  - First tick is synchronous (no 5s wait for initial paint).
  - Wrap each tick body in try/catch — a transient read error must not crash the loop.
  - `setInterval` interval defaults to 5000ms; call `timer.unref()` so it doesn't block app quit.
  - Return a stop function that calls `clearInterval`.
- Add `'remote-session-status': [ DaemonStatus ]` to the `IpcEvents` interface in `apps/studio/src/ipc-utils.ts`.
- Wire-up in `index.ts`: after `app.on('ready')` registers the main window, call `startRemoteSessionStatusPolling()` and stash the stop function. In `app.on('will-quit', …)` (the existing block), call the stop function. Critically, **do not** stop the daemon itself — only the timer (R9).

**Patterns to follow:**
- `apps/cli/ai/daemon-status-poll.ts` for the poll-loop shape (initial sync tick, per-tick try/catch, `timer.unref()`).
- `apps/studio/src/modules/studio-code/studio-code-process.ts:30,123,134` for the `app.on('will-quit', …)` cleanup-hook precedent.
- `apps/studio/src/ipc-utils.ts:68-86` for `sendIpcEventToRenderer` usage.

**Test scenarios:**
- Polling is a no-op when `enableRemoteSessionUi` is false — `setInterval` is never registered, no IPC event is sent.
- The first tick fires synchronously on start (no 5s delay before the renderer sees initial state).
- A state transition from off → running triggers a single `sendIpcEventToRenderer('remote-session-status', { running: true, pid })` call.
- A state transition from running → off triggers the symmetric event with `{ running: false }`.
- Two consecutive ticks with identical state do NOT emit duplicate events (transition-only push). Covers the renderer-churn concern.
- A throwing `getDaemonStatus()` inside a tick is caught; the timer keeps running; no IPC event is sent for that tick.
- The stop function (a) clears the interval, (b) does NOT invoke `stopDaemon`. Covers R9.
- **Covers AE4.** Given the poller is running and the PID file is created by an external process between ticks, when the next tick reads the file, an `{ running: true, pid }` event is pushed.

**Verification:** Unit tests pass with mocked `getDaemonStatus` and `sendIpcEventToRenderer`; manual test (start daemon via terminal, confirm Studio indicator turns green within ~5s).

---

### U4. Renderer hook `useRemoteSessionStatus`

**Goal:** Give the renderer a clean handle for daemon status + start/stop actions, decoupling components from the IPC surface.

**Requirements:** R5, R6, R8, R10 (renderer-side error surfacing).

**Dependencies:** U2, U3.

**Files:**
- `apps/studio/src/hooks/use-remote-session-status.tsx` (new)
- `apps/studio/src/hooks/tests/use-remote-session-status.test.tsx` (new)

**Approach:**
- Expose `useRemoteSessionStatus(): { status: DaemonStatus | undefined, start: () => Promise<void>, stop: () => Promise<void>, isLoading: boolean }`.
- On mount, call `getIpcApi().getRemoteSessionDaemonStatus()` to fetch the initial state (covers the "what was the state at app start" case before the poller's first push lands — the poller's initial-tick push also covers this, but a one-shot fetch avoids a race for late-mounting components).
- Subscribe to `remote-session-status` via `useIpcListener` and update local state on each event.
- `start()` calls `getIpcApi().startRemoteSessionDaemon()`. On error, call `getIpcApi().showErrorMessageBox({ title: __('Failed to start remote session'), message: error.message })`. Indicator state is unchanged — the next poll tick will reconcile.
- `stop()` calls `getIpcApi().stopRemoteSessionDaemon()`. Same error treatment.
- `isLoading` reflects an in-flight start or stop call (prevents double-clicks).

**Patterns to follow:**
- `apps/studio/src/hooks/use-feature-flags.tsx:37` for the `useIpcListener` + initial-fetch pattern.
- `apps/studio/src/stores/snapshot-slice.ts:387` for the `showErrorMessageBox` pattern.

**Test scenarios:**
- Hook returns `status: undefined` on first render, then `status: { running: false }` after the mounted `getRemoteSessionDaemonStatus` resolves.
- An incoming `remote-session-status` event updates `status` to the event payload.
- `start()` invokes `getIpcApi().startRemoteSessionDaemon` exactly once; `isLoading` flips true during the call and false after.
- `start()` failure calls `getIpcApi().showErrorMessageBox` with the error message and does **not** flip `status` — covers AE7.
- `stop()` invokes `getIpcApi().stopRemoteSessionDaemon` exactly once; identical error path to `start`.
- Multiple successive clicks during an in-flight call do not trigger additional IPC calls (debounce via `isLoading`).

**Verification:** Hook tests pass; storybook or DevTools-driven manual test confirms the renderer reflects state pushed from the poller.

---

### U5. Top-bar indicator component + integration

**Goal:** Render the indicator + click-toggle in the top-bar's right cluster, gated on feature flag AND login state.

**Requirements:** R2, R3, R4, R5, R9.
**Covers AE1, AE2, AE3, AE5, AE7.**

**Dependencies:** U1, U4.

**Files:**
- `apps/studio/src/components/remote-session-indicator.tsx` (new)
- `apps/studio/src/components/tests/remote-session-indicator.test.tsx` (new)
- `apps/studio/src/components/top-bar.tsx` (insert `<RemoteSessionIndicator />` in the right cluster)
- `apps/studio/src/components/tests/topbar.test.tsx` (extend to cover the indicator's presence/absence by flag + auth state)

**Approach:**
- The component reads `enableRemoteSessionUi` from `useFeatureFlags()` and `isAuthenticated` from `useAuth()`. If either is false, returns `null` — no chrome change, no disabled state, no tooltip. Covers R2 and AE1/AE2.
- When visible, renders a `<Tooltip><Button variant="icon">…</Button></Tooltip>` mirroring `SettingsButton`. The tooltip text is the current state ("Remote session active" when running, "Remote session off" otherwise).
- Icon: `@wordpress/icons`' `published` (same pattern as `apps/studio/src/modules/preview-site/components/preview-site-row.tsx:90`), with `fill-a8c-green-50` for running and `text-white opacity-50` (or analogous "off" treatment) when off. If the visual feels wrong during implementation, swap to a different icon — the per-unit decision is to use a flat icon plus a fill class, not to invent a new dot-component.
- `onClick`: calls `start()` when off, `stop()` when running. `isLoading` from the hook disables the button to prevent double-clicks.
- Placement: inserted inside the existing right-cluster `app-no-drag-region` div in `top-bar.tsx`, **before** the `Authentication` block (so order is: Indicator, Auth, Settings, Help). The cluster already handles drag-region, RTL, and window-control spacing — no new wrapper needed.
- Strings: add new `__()` keys to the existing translation flow. The exact wording is "Remote session active" / "Remote session off" / "Failed to start remote session"; refine if a translator-facing review prefers different copy.

**Patterns to follow:**
- `OfflineIndicator` and `SettingsButton` in `apps/studio/src/components/top-bar.tsx` for the icon-button + tooltip + aria-label shape.
- `apps/studio/src/components/tests/topbar.test.tsx` for the test-rendering pattern (mock `useAuth`, `useOffline`, `getIpcApi`).

**Test scenarios:**
- **Covers AE2.** Given `enableRemoteSessionUi: false`, the component renders `null`.
- **Covers AE1.** Given the flag is true but `isAuthenticated: false`, the component renders `null` (even when the hook reports `running: true`).
- Given flag is true, auth is true, and status is `{ running: false }`, the component renders a button with the "off" tooltip and the dimmed icon.
- Given flag is true, auth is true, and status is `{ running: true }`, the component renders the button with the "active" tooltip and the green-fill icon.
- **Covers AE3.** Clicking the button when off invokes the hook's `start()` exactly once.
- Clicking the button when running invokes the hook's `stop()` exactly once.
- **Covers AE7.** When `start()` rejects, the indicator stays in the "off" visual state and no exception escapes the click handler.
- The button is disabled while `isLoading` is true; clicks during that window do not invoke `start`/`stop`.
- **Covers AE5.** The existing `topbar.test.tsx` integration check confirms the indicator is rendered in the right cluster regardless of which site (if any) is selected. Implementation may need to extend the test fixture's mocks to include `useFeatureFlags` and `useRemoteSessionStatus`.

**Verification:** Component tests pass; integration test for `top-bar.tsx` still passes (with the new mock for `useRemoteSessionStatus`); manual smoke confirms each origin acceptance example end-to-end.

---

## System-Wide Impact

- **No CLI behavior change.** The CLI helpers are imported, not modified. `studio code remote-session start/stop/status` and the CLI REPL's bottom-bar indicator behave exactly as today.
- **Feature flag default off.** Default behavior is unchanged for every user who hasn't opted in.
- **Bundle size.** Importing `cli/remote-session/daemon.ts` from main pulls in only `child_process`, `fs`, `path`, and the existing `@studio/common` paths helper. No third-party deps cross the boundary.
- **Translation strings.** Three new `__()` strings (`"Remote session active"`, `"Remote session off"`, `"Failed to start remote session"`) flow through the existing GlotPress pipeline — no special handling required.
- **No new app data, migrations, or persistence.** The PID file is owned by the CLI daemon and untouched by Studio.

---

## Key Technical Decisions

- **Add a `cli` alias to `main.resolve.alias` instead of promoting daemon helpers to `tools/common/`.** Renderer already aliases `cli` (`apps/studio/electron.vite.config.ts:73`); mirroring it in main is a one-line config change. Promoting `daemon.ts` to `tools/common/` would split ownership of a CLI-owned subsystem across two trees and require restructuring its test imports. *Rationale:* lowest cost, no new module boundary, easy to reverse if a deeper coupling concern emerges.
- **Pass explicit `execPath` and `cliEntry` to `startDaemon`.** From Electron main, `process.execPath` is the Electron binary, not Node. Without the override, "Start" would spawn Electron and the daemon would never come up. Use the same `getBundledNodeBinaryPath()` / `getCliPath()` `studio-code-process.ts` already uses. *Rationale:* highest-risk easy-to-miss bug for this feature; the override is the established Studio pattern for spawning the CLI.
- **Push only on state transitions, not every tick.** Polling reads the PID file every 5s; the IPC event fires only when `running` changes. *Rationale:* avoids renderer churn when nothing changed; renderer state-handler stays trivially correct (event ⇒ state mutation).
- **Initial-state IPC fetch in the hook on mount, in addition to the poller's initial push.** The poller pushes its first state at app-ready time; a renderer component mounted *after* that push needs its own first read. Both paths converge on the same renderer state. *Rationale:* eliminates a mount-timing race without complicating the poller.
- **Use `showErrorMessageBox` for start failures (no toast system in Studio).** The brainstorm requested a "transient toast"; Studio has no toast surface today (research confirmed). The native error dialog is the snapshot-slice precedent. *Rationale:* match existing convention rather than introducing a new notification system as a side-quest. **Deviation from brainstorm noted under Scope Boundaries.**
- **Poller gated by `enableRemoteSessionUi` in main, indicator gated by flag AND auth in renderer.** Main has no notion of auth state; the renderer hides the UI when logged out. The poller continues running even when the indicator is hidden — cheap, and keeps state ready if the user logs in mid-session. *Rationale:* avoids cross-process auth gating; matches R9 (logout does not affect daemon).
- **`will-quit` hook clears the timer, not the daemon.** Per R9, Studio quit must not influence daemon lifecycle. The hook is necessary for clean shutdown of the timer (no leaks across mac dock-relaunch). *Rationale:* explicit boundary between Studio chrome lifecycle and daemon lifecycle.

---

## Scope Boundaries

Carried from origin (`docs/brainstorms/stu-1717-studio-remote-session-indicator-requirements.md`):
- Per-site placement or any site-tab integration — remote session is global.
- Three-state visualization (running-busy vs running-idle vs off) and any daemon-protocol extension.
- Popovers, dropdowns, or status cards with extended info.
- In-app token/config UI; logged-out users see nothing.
- Auto-start on app launch, or a persisted "keep daemon on" preference.
- Auto-stopping the daemon when the user logs out or when Studio quits.
- Multi-daemon awareness, multi-account routing.
- Reworking the CLI REPL's bottom-bar indicator.
- Persistent error UI adjacent to the indicator.

Plan-time additions:
- **Promoting daemon helpers to `tools/common/`.** We use a build-config alias instead. Revisit only if a second consumer outside `apps/cli/` appears.
- **A real renderer toast/notification system.** Out of scope for STU-1717. The native error dialog covers the start-failure case; a proper toast surface is a separate, larger initiative.

### Deferred to Follow-Up Work

- Capture a `/learnings` entry after the PR lands documenting the "Electron main importing CLI Node modules — alias + `execPath` gotcha" pattern. Not required for this PR.
- If `published` icon visually reads wrong during implementation, an alternate `@wordpress/icons` choice is fine — record in PR description rather than blocking.

---

## Risks & Mitigations

- **Highest risk: spawn target is Electron, not Node.** Mitigation in U2 — explicit `execPath: getBundledNodeBinaryPath()` and `cliEntry: getCliPath()`. Test scenario in U2 asserts both are passed.
- **Bundling gotcha: `cli/...` paths fail to resolve from main.** Mitigation: add the alias to `main.resolve.alias` AND verify `externalizeDepsPlugin` does not externalize the CLI module. Manual `npm run build` smoke is the verification gate.
- **Renderer churn from every-5s pushes.** Mitigation: state-transition-only push (poller diffs the previous state). Test scenario in U3 asserts this.
- **App-quit leaks the timer.** Mitigation: register `app.on('will-quit', stopPoll)` AND `timer.unref()` belt-and-braces. Pattern lifted from `studio-code-process.ts`.
- **Auth race at app start.** `isAuthenticated` is briefly false before `useAuth`'s async token check resolves. The indicator hides during that window, then appears once auth resolves — acceptable. No mitigation required; documented as expected behavior.
- **CLI not built in dev.** Per AGENTS.md, the CLI must be built before runtime invocation. The IPC handler's call to `startDaemon` will fail if `apps/cli/dist/cli/main.mjs` doesn't exist. Behavior matches every other Studio-spawns-CLI surface today — no new mitigation needed; PR description should remind reviewers to `npm run cli:build` before testing.

---

## Deferred to Implementation

- Final tooltip strings and any localization-specific tweaks (the plan uses placeholder copy that the implementer can refine without changing structure).
- Exact path for the new IPC-handler test file — depends on whether existing tests are in `apps/studio/src/tests/ipc-handlers/` or alongside `ipc-handlers.ts`. Implementer should follow whichever pattern already exists.
- Whether the `RemoteSessionIndicator` lives at `apps/studio/src/components/remote-session-indicator.tsx` (flat, mirrors `top-bar.tsx`) or inside a `modules/remote-session/` subtree. The plan defaults to flat; implementer may move it into `modules/remote-session/` if the directory grows beyond the poller + component.
- Visual treatment of the "off" state — dimmed icon vs grey-out vs subtle background. Plan defaults to a fill-class swap on the icon.
- Exact text used in the `showErrorMessageBox` body when start fails (e.g., whether to show the underlying error code, whether to include a "Show log" affordance via `showOpenLogs`). Implementer may follow the snapshot-slice pattern.

---

## Verification Checklist

- [ ] `npm run typecheck` passes.
- [ ] `npx eslint --fix` clean on all modified files.
- [ ] `npm test` passes for the new and updated test files.
- [ ] Manual smoke (flag on, logged in): clicking the indicator starts the daemon; tooltip and color flip within one poll interval; Telegram receives the existing "attached" status (when `chat_id` is pinned).
- [ ] Manual smoke (external start): with Studio open and indicator off, running `studio code remote-session start` in a terminal flips the indicator to green within ~5s.
- [ ] Manual smoke (logout): with the daemon running and the indicator green, logging out hides the indicator but `studio code remote-session status` still reports `running`.
- [ ] Manual smoke (start failure): with the daemon already running, clicking Start surfaces the "Failed to start" dialog and the indicator stays green.
- [ ] No regression in the existing `topbar.test.tsx` suite.
