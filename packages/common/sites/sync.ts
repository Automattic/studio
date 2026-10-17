import { killChild } from '@studio/common/lib/cli-process';
import { isSyncCancelledError, SyncCancelledError } from '@studio/common/lib/sync/cancel';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';

// Syncs run as CLI commands, which publish their progress as sync activity events.

function runSyncCommand(
	executeCliCommand: ExecuteCliCommand,
	args: string[],
	signal: AbortSignal | undefined
): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		if ( signal?.aborted ) {
			reject( new SyncCancelledError() );
			return;
		}

		const [ emitter, child ] = executeCliCommand( args, { output: 'capture' } );

		const cancel = () => {
			// Reject even if the kill fails — otherwise a cancel would hang the
			// caller forever instead of stopping.
			try {
				killChild( child );
			} catch ( error ) {
				console.error( 'Failed to stop the CLI process for', args[ 0 ], error );
			}
			reject( new SyncCancelledError() );
		};
		signal?.addEventListener( 'abort', cancel, { once: true } );
		const settle = ( run: () => void ) => {
			signal?.removeEventListener( 'abort', cancel );
			run();
		};

		emitter.on( 'success', () => settle( resolve ) );
		emitter.on( 'failure', ( { error } ) => settle( () => reject( error ) ) );
		emitter.on( 'error', ( { error } ) => settle( () => reject( error ) ) );
	} );
}

export function pushSite(
	executeCliCommand: ExecuteCliCommand,
	siteFolder: string,
	remoteSiteId: number,
	options?: PushSyncOptions,
	signal?: AbortSignal
): Promise< void > {
	return runSyncCommand(
		executeCliCommand,
		[
			'push',
			'--path',
			siteFolder,
			'--remote-site',
			String( remoteSiteId ),
			'--options',
			( options?.optionsToSync?.length ? options.optionsToSync : [ 'all' ] ).join( ',' ),
			...( options?.specificSelectionPaths?.length
				? [ '--include-only', ...options.specificSelectionPaths ]
				: [] ),
			// The UI records `studio_sync_push` itself.
			'--suppress-tracks-event',
		],
		signal
	);
}

export function pullSite(
	executeCliCommand: ExecuteCliCommand,
	siteFolder: string,
	remoteSiteId: number,
	options?: PullSyncOptions,
	signal?: AbortSignal
): Promise< void > {
	return runSyncCommand(
		executeCliCommand,
		[
			'pull',
			'--path',
			siteFolder,
			'--remote-site',
			String( remoteSiteId ),
			'--options',
			( options?.optionsToSync?.length ? options.optionsToSync : [ 'all' ] ).join( ',' ),
			// Pass each backup node id as its own argv value — ids can contain
			// commas (e.g. themes `cjE6,ZjE6Lw==`), so a join/split would corrupt them.
			...( options?.includePathList?.length
				? [ '--include-path-list', ...options.includePathList ]
				: [] ),
			// The UI records `studio_sync_pull` itself.
			'--suppress-tracks-event',
		],
		signal
	);
}

export type SyncResult = { cancelled: boolean };

/**
 * Runs pushes and pulls so the host can cancel one by site and remote site. A cancel resolves
 * `{ cancelled: true }` rather than rejecting, since it's an intentional stop and not a failure.
 */
export function createSyncRunner( execute: ExecuteCliCommand ) {
	const controllers = new Map< string, AbortController >();
	const key = ( siteId: string, remoteSiteId: number ) => `${ siteId }-${ remoteSiteId }`;

	async function run(
		siteId: string,
		remoteSiteId: number,
		sync: ( signal: AbortSignal ) => Promise< void >
	): Promise< SyncResult > {
		const id = key( siteId, remoteSiteId );
		const controller = new AbortController();
		controllers.set( id, controller );
		try {
			await sync( controller.signal );
			return { cancelled: false };
		} catch ( error ) {
			if ( isSyncCancelledError( error ) ) {
				return { cancelled: true };
			}
			throw error;
		} finally {
			if ( controllers.get( id ) === controller ) {
				controllers.delete( id );
			}
		}
	}

	return {
		push: (
			siteId: string,
			sitePath: string,
			remoteSiteId: number,
			options?: PushSyncOptions
		): Promise< SyncResult > =>
			run( siteId, remoteSiteId, ( signal ) =>
				pushSite( execute, sitePath, remoteSiteId, options, signal )
			),
		pull: (
			siteId: string,
			sitePath: string,
			remoteSiteId: number,
			options?: PullSyncOptions
		): Promise< SyncResult > =>
			run( siteId, remoteSiteId, ( signal ) =>
				pullSite( execute, sitePath, remoteSiteId, options, signal )
			),
		cancel: ( siteId: string, remoteSiteId: number ): void => {
			controllers.get( key( siteId, remoteSiteId ) )?.abort();
		},
	};
}
