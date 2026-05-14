# Dolly Assistant Follow-ups

## Completed

- Site-scoped sessions: switching WordPress.com sites remounts/isolates the assistant so a prior site's messages or `sessionId` are not reused.
- Backend site selection sync: after a Dolly turn, Studio detects the backend-selected site from the response or session history, updates the active UI site when Dolly switched it, and avoids clobbering explicit user selections made while a turn is in flight.
- Preview refresh guard: Dolly preview tool calls are idempotent for the currently open URL and only force a same-URL reload when Dolly marks `siteChanged`.
- Preview default state: WordPress.com live-site chats start with the preview hidden and only open when the user or Dolly requests a preview.
- Live-site chat state: each WordPress.com site keeps its own persisted local Dolly conversation id, messages, draft input, session id, backend-selected active site, and preview state while switching between live-site tabs.
- Server hydration: WordPress.com live-site chats load the latest matching Dolly server conversation on mount, preserve its `remoteChatId`/`sessionId`, and continue future sends in that hydrated session.

## Remaining Prioritized Plan

### 1. Live-Site Safety Signals

Make it obvious when Dolly is acting on a live WordPress.com site rather than a disposable local preview.

Required behavior:

- Add a clear visual affordance or warning state for live-site editing.
- Show whether the selected WordPress.com site is staging or production in the heading area.
- Prefer using fields from the existing sites endpoint response if they already include staging/production metadata.

Do this before deeper chrome polish because it affects the heading hierarchy and the user's risk model.

### 2. Sidebar IA And Context Menus

Round out the WordPress.com section in the left sidebar so it behaves like a first-class site directory, not just a temporary list.

Required behavior:

- Add right-click options on the top-level WordPress.com sidebar group for filtering and list controls.
- Add right-click options on individual WordPress.com sidebar sites, including an action to sync/pull the site locally.
- Add subtle visual affordances that distinguish local Studio sites from live WordPress.com sites without making the sidebar noisy.

Do this after live-site safety language is settled so the sidebar status treatment matches the main content area.

### 3. Preview Layout Stability

Fix the preview layout before refining the chrome.

Required behavior:

- Tune the default preview viewport. It currently renders too zoomed-in or mobile-like; it should start slightly zoomed out.
- Let the preview claim more horizontal space by default.
- Fix small-window resizing behavior. The chat and preview split gets buggy when the app window narrows, so the preview needs better min/max width constraints and responsive collapse behavior.

Do this before auto-refresh because preview reload behavior should be built on stable layout constraints.

### 4. Preview Chrome Polish

Improve the preview panel chrome. The current v1 proves the layout, but the header, controls, resize affordance, loading state, and visual hierarchy need a dedicated pass.

Do this after the layout constraints are stable so the polish work is not reworked.

### 5. Preview Auto-Refresh

Add an auto-refresh path for the preview when Dolly or another live-site action changes the selected WordPress.com site.

The refresh trigger should be tied to an explicit site-change signal, not to every completed Dolly response or same-URL preview tool call.

Do this after site/session correctness and preview stability, since refresh triggers need to target the right site and a stable preview surface.

### 6. Shared Chat UI Evaluation

Evaluate replacing the custom chat surface with `@automattic/agenttic-ui` so Studio aligns with the shared agent UI patterns.

Do this last unless it becomes a blocker. It may absorb or replace some custom chat controls, so the site/session model should be settled first.
