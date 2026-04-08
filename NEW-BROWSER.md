# Browser Panel

The secondary panel in the new Studio UI is an embedded browser that previews the currently active WordPress site. It supports multiple tabs so users can keep several pages open simultaneously (e.g. the site frontend in one tab and wp-admin in another).

## How It Works

### Auto-Authentication

The iframe loads through the `/studio-auto-login` endpoint rather than the site URL directly. This authenticates the user automatically, which means:

- The WordPress admin bar is visible on the frontend, giving quick access to wp-admin pages, the site editor, customizer, etc.
- No separate login step is needed — the user is always authenticated when previewing.

### Site Resolution

The browser panel resolves which site to display based on context:

1. **Task selected** — If a task is selected in the sidebar, the browser shows the site associated with that task (via `task.siteId`).
2. **Site selected** — Otherwise, it shows the currently selected site from the sidebar.
3. **Site not running** — If the resolved site isn't running, the panel shows an empty state with "Start the site to preview it".

This logic lives in the `useBrowserPanel` hook (`apps/studio/src/hooks/use-browser-panel.ts`).

### Tabs

The browser supports multiple tabs per site. Each tab is its own iframe that preserves scroll position, form state, and navigation history independently.

**State model** — Each tab tracks its own `id`, `displayUrl`, `title`, `isLoading`, and `isInitialLoad`. Tab state lives entirely in the `useBrowserPanel` hook (not Redux) since it's local UI state. Iframe element refs are stored in a `Map<string, HTMLIFrameElement>`.

**Multiple hidden iframes** — All tab iframes are rendered simultaneously. The active tab is visible; inactive tabs use `display: none`. This means switching tabs is instant — scroll position, form inputs, and history are fully preserved because the iframe stays mounted.

**Tab lifecycle:**

- **Site loads** → one tab opens at the homepage (via auto-login URL)
- **New tab (`+` button)** → opens at the site homepage, becomes active
- **Switch** → CSS visibility swap, toolbar updates to show the active tab's URL and loading state
- **Close** → tab removed, its left neighbor activates (or first tab if leftmost was closed). The last remaining tab cannot be closed
- **Site changes** (sidebar selection or task switch) → all tabs reset to a single fresh tab
- **Soft cap** — maximum of 8 tabs to limit iframe resource usage

**Keyboard shortcuts:**

- `Cmd+Shift+[` / `Cmd+Shift+]` — switch to previous/next tab (wraps around)

### CSP and Framing

WordPress sends headers that block iframe embedding (`X-Frame-Options` and `Content-Security-Policy` with `frame-ancestors`). The Electron main process strips these headers from all localhost responses so wp-admin pages can load in the iframe. The app's own CSP includes `frame-src http://localhost:*` to allow framing local sites.

See the `onHeadersReceived` handler in `apps/studio/src/index.ts`.

### Loading States

Loading states are tracked per-tab. The toolbar reflects whichever tab is active.

- **Initial load** — Shows a WordPress `<Spinner>` centered on the dark panel background. The iframe is hidden (`opacity-0`) until it fires `onLoad`. The toolbar is always visible so tabs remain accessible.
- **In-page navigation** — When the user clicks links inside the iframe, a `beforeunload` listener detects the navigation start and shows an indeterminate progress bar (bouncing left-to-right) at the bottom of the toolbar. The bar disappears when the iframe's `onLoad` fires. A blue pulsing dot also appears in the tab strip next to the loading tab's title.

### URL Bar

The toolbar at the top of the panel includes an editable URL input. It updates automatically to reflect the iframe's current URL (read from `contentWindow.location.href` on each load). The user can also type a URL and press Enter to navigate the iframe directly.

### Navigation Controls

Back, Forward, and Reload buttons in the toolbar use the iframe's `contentWindow.history` API. Reload calls `contentWindow.location.reload()` to refresh the current page in-place (not the homepage).

## Key Files

