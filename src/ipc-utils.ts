import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import { PreviewCommandLoggerAction } from 'common/logger-actions';
import { ImportExportEventData } from 'src/lib/import-export/handle-events';
import { StoredToken } from 'src/lib/oauth';
import { getMainWindow } from 'src/main-window';
import type { UserData } from 'src/storage/storage-types';

type SnapshotEventData = {
	action: PreviewCommandLoggerAction;
	status: 'inprogress' | 'fail' | 'success';
	message: string;
};
type SnapshotKeyValueEventData = {
	action: 'keyValuePair';
	key: string;
	value: string;
};

export interface IpcEvents {
	'add-site': [ void ];
	'add-site-with-blueprint': [
		{
			blueprintPath: string;
			warnings?: BlueprintValidationWarning[];
		},
	];
	'auth-updated': [ { token: StoredToken } | { error: unknown } ];
	'on-export': [ ImportExportEventData, string ];
	'on-import': [ ImportExportEventData, string ];
	'on-site-create-progress': [ { siteId: string; message: string } ];
	providerConstantsChanged: [
		{
			defaultPhpVersion: string;
			defaultWordPressVersion: string;
			allowedPhpVersions: string[];
		},
	];
	'site-context-menu-action': [ { action: string; siteId: string } ];
	'site-status-changed': [ { siteId: string; status: 'running' | 'stopped'; url: string } ];
	'sync-upload-paused': [ { error: string; selectedSiteId: string; remoteSiteId: number } ];
	'sync-upload-resumed': [ { selectedSiteId: string; remoteSiteId: number } ];
	'sync-upload-progress': [ { selectedSiteId: string; remoteSiteId: number; progress: number } ];
	'snapshot-error': [ { operationId: crypto.UUID; data: SnapshotEventData } ];
	'snapshot-fatal-error': [ { operationId: crypto.UUID; data: { message: string } } ];
	'snapshot-output': [ { operationId: crypto.UUID; data: SnapshotEventData } ];
	'snapshot-key-value': [ { operationId: crypto.UUID; data: SnapshotKeyValueEventData } ];
	'snapshot-success': [ { operationId: crypto.UUID } ];
	'show-whats-new': [ void ];
	'sync-connect-site': [ { remoteSiteId: number; studioSiteId: string; autoOpenPush?: boolean } ];
	'test-render-failure': [ void ];
	'theme-details-changed': [ { id: string; details: StartedSiteDetails[ 'themeDetails' ] } ];
	'theme-details-updating': [ { id: string } ];
	'thumbnail-changed': [ { id: string; imageData: string | null } ];
	'user-settings': [ { tabName?: string } ];
	'window-fullscreen-change': [ boolean ];
	'user-preference-changed': [ void ];
	'user-data-updated': [ UserData ];
	'user-data-error': [ string ];
	'refresh-app-globals': [ void ];
	'beta-features-updated': [ void ];
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
