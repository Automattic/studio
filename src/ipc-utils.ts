import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { CreateLoggerAction } from 'cli/commands/preview/logger-actions';
import { ImportExportEventData } from 'src/lib/import-export/handle-events';
import { StoredToken } from 'src/lib/oauth';
import { getMainWindow } from 'src/main-window';

type PreviewEventData = {
	action: CreateLoggerAction;
	status: 'inprogress' | 'fail' | 'success';
	message: string;
};

export interface IpcEvents {
	'add-site': [ void ];
	'auth-updated': [ { token: StoredToken } | { error: unknown } ];
	'on-export': [ ImportExportEventData, string ];
	'on-import': [ ImportExportEventData, string ];
	'preview-error': [ { operationId: crypto.UUID; data: PreviewEventData } ];
	'preview-output': [ { operationId: crypto.UUID; data: PreviewEventData } ];
	'preview-success': [ { operationId: crypto.UUID } ];
	'show-whats-new': [ void ];
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