- `apps/studio/src/hooks/use-browser-panel.ts` — Hook encapsulating all browser/tab state, site resolution, navigation handlers, tab management (`addTab`, `closeTab`, `selectTab`), keyboard shortcuts, and per-tab loading state.
- `apps/studio/src/components/new-ui/panel-layout.tsx` — Renders the browser panel in the secondary panel slot, composing the toolbar, tab bar, and iframe container.
- `apps/studio/src/components/new-ui/browser-tab-bar.tsx` — Compact tab strip component showing tab titles, close buttons, loading indicators, and new-tab button.
- `apps/studio/src/components/new-ui/browser-iframe-container.tsx` — Renders all tab iframes simultaneously (active visible, inactive hidden). Each iframe is wrapped in a `BrowserIframe` sub-component that manages its own `beforeunload` listener lifecycle.
- `apps/studio/src/index.ts` — Main process header stripping for iframe compatibility.
- `apps/studio/index.html` — Static CSP with `frame-src http://localhost:*`.
- `apps/studio/src/index.css` — `browser-progress` keyframe animation for the loading bar.

## Agent Browser Control

The AI agent can navigate and reload the in-app browser preview. These tools control the actual preview the user sees — when the agent navigates, the user watches it happen in their active tab.

### Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate the active tab to a URL or path (e.g. `/wp-admin/`). Relative paths are resolved against the site's base URL. |
| `browser_reload` | Reload the current page in the active tab. |

Screenshots and page reading use separate Playwright-based tools (`take_screenshot`, `validate_blocks`) that run in the CLI subprocess.

### IPC Flow

The agent runs in a forked CLI subprocess. Browser control messages flow through an IPC bridge:

1. CLI tool calls `process.send({ type: 'ai:browser-navigate', url })` or `process.send({ type: 'ai:browser-reload' })`
2. Desktop main process (`agent-manager.ts`) receives the message, resolves the `siteId` from the task metadata, resolves relative paths to full URLs using the site's base URL
3. Main process sends `browser-navigate` or `browser-reload` IPC event to the renderer via `sendIpcEventToRenderer`
4. Store listener (`stores/index.ts`) dispatches a `studio:browser-navigate` or `studio:browser-reload` custom DOM event
5. `useBrowserPanel` hook handles the event — navigates or reloads the active tab's iframe

### Key Files

- `apps/cli/ai/tools.ts` — `browserNavigateTool` and `browserReloadTool` definitions (send IPC via `process.send`).
- `apps/studio/src/modules/ai/lib/agent-manager.ts` — Handles `ai:browser-navigate` and `ai:browser-reload` messages from the CLI child process.
- `apps/studio/src/ipc-utils.ts` — Defines `browser-navigate` and `browser-reload` IPC event types.
- `apps/studio/src/stores/index.ts` — Subscribes to IPC events and dispatches DOM custom events.
- `apps/studio/src/hooks/use-browser-panel.ts` — Listens for custom events and controls the active tab's iframe.
- `tools/common/ai/system-prompt.ts` — Agent system prompt listing available tools.

## Element Selection for AI Context

Users can select elements from the browser preview to provide as structured context when chatting with the AI agent. This bridges the gap between "I want to change this thing" and the agent knowing exactly which element, styles, and block to target.

### How It Works

A WordPress mu-plugin (`0-element-selector-bridge.php`) injects a lightweight JavaScript bridge into every page via `wp_footer` and `admin_footer`. The script is dormant until activated — zero overhead on normal browsing.

Communication between the Electron renderer and the iframe uses `postMessage`, which works cross-origin by design (unlike direct DOM access via `contentDocument`/`contentWindow.location`, which is blocked).

### User Flow

1. User clicks the **Add notes** button (`sidesAxial` icon) in the browser toolbar — always visible, not just during active tasks.
2. **Without an active task** — standard selection mode. The renderer posts `studio:select-element:activate` to the active tab's iframe. Any previous selection highlight is cleared.
3. **With an active task** — persistent selection mode. The renderer posts `studio:select-element:activate-persistent`. Selection mode stays active after each click so users can rapidly annotate multiple elements.
4. Inside the iframe, hovering highlights elements with a blue overlay. Smart targeting resolves clicks on inline text to their parent semantic element (button, link, etc.).
5. User clicks an element → the bridge applies a persistent `outline` highlight directly on the element, extracts metadata, and posts `studio:select-element:selected` back to the parent.
6. A glassmorphic floating chat input appears near the selected element in the browser panel. The input is available in both task-chat and project-detail modes:
   - **Without an active task** — sending creates a new task and starts the agent.
   - **With an active task** — sending routes the message through the existing task chat (or queues it if the agent is busy). The element stays highlighted with a numbered floating label showing truncated note text.
