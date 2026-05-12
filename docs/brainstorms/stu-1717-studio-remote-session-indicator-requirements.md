---
date: 2026-05-12
topic: studio-remote-session-indicator
---

# Studio Remote-Session Indicator and Start/Stop Toggle

## Summary

Add a small remote-session indicator to Studio's top-bar (right cluster, next to Settings/Help) that mirrors the daemon's on-disk state and click-toggles to start or stop it. Two states (running / off), visible only to logged-in users with the new `enableRemoteSessionUi` flag on.

---

## Problem Frame

The remote-session daemon (`studio code remote-session start`) runs out-of-process and is driven from Telegram. When it's alive, the CLI REPL shows a bottom-bar indicator, but Studio — where most users actually spend their time — gives no signal that anything is happening. The only way to confirm the daemon is running is to attach to its log stream from a terminal, or to check Telegram.

Studio is also where users authenticate, manage sites, and run the agent locally. Forcing them to switch contexts to check on (or start/stop) the daemon makes the feature feel disconnected from the rest of the product — even though the daemon is global to the app, not site-scoped.

---

## Actors

- A1. **Studio user (logged in)**: opens Studio, sees whether the remote-session daemon is running, and clicks the indicator to start or stop it.
- A2. **Remote-session daemon**: the existing out-of-process Node CLI started by `studio code remote-session start`. Owns `~/.studio/remote-session.pid` while alive.
- A3. **Studio main process**: reads the PID file, spawns/terminates the daemon, and pushes status to the renderer.

---

## Key Flows

- F1. **Start the daemon from Studio**
  - **Trigger:** A1 clicks the indicator while it shows "off".
  - **Actors:** A1, A3, A2.
  - **Steps:**
    1. Renderer dispatches a start action to the main process.
    2. Main process invokes the existing CLI helper to spawn the detached daemon (same code path as `studio code remote-session start`).
    3. On success, the daemon writes its PID file; the next poll tick flips the indicator to "running".
    4. On failure (e.g. spawn timeout, missing token despite being logged in), a transient error toast surfaces in the renderer.
  - **Outcome:** Daemon is running; indicator is green; tooltip reflects the live state.
  - **Covered by:** R3, R4, R5, R7, R10.

- F2. **Stop the daemon from Studio**
  - **Trigger:** A1 clicks the indicator while it shows "running".
  - **Actors:** A1, A3, A2.
  - **Steps:**
    1. Renderer dispatches a stop action to the main process.
    2. Main process invokes the existing CLI stop helper (SIGTERM, escalate to SIGKILL).
    3. PID file is removed; next poll tick flips the indicator to "off".
  - **Outcome:** Daemon is stopped; indicator is dimmed; Telegram receives the daemon's graceful detach message.
  - **Covered by:** R3, R4, R5, R7.

- F3. **Detect an externally started/stopped daemon**
  - **Trigger:** A2's lifecycle changes outside of Studio — e.g. user runs `studio code remote-session start` in a terminal, or the daemon crashes.
  - **Actors:** A2, A3, A1 (passively).
  - **Steps:**
    1. Main process polls the PID file every ~5s (and once on app start).
    2. State changes are pushed to the renderer.
    3. Indicator updates to match the new on-disk truth.
  - **Outcome:** The indicator reflects daemon state within one poll interval, regardless of who started or stopped it.
  - **Covered by:** R6, R8.

- F4. **Logged-out user (or flag off)**
  - **Trigger:** App is opened or the user logs out.
  - **Actors:** A1, A3.
  - **Steps:**
    1. Renderer evaluates feature flag + auth state.
    2. If either is missing, the indicator is not rendered at all.
  - **Outcome:** No chrome change for users who can't (or shouldn't) use the feature. If the daemon happens to be running, Studio leaves it alone.
  - **Covered by:** R1, R2, R9.

---

## Requirements

**Gating and visibility**
- R1. The indicator and toggle are gated behind a new Studio feature flag `enableRemoteSessionUi` (env: `ENABLE_REMOTE_SESSION_UI`), defaulted off, distinct from `enableStudioCodeUi`.
- R2. The indicator is rendered only when the user is logged in to WordPress.com (so a token is resolvable via the OAuth fallback) AND the feature flag is on. Otherwise nothing is rendered — no disabled affordance, no tooltip, no chrome shift.

**Placement and presentation**
- R3. The indicator lives in the Studio top-bar's right cluster (the same cluster that hosts Settings and Help), in the titlebar above the main content. It is global — never inside a site tab.
- R4. The indicator has exactly two visual states: **running** (green) and **off** (dimmed/grey). No "busy" or "idle" distinction during steady-state.
- R5. The indicator is a single click target. Clicking flips state: Start when off, Stop when on. A tooltip shows the current state.

