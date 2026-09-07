import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { SiteEvent, SnapshotEvent } from '@studio/common/lib/cli-events';
import { ExportIpcEvent, ImportEventTuple } from '@studio/common/lib/import-export-events';
import { PreviewCommandLoggerAction } from '@studio/common/logger-actions';
import { getExistingMainWindow } from 'src/main-window';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { AiSessionPlacementUpdatedEvent } from '@studio/common/ai/sessions/placement';
import type { RemoteSessionStatus } from '@studio/common/lib/remote-session';
import type { StoredAuthToken } from '@studio/common/lib/shared-config';
import type { PullSiteProgress, PushPhase } from '@studio/common/types/sync';

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
		},
	];
	'ai-credits-purchased': [ void ];
	'auth-updated': [ { token: StoredAuthToken } | { token: null } | { error: unknown } ];
	'on-export': [ ExportIpcEvent[ 'event' ], string ];
	'on-import': [ ImportEventTuple, string ];
	'on-site-create-progress': [ { siteId: string; message: string } ];
	'site-context-menu-action': [ { action: string; siteId: string } ];
	'site-event': [ SiteEvent ];
	'snapshot-event': [ SnapshotEvent ];
	'sync-upload-network-paused': [ { error: string; selectedSiteId: string; remoteSiteId: number } ];
	'sync-upload-resumed': [ { selectedSiteId: string; remoteSiteId: number } ];
	'sync-upload-progress': [ { selectedSiteId: string; remoteSiteId: number; progress: number } ];
	'sync-upload-manually-paused': [ { selectedSiteId: string; remoteSiteId: number } ];
	'sync-pull-progress': [ PullSiteProgress & { siteId: string } ];
	'sync-push-phase': [
		{ selectedSiteId: string; remoteSiteId: number; phase: PushPhase; progress?: number },
	];
	'snapshot-error': [ { operationId: crypto.UUID; data: SnapshotEventData } ];
	'snapshot-fatal-error': [ { operationId: crypto.UUID; data: { message: string } } ];
	'snapshot-output': [ { operationId: crypto.UUID; data: SnapshotEventData } ];
	'snapshot-key-value': [ { operationId: crypto.UUID; data: SnapshotKeyValueEventData } ];
	'snapshot-success': [ { operationId: crypto.UUID } ];
	'show-whats-new': [ void ];
	'show-getting-started': [ void ];
	'sync-connect-site': [
		{
			remoteSiteId: number;
			studioSiteId: string;
			autoOpenPush?: boolean;
		},
	];
	'test-render-failure': [ void ];
	'toggle-sidebar': [ void ];
	'toggle-site-preview': [ void ];
	'theme-details-loading': [ { id: string } ];
	'theme-details-loaded': [ { id: string; details: StartedSiteDetails[ 'themeDetails' ] } ];
	'thumbnail-loading': [ { id: string } ];
	'thumbnail-loaded': [ { id: string; imageData: string | null } ];
	'thumbnail-load-error': [ { id: string } ];
	'user-settings': [ { tabName?: string } ];
	'window-fullscreen-change': [ boolean ];
	'user-preference-changed': [ void ];
	'refresh-app-globals': [ void ];
	'beta-features-updated': [ void ];
	'ai-agent-event': [ AgentRunEvent ];
	'ai-session-placement-updated': [ AiSessionPlacementUpdatedEvent ];
	'remote-session-status': [ RemoteSessionStatus ];
	'app-update-status': [ AppUpdateStatus ];
	'app-update-not-available': [ { currentVersion: string } ];
}

/**
 * Updater lifecycle as the renderer sees it. `currentVersion` is null where there is no
 * desktop app to report on (the browser UI's connectors), and `newVersion` is null until
 * the feed lookup resolves — Electron's autoUpdater only names the version on download.
 */
export type AppUpdateStatus = (
	| { state: 'idle' | 'checking'; currentVersion: string | null }
	| { state: 'downloading'; currentVersion: string | null; newVersion: string | null }
	| { state: 'ready'; currentVersion: string | null; newVersion: string | null }
	| {
			state: 'error';
			currentVersion: string | null;
			reason: 'read-only-volume' | 'generic';
			detail?: string;
	  }
) & {
	// Set when the user asked for this check, so the renderer can re-show a dismissed card.
	requested?: boolean;
};

let isAppQuitting = false;

export function markAppQuitting() {
	isAppQuitting = true;
}

export async function sendIpcEventToRenderer< T extends keyof IpcEvents >(
	channel: T,
	...args: IpcEvents[ T ]
): Promise< void > {
	if ( isAppQuitting ) {
		return;
	}
	const window = getExistingMainWindow();
	if ( window && ! window.isDestroyed() && ! window.webContents.isDestroyed() ) {
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
