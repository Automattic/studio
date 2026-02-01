import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import { SiteEvent } from 'common/lib/site-events';
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
	'site-context-menu-action': [ { action: string; siteId: string } ];
	'site-event': [ SiteEvent ];
	'sync-upload-network-paused': [ { error: string; selectedSiteId: string; remoteSiteId: number } ];
	'sync-upload-resumed': [ { selectedSiteId: string; remoteSiteId: number } ];
	'sync-upload-progress': [ { selectedSiteId: string; remoteSiteId: number; progress: number } ];
	'sync-upload-manually-paused': [ { selectedSiteId: string; remoteSiteId: number } ];
	'snapshot-error': [ { operationId: crypto.UUID; data: SnapshotEventData } ];
	'snapshot-fatal-error': [ { operationId: crypto.UUID; data: { message: string } } ];
	'snapshot-output': [ { operationId: crypto.UUID; data: SnapshotEventData } ];
	'snapshot-key-value': [ { operationId: crypto.UUID; data: SnapshotKeyValueEventData } ];
	'snapshot-success': [ { operationId: crypto.UUID } ];
	'show-whats-new': [ void ];
	'sync-connect-site': [ { remoteSiteId: number; studioSiteId: string; autoOpenPush?: boolean } ];
	'test-render-failure': [ void ];
	'theme-details-loading': [ { id: string } ];
	'theme-details-loaded': [ { id: string; details: StartedSiteDetails[ 'themeDetails' ] } ];
	'thumbnail-loading': [ { id: string } ];
	'thumbnail-loaded': [ { id: string; imageData: string | null } ];
	'thumbnail-load-error': [ { id: string } ];
	'user-settings': [ { tabName?: string } ];
	'window-fullscreen-change': [ boolean ];
	'user-preference-changed': [ void ];
	'user-data-updated': [ UserData ];
	'user-data-error': [ string ];
	'refresh-app-globals': [ void ];
	'beta-features-updated': [ void ];
	// ACP (Agent Client Protocol) events
	'acp-session-update': [
		{
			sessionId: string;
			type: string;
			text?: string;
			tool_use?: { id: string; name: string; input: Record< string, unknown > };
			tool_result?: { tool_use_id: string; output?: string; error?: string };
			thinking?: string;
			progress?: { message: string; percentage?: number };
			approval_request?: { id: string; message: string; options: string[] };
			error?: { code: string; message: string };
		},
	];
	'acp-session-error': [ { sessionId: string; error: string } ];
	'acp-session-closed': [ { sessionId: string; code: number | null; signal: string | null } ];
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
