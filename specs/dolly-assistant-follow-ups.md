# Dolly Assistant Follow-ups

## Completed

- Site-scoped sessions: switching WordPress.com sites remounts/isolates the assistant so a prior site's messages or `sessionId` are not reused.
- Backend site selection sync: after a Dolly turn, Studio detects the backend-selected site from the response or session history, updates the active UI site when Dolly switched it, and avoids clobbering explicit user selections made while a turn is in flight.
- Preview refresh guard: Dolly preview tool calls are idempotent for the currently open URL and only force a same-URL reload when Dolly marks `siteChanged`.
- Preview default state: WordPress.com live-site chats start with the preview hidden and only open when the user or Dolly requests a preview.
- Live-site chat state: each WordPress.com target keeps persisted Dolly conversations with local ids, messages, draft input, session ids, and optional server `remoteChatId`.
- Server hydration: WordPress.com live-site chats hydrate matching Dolly server conversations into the target's conversation collection, merge by `remoteChatId`/normalized `sessionId`, and keep a fresh blank chat selected by default.
- Live-site safety signals: WordPress.com live-site chats show a heading badge for the selected site's environment, a WP.com badge, and a warning that Dolly can make changes directly to the live site.
- Preview resize drag capture: dragging the WordPress.com preview splitter keeps pointer capture above the embedded preview so shrinking does not get stuck and releases cleanly.
- Sidebar WordPress.com item polish: live WordPress.com site rows align with local site rows and use a subtle WordPress icon affordance instead of nested indentation.
- Sidebar WordPress.com workspace grouping: production and staging sites keep their relationship in `SyncSite` and render as one workspace row with compact target/status indicators instead of duplicate sibling site rows.
- Workspace, target, and chat IA: WordPress.com assistant state now follows `Workspace -> Target -> Chat`; the sidebar owns workspace selection, the header owns target switching, the chat surface owns conversation switching/new chat, and preview state is scoped per target.

## New Unprioritized Follow-ups

### Chat Switching And Feedback UX

The first pass proves the `Workspace -> Target -> Chat` model, but the conversation controls need a more intentional UI.

Required behavior:

- Replace the bare conversation dropdown with a polished compact chat switcher that has a useful empty/single-chat state.
- Avoid making `New chat` feel jarring when there is only one blank or current chat.
- Allow old chats to be deleted or trashed directly from the switcher without selecting them first.
- Keep the current target's active chat obvious without taking too much vertical space above the message list.
- Wire the thumbs up/down feedback controls to the correct Dolly chat. They should appear consistently where supported, and clicking them must not fail with "no chat found" for hydrated or locally created conversations.

### Header Target Switcher

The production/staging target switcher is the right direction and should become the universal target affordance for WordPress.com workspaces.

Required behavior:

- Show Production and Staging targets for every WordPress.com workspace.
- If a workspace has no staging site, the Staging target becomes the create-staging affordance and replaces the separate header "Create staging site" button.
- If staging is not supported or the user cannot create it, keep the Staging target visible but disabled with a tooltip explaining why.
- Add a Local target to the switcher for every WordPress.com workspace as a future-local-site stub; selecting it should show a TODO alert for now.
- Make the switcher update the same target-scoped context as the current implementation: selected site id, Dolly endpoint, preview state, unread state, and selected conversation.

### Header Layout Bug

The WordPress.com assistant header can be clipped at the top in some window sizes.

Required behavior:

- Fix the header's top spacing/positioning so the title, badges, URL, target switcher, and preview controls are never cut off.
- Re-check the layout with and without the preview panel open, since the right-side controls and available width change.

## Remaining Prioritized Plan

### 1. Sidebar IA And Context Menus

Round out the WordPress.com section in the left sidebar so it behaves like a first-class site directory, not just a temporary list.

Required behavior:

- Add right-click options on the top-level WordPress.com sidebar group for filtering and list controls.
- Add right-click options on individual WordPress.com sidebar sites, including an action to sync/pull the site locally.
- Add favorite/pin support at the workspace-row level, not per production/staging target.
- Add richer list controls only where needed; the basic live-site visual distinction is in place.

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
