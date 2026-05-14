# Dolly Assistant Follow-ups

## Prioritized Plan

### 1. Site-Scoped Sessions

Treat the selected WordPress.com site, loaded chat state, Dolly session id, preview URL, and backend request route as one site-scoped conversation identity, similar to WP Workspace's `(siteID, agentID)` conversation key.

Required behavior:

- Switching sites loads that site's existing local chat/session state or creates a fresh session for that site.
- Continuing a chat never sends the previous site's `sessionId` or messages to the newly selected site's backend route.
- Clear/start-new controls reset only the selected site's chat state.

Do this first because every other chat UX decision depends on preserving site/session correctness.

### 2. Backend Site Selection Sync

The Studio Dolly chat UI can choose a WordPress.com site before sending a message, and that works for requests initiated from the UI. Dolly can also switch the active site itself during a conversation and persist that site selection on the backend.

Required behavior:

- Detect or fetch the backend-selected site after a turn.
- Update the UI-selected site if Dolly changed it server-side.
- Avoid leaving `selectedDollySiteId` pointing at a stale site.
- Avoid clobbering an explicit user selection made while a turn is in flight.

Do this after site-scoped sessions so backend-driven site changes cannot pollute the wrong local chat state.

### 3. Live-Site Safety Signals

Make it obvious when Dolly is acting on a live WordPress.com site rather than a disposable local preview.

Required behavior:

- Add a clear visual affordance or warning state for live-site editing.
- Show whether the selected WordPress.com site is staging or production in the heading area.
- Prefer using fields from the existing sites endpoint response if they already include staging/production metadata.

Do this before deeper chrome polish because it affects the heading hierarchy and the user's risk model.

### 4. Sidebar IA And Context Menus

Round out the WordPress.com section in the left sidebar so it behaves like a first-class site directory, not just a temporary list.

Required behavior:

- Add right-click options on the top-level WordPress.com sidebar group for filtering and list controls.
- Add right-click options on individual WordPress.com sidebar sites, including an action to sync/pull the site locally.
- Add subtle visual affordances that distinguish local Studio sites from live WordPress.com sites without making the sidebar noisy.

Do this after live-site safety language is settled so the sidebar status treatment matches the main content area.

### 5. Preview Layout Stability

Fix the preview layout before refining the chrome.

Required behavior:

- Tune the default preview viewport. It currently renders too zoomed-in or mobile-like; it should start slightly zoomed out.
- Let the preview claim more horizontal space by default.
- Fix small-window resizing behavior. The chat and preview split gets buggy when the app window narrows, so the preview needs better min/max width constraints and responsive collapse behavior.

Do this before auto-refresh because preview reload behavior should be built on stable layout constraints.

### 6. Preview Chrome Polish

Improve the preview panel chrome. The current v1 proves the layout, but the header, controls, resize affordance, loading state, and visual hierarchy need a dedicated pass.

Do this after the layout constraints are stable so the polish work is not reworked.

### 7. Preview Auto-Refresh

Add an auto-refresh path for the preview when Dolly or another live-site action changes the selected WordPress.com site.

Do this after site/session correctness and preview stability, since refresh triggers need to target the right site and a stable preview surface.

### 8. Shared Chat UI Evaluation

Evaluate replacing the custom chat surface with `@automattic/agenttic-ui` so Studio aligns with the shared agent UI patterns.

Do this last unless it becomes a blocker. It may absorb or replace some custom chat controls, so the site/session model should be settled first.
