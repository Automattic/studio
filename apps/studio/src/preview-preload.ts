/**
 * Preload script attached to the `WebContentsView` that hosts the site
 * preview. Exposes a small bridge on `window.__studioInspector` so the
 * inspector page script (injected via `webContents.executeJavaScript`) can:
 *   - Receive commands from the host renderer (start/stop picking, clear, …)
 *   - Send annotation events back to the host renderer
 *
 * The view has no host (it's a top-level web contents under
 * `mainWindow.contentView`), so events flow through the main process and
 * are forwarded to the host renderer via `webContents.send` keyed by
 * `viewId`. See `apps/studio/src/preview-view.ts`.
 */

import { contextBridge, ipcRenderer } from 'electron';

const COMMAND_CHANNEL = 'studio-inspector:command';
const EVENT_CHANNEL = 'studio-inspector:event';

type CommandHandler = ( payload: unknown ) => void;

const commandHandlers = new Set< CommandHandler >();

ipcRenderer.on( COMMAND_CHANNEL, ( _event, payload: unknown ) => {
	for ( const handler of commandHandlers ) {
		try {
			handler( payload );
		} catch ( error ) {
			// Swallow handler errors so a buggy injected script can't break the
			// rest of the bridge.
			console.error( 'studio-inspector handler error', error );
		}
	}
} );

contextBridge.exposeInMainWorld( '__studioInspector', {
	onCommand( handler: CommandHandler ): () => void {
		commandHandlers.add( handler );
		return () => {
			commandHandlers.delete( handler );
		};
	},
	send( payload: unknown ): void {
		ipcRenderer.send( EVENT_CHANNEL, payload );
	},
} );
