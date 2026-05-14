# Dolly Assistant Follow-ups

## Site Selection Sync

The Studio Dolly chat UI can choose a WordPress.com site before sending a message, and that works for requests initiated from the UI. Dolly can also switch the active site itself during a conversation and persist that site selection on the backend.

Follow-up: keep the Studio UI in sync when Dolly changes the active site server-side. The UI should detect or fetch the backend-selected site after a turn, update the site selector, and avoid leaving `selectedDollySiteId` pointing at a stale site. The implementation should also avoid clobbering an explicit user selection made while a turn is in flight.

## Site-Scoped Sessions

The selected WordPress.com site, loaded chat state, Dolly session id, preview URL, and backend request route should be treated as one site-scoped conversation identity, similar to WP Workspace's `(siteID, agentID)` conversation key. Switching sites should load that site's existing local chat/session state or create a fresh session for that site. Continuing a chat must never send the previous site's `sessionId` or messages to the newly selected site's backend route.

## Polish Queue

- Improve the preview panel chrome. The current v1 proves the layout, but the header, controls, resize affordance, loading state, and visual hierarchy need a dedicated pass.
- Evaluate replacing the custom chat surface with `@automattic/agenttic-ui` so Studio aligns with the shared agent UI patterns.
- Add an auto-refresh path for the preview when Dolly or another live-site action changes the selected WordPress.com site.
- Preserve chat state when switching between selected WordPress.com sites, using the site-scoped session model above. Include clear/start-new controls that reset only the selected site's chat state.
- Show whether the selected WordPress.com site is staging or production in the heading area. Prefer using fields from the existing sites endpoint response if they already include this.
- Add an obvious affordance or warning state that the selected assistant is acting on a live WordPress.com site, not a disposable local preview.
- Tune the default preview viewport. It currently renders too zoomed-in or mobile-like; it should start slightly zoomed out and the preview should claim more horizontal space by default.
- Fix small-window resizing behavior. The chat and preview split gets buggy when the app window narrows, so the preview needs better min/max width constraints and responsive collapse behavior.
