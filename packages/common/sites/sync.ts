import { killChild } from '@studio/common/lib/cli-process';
import { SyncCancelledError } from '@studio/common/lib/sync/cancel';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';

/**
 * WordPress.com sync operations, run as the CLI's `push` and `pull` commands so a sync behaves the
 * same whichever surface starts it. The commands publish their progress as sync activity events,
 * which every UI renders; these resolve once the command finishes.
 */

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
				console.error( `[${ args[ 0 ] }] Failed to stop the CLI process`, error );
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
