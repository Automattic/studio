/**
 * Site Status Watcher
 *
 * This module monitors site running/stopped status changes by subscribing to PM2 process events
 * via `studio site list --watch`. It's primarily used to detect status changes that occur outside
 * of Studio's direct control, such as:
 * - Sites started/stopped via CLI commands
 * - Site crashes or unexpected process terminations
 *
 * IMPORTANT: Architecture Notes
 * -----------------------------
 * There are currently TWO separate watchers that update the UI with site changes:
 *
 * 1. Site Status Watcher (this file):
 *    - Monitors PM2 process events (start/stop/crash)
 *    - Only detects running/stopped status changes
 *    - Sends 'site-status-changed' IPC events to the renderer
 *
 * 2. User Data Watcher (src/lib/user-data-watcher.ts):
 *    - Monitors the appdata file directly via fs.watch
 *    - Detects ALL changes to site data (new sites, edits, deletions)
 *    - Sends 'user-data-updated' IPC events to the renderer
 *
 * The renderer (use-site-details.tsx) listens to BOTH:
 * - 'site-status-changed': Updates running/stopped status for existing sites
 * - 'user-data-updated': Refreshes the entire site list (handles new sites, edits, deletions)
 *
 */
import { z } from 'zod';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { SiteServer } from 'src/site-server';
import { loadUserData } from 'src/storage/user-data';

const siteStatusEventSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'site-status' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) )
		.pipe(
			z.object( {
				siteId: z.string(),
				status: z.enum( [ 'running', 'stopped' ] ),
				url: z.string(),
			} )
		),
} );

let watcher: ReturnType< typeof executeCliCommand > | null = null;

const pendingUpdates = new Map< string, Promise< void > >();

async function updateSiteServerStatus(
	siteId: string,
	isRunning: boolean,
	url: string
): Promise< void > {
	const previous = pendingUpdates.get( siteId ) ?? Promise.resolve();
	const current = previous
		.catch( () => {} )
		.then( async () => {
			let server = SiteServer.get( siteId );

			if ( ! server ) {
				const userData = await loadUserData();
				const siteData = userData.sites.find( ( s ) => s.id === siteId );
				if ( siteData ) {
					const existingServer = SiteServer.getByPath( siteData.path );
					if ( existingServer ) {
						server = existingServer;
					} else {
						server = SiteServer.register( { ...siteData, running: false } );
					}
				}
			}

			// We ignore Studio managed operations
			if ( server?.hasOngoingOperation ) {
				return;
			}

			if ( server ) {
				server.details = {
					...server.details,
					running: isRunning,
					url: isRunning ? url : '',
				};
			}
		} );
	pendingUpdates.set( siteId, current );
	await current;
}

export function startSiteWatcher(): void {
	if ( watcher ) {
		return;
	}

	watcher = executeCliCommand( [ 'site', 'list', '--watch', '--format', 'json' ], {
		output: 'ignore',
	} );
	const [ eventEmitter ] = watcher;

	eventEmitter.on( 'data', ( { data } ) => {
		const parsed = siteStatusEventSchema.safeParse( data );
		if ( ! parsed.success ) {
			return;
		}

		const { siteId, status, url } = parsed.data.value;
		const isRunning = status === 'running';

		void updateSiteServerStatus( siteId, isRunning, url );
		void sendIpcEventToRenderer( 'site-status-changed', parsed.data.value );
	} );

	eventEmitter.on( 'error', ( { error } ) => {
		console.error( 'Site watcher error:', error );
		watcher = null;
	} );

	eventEmitter.on( 'failure', () => {
		console.warn( 'Site watcher exited unexpectedly' );
		watcher = null;
	} );
}

export function stopSiteWatcher(): void {
	if ( watcher ) {
		const [ , childProcess ] = watcher;
		if ( childProcess.connected ) {
			childProcess.disconnect();
		}
		childProcess.kill();
		watcher = null;
	}
}
