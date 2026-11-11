import { killChild } from '@studio/common/lib/cli-process';
import { isSyncCancelledError, SyncCancelledError } from '@studio/common/lib/sync/cancel';
import {
	FULL_PULL,
	legacyPullOptions,
	reprintPullFlags,
} from '@studio/common/lib/sync/pull-options';
import { isReprintPullEnabled } from '@studio/common/lib/sync/reprint-pull';
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

		// Only asks: the CLI stops if the sync is still safe to stop (`exitOnCancel`), and
		// otherwise finishes, so the outcome is whatever the command does next.
		let cancelRequested = false;
		const cancel = () => {
			cancelRequested = true;
			try {
				killChild( child, { force: false } );
			} catch ( error ) {
				console.error( 'Failed to stop the CLI process for', args[ 0 ], error );
				reject( new SyncCancelledError() );
			}
		};
		signal?.addEventListener( 'abort', cancel, { once: true } );
		const settle = ( run: () => void ) => {
			signal?.removeEventListener( 'abort', cancel );
			run();
		};

		emitter.on( 'success', () => settle( resolve ) );
		emitter.on( 'failure', ( { error } ) =>
			settle( () => reject( cancelRequested ? new SyncCancelledError() : error ) )
		);
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
		],
		signal
	);
}

// The arguments for the pull engine the CLI runs, which reads the same environment.
function pullSelectionArgs( options: PullSyncOptions ): string[] {
	if ( isReprintPullEnabled() ) {
		const { skipDatabase, skipFiles, only = [] } = reprintPullFlags( options );
		return [
			...( skipDatabase ? [ '--skip-database' ] : [] ),
			...( skipFiles ? [ '--skip-files' ] : [] ),
			...only.flatMap( ( path ) => [ '--only', path ] ),
		];
	}
	const { optionsToSync, includePathList = [] } = legacyPullOptions( options );
	return [
		'--options',
		optionsToSync.join( ',' ),
		// Each backup node id is its own argv value: ids can contain commas (e.g. themes
		// `cjE6,ZjE6Lw==`), so a join/split would corrupt them.
		...( includePathList.length ? [ '--include-path-list', ...includePathList ] : [] ),
	];
}

export function pullSite(
	executeCliCommand: ExecuteCliCommand,
	siteFolder: string,
	remoteSiteId: number,
	options: PullSyncOptions = FULL_PULL,
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
			...pullSelectionArgs( options ),
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
