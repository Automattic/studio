import { z } from 'zod';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { createCliServerProcess } from 'src/modules/cli/lib/cli-server-process';
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

let watcherEventEmitter: ReturnType< typeof executeCliCommand > | null = null;

async function updateSiteServerStatus(
	siteId: string,
	isRunning: boolean,
	url: string
): Promise< void > {
	let server = SiteServer.get( siteId );

	if ( ! server ) {
		const userData = await loadUserData();
		const siteData = userData.sites.find( ( s ) => s.id === siteId );
		if ( siteData ) {
			server = SiteServer.create( { ...siteData, running: false } );
		}
	}

	// We ignore Studio managed operations
	if ( server?.isUpdating ) {
		return;
	}

	if ( server ) {
		server.details = {
			...server.details,
			running: isRunning,
			url: isRunning ? url : '',
		};

		if ( isRunning && url && ! server.server ) {
			server.server = createCliServerProcess( siteId, server.details.path, url );
		} else if ( ! isRunning ) {
			server.server = undefined;
		}
	}
}

export function startSiteWatcher(): void {
	if ( watcherEventEmitter ) {
		return;
	}

	watcherEventEmitter = executeCliCommand( [ 'site', 'list', '--watch', '--format', 'json' ], {
		silent: true,
	} );

	watcherEventEmitter.on( 'data', ( { data } ) => {
		const parsed = siteStatusEventSchema.safeParse( data );
		if ( ! parsed.success ) {
			return;
		}

		const { siteId, status, url } = parsed.data.value;
		const isRunning = status === 'running';

		void updateSiteServerStatus( siteId, isRunning, url );
		void sendIpcEventToRenderer( 'site-status-changed', parsed.data.value );
	} );

	watcherEventEmitter.on( 'error', ( { error } ) => {
		console.error( 'Site watcher error:', error );
		watcherEventEmitter = null;
	} );

	watcherEventEmitter.on( 'failure', () => {
		console.warn( 'Site watcher exited unexpectedly' );
		watcherEventEmitter = null;
	} );
}

export function stopSiteWatcher(): void {
	watcherEventEmitter?.kill();
	watcherEventEmitter = null;
}