7. **Multi-note flow** — With an active task, users can keep selecting elements and sending notes in rapid succession. Each note is numbered sequentially. If the agent is already responding, notes are queued and auto-sent when the agent finishes each turn.
8. **Note lifecycle** — When the agent completes a response for a note, that note's highlight turns green (success state) and fades away after ~2 seconds.
9. Pressing **Escape** clears the selection highlight and exits selection mode (handled in both the iframe and the parent frame).

### Element Data Captured

| Field | Description |
|-------|-------------|
| `cssSelector` | Unique selector path using id, classes, and nth-of-type |
| `tagName` | HTML tag name (lowercase) |
| `outerHTML` | Element markup, truncated to 2000 chars |
| `textContent` | Text content, truncated to 500 chars |
| `computedStyles` | Key CSS properties: color, background, font, padding, margin, border, display, position, dimensions |
| `boundingBox` | Position and size from `getBoundingClientRect()` |
| `domPath` | Ancestor chain, e.g. `["body", "div.site", "main", "section.hero", "h1"]` |
| `wpBlockName` | WordPress block name from `data-type` attribute or `wp-block-*` class pattern |

### Data Flow

```
mu-plugin JS (iframe)
  → window.parent.postMessage({ type: 'studio:select-element:selected', element })
  → useElementSelector hook (renderer) stores single element (replaces any previous)
  → Floating input displays chip (always shown — both task-chat and project-detail modes)
  → On send: element threaded through IPC (same path as images)
  → headless.ts serializes as <element-context> text block prepended to the prompt
  → Agent receives structured element data alongside the user's message
```

### Selection Highlight

The selected element keeps a visible `outline` directly applied to the DOM element (not a separate overlay div). This is more reliable than positioned overlays — outlines aren't clipped by `overflow: hidden` on ancestors and don't require z-index management.

Highlights are cleared via `studio:select-element:clear` postMessage in these cases:
- Entering selection mode (to replace any stale highlight)
- Selecting a new element (clear previous before applying new)
- Pressing Escape during selection
- Dismissing the element chip or sending the message

### Note Overlays

When a note is sent from the floating input during an active task, the selected element gets a persistent overlay managed by the iframe bridge:

- **`studio:notes:add`** — Creates an absolutely-positioned highlight div (blue outline) and a label pill showing `#N: truncated text` at the element's top-right corner.
- **`studio:notes:complete`** — Turns the highlight green and prepends a checkmark to the label (success state).
- **`studio:notes:remove`** — Fades out and removes the overlay DOM elements.
- **`studio:notes:clear`** — Removes all note overlays (e.g. when switching tasks).

Overlays reposition on scroll/resize via debounced `querySelector` + `getBoundingClientRect`. If the element is removed by the agent, the overlay cleans itself up gracefully.

Note state is tracked in Redux (`activeNotesByTask` in `tasks-slice.ts`) with an `ActiveNote` interface that stores `id`, `number`, `text`, `cssSelector`, `boundingBox`, and `status` (`active` → `completed` → `fading`). The `BrowserNoteOverlays` component bridges Redux state to iframe postMessages, handling the timed fade lifecycle.

### Floating Input

A compact floating input appears positioned near the selected element (below it, or above if insufficient space). It uses glassmorphism (`backdrop-blur-xl` with semi-transparent background) to stay readable over any page content. The input auto-focuses and supports Enter to send, Escape to dismiss.

The floating input is always visible regardless of whether a task is active:
- **Without an active task** — Sending creates a new task and starts the agent.
- **With an active task** — Sending routes the message through the existing task chat system. If the agent is streaming, messages are queued via the existing `enqueueMessage` mechanism and auto-sent when the agent finishes. After sending, persistent selection mode re-activates so the user can immediately pick another element.

### Key Files

