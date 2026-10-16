import { BrowserWindow } from 'electron';
import { SiteEvent, SnapshotEvent } from '@studio/common/lib/cli-events';
import { getExistingMainWindow } from 'src/main-window';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { AiSessionPlacementUpdatedEvent } from '@studio/common/ai/sessions/placement';
import type { StoredAuthToken } from '@studio/common/lib/shared-config';
import type { SyncEvent } from '@studio/common/lib/sync/activity';

export interface IpcEvents {
	'add-site': [ void ];
	'add-site-with-blueprint': [
		{
			blueprintPath: string;
		},
	];
	'ai-credits-purchased': [ void ];
	'auth-updated': [ { token: StoredAuthToken } | { token: null } ];
	'site-event': [ SiteEvent ];
	'snapshot-event': [ SnapshotEvent ];
	'sync-activity': [ SyncEvent ];
	'show-whats-new': [ void ];
	'show-getting-started': [ void ];
	'sync-connect-site': [
		{
			remoteSiteId: number;
			studioSiteId: string;
			autoOpenPush?: boolean;
		},
	];
	'toggle-sidebar': [ void ];
	'toggle-site-preview': [ void ];
	'user-settings': [ { tabName?: string } ];
	'window-fullscreen-change': [ boolean ];
	'ai-agent-event': [ AgentRunEvent ];
	'ai-session-placement-updated': [ AiSessionPlacementUpdatedEvent ];
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
