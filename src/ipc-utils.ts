import { BrowserWindow } from 'electron';
import { ImportExportEventData } from 'src/lib/import-export/handle-events';
import { StoredToken } from 'src/lib/oauth';
import { getMainWindow } from 'src/main-window';

export interface IpcEvents {
	'add-site': [ void ];
	'auth-updated': [ { token: StoredToken } | { error: unknown } ];
	'on-export': [ ImportExportEventData, string ];
	'on-import': [ ImportExportEventData, string ];
	'preview-error': [ { siteId: string; error: string } ];
	'preview-output': [ { siteId: string; output: string } ];
	'preview-success': [ { siteId: string } ];
	'sync-connect-site': [ { remoteSiteId: number; studioSiteId: string } ];
	'test-render-failure': [ void ];
	'theme-details-changed': [ { id: string; details: StartedSiteDetails[ 'themeDetails' ] } ];
	'theme-details-updating': [ { id: string } ];
	'thumbnail-changed': [ { id: string; imageData: string | null } ];
	'user-settings': [ void ];
	'window-fullscreen-change': [ boolean ];
}

export async function sendIpcEventToRenderer< T extends keyof IpcEvents >(
	channel: T,
	...args: IpcEvents[ T ]
): Promise< void > {
	const window = await getMainWindow();
	if ( ! window.isDestroyed() && ! window.webContents.isDestroyed() ) {
		window.webContents.send( channel, ...args );
	}
}

export function sendIpcEventToRendererWithWindow< T extends keyof IpcEvents >(
	window: BrowserWindow | null,
	channel: T,
	...args: IpcEvents[ T ]
): void {
	if ( window && ! window.isDestroyed() && ! window.webContents.isDestroyed() ) {
		window.webContents.send( channel, ...args );
	}
}
