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

## Design Decisions

- **iframe over webview/BrowserView** — Simpler integration, works within the existing React panel layout, and localhost sites don't have the security concerns that would warrant a separate process.
- **Multiple hidden iframes for tabs** — All tab iframes stay mounted in the DOM (inactive ones use `display: none`). This is the simplest way to preserve full page state (scroll position, form inputs, JavaScript state, history) when switching tabs. Memory cost is negligible for the expected 2–5 tabs.
- **Tab state in the hook, not Redux** — Browser tabs are local UI state within the panel. No other component needs to know about them, so Redux would be unnecessary indirection.
- **Agent controls the real preview, not a hidden browser** — Navigate and reload go through the in-app browser so the user sees the agent's actions in real-time. Heavier inspection (screenshots, block validation) uses Playwright in the CLI subprocess, which doesn't need Electron APIs.
- **Dark toolbar (`#1d2327`)** — Matches the WordPress admin bar color so the toolbar and admin bar blend together visually.
- **Auto-login on every load** — The iframe `src` always goes through `/studio-auto-login` to ensure the session stays authenticated, even after reload.
- **No fake progress bar** — The loading indicator is an honest indeterminate bar (bouncing animation) since iframes don't expose real loading progress.
- **Tabs reset on site switch** — When the user selects a different site or task, all tabs are replaced with a single fresh tab. Preserving tabs across site switches would be confusing since each site has its own localhost URL.
