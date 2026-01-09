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

export async function startSiteWatcher(): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		if ( watcher ) {
			return resolve();
		}

		watcher = executeCliCommand( [ 'site', 'list', '--watch', '--format', 'json' ], {
			mode: 'ignore-stdio',
		} );
		const [ eventEmitter ] = watcher;

		eventEmitter.on( 'started', () => {
			resolve();
		} );

		eventEmitter.on( 'error', ( { error } ) => {
			reject();
			console.error( 'Site watcher error:', error );
			watcher = null;
		} );

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

		eventEmitter.on( 'failure', () => {
			console.warn( 'Site watcher exited unexpectedly' );
			watcher = null;
		} );
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
