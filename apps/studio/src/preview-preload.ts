/**
 * Preload script attached to the `WebContentsView` that hosts the site
 * preview. Exposes a small bridge on `window.__studioInspector` so the
 * inspector page script (injected via `webContents.executeJavaScript`) can
 * send annotation events back to the host renderer.
 *
 * The view has no host (it's a top-level web contents under
 * `mainWindow.contentView`), so events flow through the main process and
 * are forwarded to the host renderer via `webContents.send` keyed by
 * `viewId`. See `apps/studio/src/preview-view.ts`.
 */

import { contextBridge, ipcRenderer } from 'electron';

const EVENT_CHANNEL = 'studio-inspector:event';

contextBridge.exposeInMainWorld( '__studioInspector', {
	send( payload: unknown ): void {
		ipcRenderer.send( EVENT_CHANNEL, payload );
	},
} );
