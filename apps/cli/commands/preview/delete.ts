import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { deleteAllSnapshots, deleteSnapshot } from 'cli/lib/api';
import { deleteAllSnapshotsForUserFromConfig } from 'cli/lib/cli-config/snapshots';
import { emitCliEvent } from 'cli/lib/daemon-client';
import {
	deleteSnapshotFromConfig,
	getSnapshotsFromConfig,
	isSnapshotExpired,
} from 'cli/lib/snapshots';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { normalizeHostname } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export enum Mode {
	DELETE_SINGLE_SNAPSHOT,
	DELETE_ALL_SNAPSHOT,
}

export async function runCommand(
	mode: Mode.DELETE_SINGLE_SNAPSHOT,
	host: string
): Promise< void >;
export async function runCommand(
	mode: Mode.DELETE_ALL_SNAPSHOT,
	host: undefined
): Promise< void >;
export async function runCommand( mode: Mode, host: string | undefined ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		const snapshots = await getSnapshotsFromConfig( token.id );

		if ( mode === Mode.DELETE_SINGLE_SNAPSHOT ) {
			logger.reportStart( LoggerAction.VALIDATE, __( 'Validating…' ) );

			const snapshotToDelete = snapshots.find( ( s ) => s.url === host );
			if ( ! snapshotToDelete ) {
				throw new LoggerError(
					__(
						'Preview site not found. ' +
							'Use the `studio preview list` command to see available preview sites.'
					)
				);
			}

			logger.reportStart( LoggerAction.DELETE, __( 'Deleting…' ) );
			if ( ! isSnapshotExpired( snapshotToDelete ) ) {
				await deleteSnapshot( snapshotToDelete.atomicSiteId, token.accessToken );
			}
			await deleteSnapshotFromConfig( snapshotToDelete.url );
			await emitCliEvent( {
				event: SNAPSHOT_EVENTS.DELETED,
				data: { snapshotUrl: snapshotToDelete.url },
			} );
			await recordPreviewDeleteEvent( TRACKS_EVENTS.PREVIEW_SITE_DELETE );
			logger.reportSuccess( __( 'Deletion successful' ) );
		} else {
			logger.reportStart( LoggerAction.DELETE_ALL, __( 'Deleting all preview sites…' ) );

			const count = snapshots.length;
			await deleteAllSnapshots( token.accessToken );
			await deleteAllSnapshotsForUserFromConfig( token.id );
			await emitCliEvent( { event: SNAPSHOT_EVENTS.DELETED_ALL } );
			await recordPreviewDeleteEvent( TRACKS_EVENTS.PREVIEW_SITE_DELETE_ALL, { count } );

			logger.reportSuccess( __( 'Deletion successful' ) );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to delete preview site' ), error );
			logger.reportError( loggerError );
		}
	}
}

async function recordPreviewDeleteEvent(
	event: typeof TRACKS_EVENTS.PREVIEW_SITE_DELETE | typeof TRACKS_EVENTS.PREVIEW_SITE_DELETE_ALL,
	props: { count?: number } = {}
): Promise< void > {
	try {
		await recordTracksEvent( event, { ...props, ...getTracksOrigin() } );
	} catch {
		// Best-effort telemetry — never block or fail preview deletion.
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete [host] [--all]',
		describe: __( 'Delete preview site(s)' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'all', {
					type: 'boolean',
					describe: __( 'Delete all preview sites for your user' ),
					default: false,
				} )
				.positional( 'host', {
					type: 'string',
					description: __( 'Hostname of the preview site to delete' ),
				} )
				.check( ( argv ) => {
					if ( ! argv.all && ! argv.host ) {
						throw new Error( __( 'Hostname is required unless --all is passed.' ) );
					}
					return true;
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			if ( argv.all ) {
				await runCommand( Mode.DELETE_ALL_SNAPSHOT, undefined );
			} else if ( argv.host ) {
				const normalizedHost = normalizeHostname( argv.host );
				await runCommand( Mode.DELETE_SINGLE_SNAPSHOT, normalizedHost );
			}
		},
	} );
};
