# Browser Panel

The secondary panel in the new Studio UI is an embedded browser that previews the currently active WordPress site. It uses an iframe to render the site directly inside the app.

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

### CSP and Framing

WordPress sends headers that block iframe embedding (`X-Frame-Options` and `Content-Security-Policy` with `frame-ancestors`). The Electron main process strips these headers from all localhost responses so wp-admin pages can load in the iframe. The app's own CSP includes `frame-src http://localhost:*` to allow framing local sites.

See the `onHeadersReceived` handler in `apps/studio/src/index.ts`.

### Loading States

Two distinct loading states:

- **Initial load** — Shows a WordPress `<Spinner>` centered on the dark panel background. The iframe is hidden (`opacity-0`) until it fires `onLoad`. The toolbar is also hidden during this phase.
- **In-page navigation** — When the user clicks links inside the iframe, a `beforeunload` listener detects the navigation start and shows an indeterminate progress bar (bouncing left-to-right) at the bottom of the toolbar. The bar disappears when the iframe's `onLoad` fires.

### URL Bar

The toolbar at the top of the panel includes an editable URL input. It updates automatically to reflect the iframe's current URL (read from `contentWindow.location.href` on each load). The user can also type a URL and press Enter to navigate the iframe directly.

### Navigation Controls

Back, Forward, and Reload buttons in the toolbar use the iframe's `contentWindow.history` API. Reload re-authenticates by navigating back to the auto-login URL.

## Key Files

- `apps/studio/src/hooks/use-browser-panel.ts` — Hook encapsulating all browser state, site resolution, navigation handlers, and loading state management.
- `apps/studio/src/components/new-ui/panel-layout.tsx` — Renders the browser panel in the secondary panel slot, including toolbar and iframe.
- `apps/studio/src/index.ts` — Main process header stripping for iframe compatibility.
- `apps/studio/index.html` — Static CSP with `frame-src http://localhost:*`.
- `apps/studio/src/index.css` — `browser-progress` keyframe animation for the loading bar.

## Agent Browser Control

The AI agent can control the browser preview through a set of MCP tools. Under the hood, a `BrowserInspector` singleton in the main process manages hidden `BrowserWindow` instances (one per site, created on demand) that provide full `webContents` access for screenshots, DOM reading, and console capture.

### Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL or path (e.g. `/wp-admin/`). Syncs the visible preview. |
| `browser_reload` | Reload the current page. Syncs the visible preview. |
| `browser_screenshot` | Take a PNG screenshot via `webContents.capturePage()`. Returns an MCP image block. |
| `browser_read_page` | Read page title, URL, text content, and DOM outline (headings, links, forms, buttons). |
| `browser_console` | Read buffered console messages (log/warning/error) with optional clear. |

### Hidden BrowserWindow Architecture

The visible iframe preview stays unchanged. The agent operates on a separate hidden `BrowserWindow` for each site:

- **Window config** — `show: false`, 1280x800 viewport, full sandbox (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`), no preload script.
- **Auto-login** — Same `/studio-auto-login?redirect_to=URL` pattern as the iframe.
- **URL validation** — Only same-origin navigation allowed (prevents browsing external sites).
- **Console capture** — `console-message` event on `webContents` buffers the last 100 messages per site.
- **Operation queue** — Per-site promise chain serializes concurrent tool calls.
- **Idle cleanup** — Windows auto-destroy after 5 minutes of inactivity. Sweeper runs every 60 seconds.
- **Navigation timeout** — 15-second timeout on `loadURL` to prevent hanging tool calls.

### Preview Sync

When the agent navigates or reloads, the hidden window fires a `browser-navigate` IPC event to the renderer. The `useBrowserPanel` hook listens for `studio:browser-navigate` custom events (dispatched from the store's IPC subscription) and navigates the visible iframe to match.

### Key Files

- `apps/studio/src/modules/ai/lib/browser-inspector.ts` — BrowserInspector singleton managing hidden windows.
- `apps/studio/src/modules/ai/lib/browser-tools.ts` — MCP tool definitions for the five browser tools.
- `apps/studio/src/modules/ai/lib/tools.ts` — Includes browser tools in `studioToolDefinitions`.

## Design Decisions

- **iframe over webview/BrowserView** — Simpler integration, works within the existing React panel layout, and localhost sites don't have the security concerns that would warrant a separate process.
- **Hidden BrowserWindow for agent inspection** — The agent needs `capturePage()`, `executeJavaScript()`, and `console-message` events, none of which are available through an iframe. A hidden BrowserWindow provides full `webContents` access without changing the preview UI. Zero migration risk.
- **Dark toolbar (`#1d2327`)** — Matches the WordPress admin bar color so the toolbar and admin bar blend together visually.
- **Auto-login on every load** — The iframe `src` always goes through `/studio-auto-login` to ensure the session stays authenticated, even after reload.
- **No fake progress bar** — The loading indicator is an honest indeterminate bar (bouncing animation) since iframes don't expose real loading progress.
