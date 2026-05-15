# Dolly Assistant Follow-ups

## Completed

- Site-scoped sessions: switching WordPress.com sites remounts/isolates the assistant so a prior site's messages or `sessionId` are not reused.
- Backend site selection sync: after a Dolly turn, Studio detects the backend-selected site from the response or session history, updates the active UI site when Dolly switched it, and avoids clobbering explicit user selections made while a turn is in flight.
- Preview refresh guard: Dolly preview tool calls are idempotent for the currently open URL and only force a same-URL reload when Dolly marks `siteChanged`.
- Preview default state: WordPress.com live-site chats start with the preview hidden and only open when the user or Dolly requests a preview.
- Live-site chat state: each WordPress.com target keeps persisted Dolly conversations with local ids, messages, draft input, session ids, and optional server `remoteChatId`.
- Server hydration: WordPress.com live-site chats hydrate matching Dolly server conversations into the target's conversation collection, merge by `remoteChatId`/normalized `sessionId`, and keep a fresh blank chat selected by default.
- Site identity signals: WordPress.com live-site chats show compact Production/Staging/Local target chips without the old WP.com badge or live-site warning row.
- Preview resize drag capture: dragging the WordPress.com preview splitter keeps pointer capture above the embedded preview so shrinking does not get stuck and releases cleanly.
- Sidebar WordPress.com item polish: live WordPress.com site rows align with local site rows and use a subtle WordPress icon affordance instead of nested indentation.
- Sidebar WordPress.com workspace grouping: production and staging sites keep their relationship in `SyncSite` and render as one workspace row with compact target/status indicators instead of duplicate sibling site rows.
- Workspace, target, and chat IA: WordPress.com assistant state now follows `Workspace -> Target -> Chat`; the sidebar owns workspace selection, the header owns target switching, the chat surface owns conversation switching/new chat, and preview state is scoped per target.
- Chat switching UX: the WordPress.com assistant keeps active chat metadata as a compact composer line, exposes chat options from the input action row, supports local chat trash, and locally hides trashed remote history so hydration does not re-add it immediately.
- Header target switcher: every WordPress.com assistant header shows Production, Staging, and Local targets; Staging owns the create-staging affordance and Local is a disabled future-target stub.
- Header/footer layout: the WordPress.com assistant uses one shared horizontal header for site identity, target controls, and preview/browser controls; when preview opens, the full right-side preview pane starts below that header.

## New Unprioritized Follow-ups

### Chat Feedback UX

The shared message UI can show thumbs up/down controls, but the WordPress.com Dolly feedback action is not wired to the correct server chat yet.

Required behavior:

- Wire the thumbs up/down feedback controls to the correct Dolly chat. They should appear consistently where supported, and clicking them must not fail with "no chat found" for hydrated or locally created conversations.

## Remaining Prioritized Plan

### 1. Sidebar IA And Context Menus

Round out the WordPress.com section in the left sidebar so it behaves like a first-class site directory, not just a temporary list.

Required behavior:

- Add right-click options on the top-level WordPress.com sidebar group for filtering and list controls.
- Add right-click options on individual WordPress.com sidebar sites, including an action to sync/pull the site locally.
- Add favorite/pin support at the workspace-row level, not per production/staging target.
- Add richer list controls only where needed; the basic live-site visual distinction is in place.

Do this after the site identity language is settled so the sidebar status treatment matches the main content area.

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