- `tools/common/lib/mu-plugins.ts` — `0-element-selector-bridge.php` mu-plugin with the in-iframe JS bridge (hover overlay, click handler, element data extraction, postMessage communication).
- `apps/studio/src/hooks/use-element-selector.ts` — Hook managing selection state, postMessage listener, and selected elements collection.
- `apps/studio/src/hooks/use-browser-panel.ts` — Exposes `getActiveIframe()` for the element selector to post messages to the active tab.
- `apps/studio/src/components/new-ui/browser-floating-input.tsx` — Floating chat input that appears in the browser panel when elements are selected. Routes to new task creation (project-detail mode) or existing task chat with queueing support (task-chat mode).
- `apps/studio/src/components/new-ui/browser-note-overlays.tsx` — Lifecycle bridge between Redux note state and iframe postMessages. Handles completed→fading→removed transitions with timed delays.
- `apps/studio/src/components/new-ui/panel-layout.tsx` — Add Notes button in the browser toolbar.
- `apps/studio/src/modules/ai/types.ts` — `ElementAttachment` interface.
- `apps/cli/commands/ai/headless.ts` — `serializeElementContext()` and updated `buildContentBlocks()` for threading element data into agent prompts.
- `tools/common/ai/system-prompt.ts` — Documents element context usage for the agent.

## Design Decisions

- **iframe over webview/BrowserView** — Simpler integration, works within the existing React panel layout, and localhost sites don't have the security concerns that would warrant a separate process.
- **Multiple hidden iframes for tabs** — All tab iframes stay mounted in the DOM (inactive ones use `display: none`). This is the simplest way to preserve full page state (scroll position, form inputs, JavaScript state, history) when switching tabs. Memory cost is negligible for the expected 2–5 tabs.
- **Tab state in the hook, not Redux** — Browser tabs are local UI state within the panel. No other component needs to know about them, so Redux would be unnecessary indirection.
- **Agent controls the real preview, not a hidden browser** — Navigate and reload go through the in-app browser so the user sees the agent's actions in real-time. Heavier inspection (screenshots, block validation) uses Playwright in the CLI subprocess, which doesn't need Electron APIs.
- **Dark toolbar (`#1d2327`)** — Matches the WordPress admin bar color so the toolbar and admin bar blend together visually.
- **Auto-login on every load** — The iframe `src` always goes through `/studio-auto-login` to ensure the session stays authenticated, even after reload.
- **No fake progress bar** — The loading indicator is an honest indeterminate bar (bouncing animation) since iframes don't expose real loading progress.
- **Tabs reset on site switch** — When the user selects a different site or task, all tabs are replaced with a single fresh tab. Preserving tabs across site switches would be confusing since each site has its own localhost URL.
- **postMessage for element selection** — The iframe's cross-origin restrictions block direct DOM access, but `postMessage` works across origins by design. A mu-plugin injects the bridge script into every WordPress page, keeping the iframe architecture intact while enabling rich element inspection. This avoids a costly migration to `<webview>` or BrowserView.
- **Add Notes as unified entry point** — The button is always visible and adapts to context. Without a task, it creates one. With a task, it feeds into the existing chat/queue system. This keeps the interaction discoverable and reduces friction — users don't need to think about which mode they're in.
- **Persistent selection mode for tasks** — When a task is active, clicking "Add notes" enters persistent selection mode. After selecting an element and sending a note, selection mode stays active so users can immediately pick another element. This supports the rapid multi-note workflow without requiring repeated button clicks.
- **One element per note, multiple notes per task** — Each note targets a single element to keep the agent's context focused. But users can fire off multiple notes in rapid succession — they're queued and processed sequentially, with numbered overlays tracking which note is active.
- **Note overlays in the iframe** — Post-send note highlights and labels are rendered as absolutely-positioned divs inside the iframe (via the mu-plugin bridge) rather than as React components over the iframe. This means they scroll with the page content and stay aligned with their target elements without requiring cross-frame coordinate translation.
- **FIFO note completion** — Note lifecycle maps 1:1 with agent response cycles. Each `task-status-changed` → `waiting` event completes the oldest active note. This works because the message queue is also FIFO — the order of note creation matches the order of agent processing.
- **Outline over overlay divs for initial selection highlight** — The selection-mode highlight uses `el.style.outline` directly on the element rather than a positioned overlay div. Outlines are immune to `overflow: hidden` clipping, don't require scroll-position calculations, and don't need z-index management. Note overlays (post-send) use positioned divs instead, since they need labels and color transitions.
- **Glassmorphic floating input** — The browser panel floating input uses `backdrop-blur-xl` with a semi-transparent background so it stays readable regardless of the page content behind it. Positioned near the selected element to keep the spatial connection obvious.