**Live status and lifecycle**
- R6. Studio detects daemon state by reading the same `~/.studio/remote-session.pid` file the CLI helpers manage. The detection logic must reuse the existing `getDaemonStatus()` semantics (PID liveness check, stale-file cleanup) so Studio and CLI agree on truth.
- R7. Start and Stop go through the existing daemon helpers (the same code paths invoked by `studio code remote-session start` / `stop` and by the REPL's `/remote-session attach|detach`). Studio does not implement its own spawn/terminate logic.
- R8. The indicator stays live via a light poll in the Studio main process (default ~5s, matching the CLI REPL pattern), plus an initial check on app start. The renderer is notified when state changes.

**Error handling**
- R9. If the user logs out while the daemon is running, the indicator disappears from the chrome. Studio does NOT stop the daemon as a side effect of logout.
- R10. If Start fails after gating (e.g. `DaemonStartTimeoutError`), the renderer surfaces a transient, non-blocking error notice (toast). The indicator stays in the "off" state. No persistent error UI lives next to the indicator in v1.

---

## Acceptance Examples

- AE1. **Covers R2, R9.** Given the user is logged out and the feature flag is on, when the app renders the top-bar, no remote-session indicator is shown — even if a daemon is currently running on disk.
- AE2. **Covers R2.** Given the user is logged in and the feature flag is off, when the app renders the top-bar, no remote-session indicator is shown.
- AE3. **Covers R4, R5, R6, R8.** Given the user is logged in, the flag is on, and no daemon is running, when the user clicks the indicator, the daemon starts and within one poll interval the indicator turns green and the tooltip reads as the running state.
- AE4. **Covers R6, R8.** Given Studio is open with the indicator showing "off", when the user runs `studio code remote-session start` from a terminal, the indicator turns green within one poll interval without any Studio interaction.
- AE5. **Covers R3, R4.** Given the user is on any site tab, when they look at the top chrome, the indicator is visible in the right cluster of the top-bar (not inside the site tab area) regardless of which site is selected.
- AE6. **Covers R7.** Given the daemon is running and the user clicks the indicator, when Stop completes, the Telegram chat receives the daemon's existing graceful detach message — because Studio went through the same stop helper as the CLI.
- AE7. **Covers R10.** Given the user is logged in and clicks Start, when the daemon fails to write its PID file within the timeout, a transient error toast surfaces in the renderer and the indicator stays "off".

---

## Success Criteria

- A Studio user who has the feature flag on and is logged in can see at a glance whether the remote-session daemon is running, and can flip its state with one click — without opening a terminal or Telegram.
- Studio's indicator agrees with `studio code remote-session status` and the CLI REPL's bottom-bar indicator at all times (within one poll interval).
- A downstream implementer can build this from the requirements doc without re-deciding where the indicator lives, what its visual states are, what gates its visibility, or which existing helpers to reuse.

---

## Scope Boundaries

- Per-site placement or any site-tab integration — remote session is a global concept, not per-site.
- Three-state visualization (running-busy vs running-idle vs off) and any daemon-protocol extension to expose "busy".
- Popovers, dropdowns, or status cards showing extended info (last activity, log tail, config editor).
- In-app token/config UI — logged-out users see nothing rather than a disabled control.
- Auto-start on app launch, or a persisted "keep daemon on" user preference.
- Auto-stopping the daemon when the user logs out (the indicator just disappears; the daemon is left alone).
- Multi-daemon awareness, multi-account routing, or anything beyond the single global daemon.
- Reworking the CLI REPL's bottom-bar indicator — that surface stays as-is.
- Persistent error UI adjacent to the indicator (e.g. error badges that stick around). v1 uses transient toasts only.

---

## Key Decisions

- **Two states, not three.** Matches what the PID file can tell us today; avoids adding a busy/idle signal to the daemon protocol for v1.
- **Direct toggle, not a popover.** Click flips state; tooltip carries the current label. Avoids building a popover surface before there's content that justifies one.
- **Hide on logged-out, do not disable.** Logged-out users see no chrome change at all. A disabled control would invite a "why can't I click this?" question without a graceful in-app answer (no in-app login affordance in this surface).
- **Poll, not fs.watch.** Mirrors the CLI REPL's existing 5s poll; cheap, predictable, and trivially correct under PID-file rotation/removal.
- **Reuse existing daemon helpers in Studio's main process.** `getDaemonStatus`, `startDaemon`, and `stopDaemon` are Node modules — Studio main is Node — so importing is cleaner than shelling out to the CLI binary. Keeps one source of truth for daemon lifecycle.
- **New `enableRemoteSessionUi` flag, separate from `enableStudioCodeUi`.** Allows shipping/flipping the indicator independently of the broader Studio Code UI rollout.
- **Tooltip wording mirrors the CLI REPL.** Consistent surface for users who use both ("Remote session active" / "Remote session off"); final strings are a planning detail.

---

## Dependencies / Assumptions

- The CLI helpers in `apps/cli/remote-session/daemon.ts` are stable and importable from Studio's main process (verified: they're plain Node modules, no CLI-only globals).
- `~/.studio/remote-session.pid` is the single source of truth for daemon liveness, and the existing `getDaemonStatus()` correctly cleans up stale entries.
- A logged-in WordPress.com user has a usable `accessToken` in `~/.studio/shared.json` that the daemon can pick up via the existing OAuth fallback. Started daemons from Studio will not need any extra config the CLI doesn't already require.
- Studio's existing `feature-flags.ts` machinery is the right place to add the new flag (precedent: `enableStudioCodeUi`).

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] Exactly how should the Studio main process import the CLI's daemon helpers — direct module import from `apps/cli/remote-session/daemon.ts`, a shared module promoted to `tools/common/`, or a thin IPC wrapper? Resolve during planning based on existing module boundaries.
- [Affects R8][Technical] Where the 5s poll lives (main process timer vs renderer-driven request) and how the renderer is notified (IPC event push vs renderer-side polling of an IPC handler). Resolve during planning based on Studio's existing IPC conventions.
- [Affects R10][Needs research] What's the exact UX surface Studio currently uses for transient main-process error toasts? Confirm the existing pattern before implementation.
- [Affects R5][Technical] Exact tooltip strings, icon choice, and i18n keys. Planning concern; surface strings will be added via `@wordpress/i18n` per existing conventions.
