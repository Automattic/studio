# Dolly Assistant Follow-ups

## Completed

- Site-scoped sessions: switching WordPress.com sites remounts/isolates the assistant so a prior site's messages or `sessionId` are not reused.
- Backend site selection sync: after a Dolly turn, Studio detects the backend-selected site from the response or session history, updates the active UI site when Dolly switched it, and avoids clobbering explicit user selections made while a turn is in flight.
- Preview refresh guard: Dolly preview tool calls are idempotent for the currently open URL and only force a same-URL reload when Dolly marks `siteChanged`.
- Preview default state: WordPress.com live-site chats start with the preview hidden and only open when the user or Dolly requests a preview.
- Live-site chat state: each WordPress.com site keeps its own persisted local Dolly conversation id, messages, draft input, session id, backend-selected active site, and preview state while switching between live-site tabs.
- Server hydration: WordPress.com live-site chats load the latest matching Dolly server conversation on mount, preserve its `remoteChatId`/`sessionId`, and continue future sends in that hydrated session.
- Live-site safety signals: WordPress.com live-site chats show a heading badge for the selected site's environment, a WP.com badge, and a warning that Dolly can make changes directly to the live site.
- Preview resize drag capture: dragging the WordPress.com preview splitter keeps pointer capture above the embedded preview so shrinking does not get stuck and releases cleanly.

## Remaining Prioritized Plan

### 1. Sidebar IA And Context Menus

Round out the WordPress.com section in the left sidebar so it behaves like a first-class site directory, not just a temporary list.

Required behavior:

- Add right-click options on the top-level WordPress.com sidebar group for filtering and list controls.
- Add right-click options on individual WordPress.com sidebar sites, including an action to sync/pull the site locally.
- Add subtle visual affordances that distinguish local Studio sites from live WordPress.com sites without making the sidebar noisy.

Do this after live-site safety language is settled so the sidebar status treatment matches the main content area.

### 2. Preview Layout Stability

Fix the preview layout before refining the chrome.

Required behavior:

- Tune the default preview viewport. It currently renders too zoomed-in or mobile-like; it should start slightly zoomed out.
- Let the preview claim more horizontal space by default.
- Finish small-window width constraints and responsive collapse behavior. The drag capture issue is fixed, but the preview still needs better constraints when the app window narrows.

Do this before auto-refresh because preview reload behavior should be built on stable layout constraints.

### 3. Preview Chrome Polish

Improve the preview panel chrome. The current v1 proves the layout, but the header, controls, resize affordance, loading state, and visual hierarchy need a dedicated pass.

Do this after the layout constraints are stable so the polish work is not reworked.

### 4. Shared Chat UI Evaluation

Evaluate replacing the custom chat surface with `@automattic/agenttic-ui` so Studio aligns with the shared agent UI patterns.

Do this last unless it becomes a blocker. It may absorb or replace some custom chat controls, so the site/session model should be settled first.
