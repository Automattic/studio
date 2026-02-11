import { __ } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { deleteSnapshot } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { deleteSnapshotFromAppdata, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { normalizeHostname } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( host: string ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating…' ) );
		const token = await getAuthToken();
		const snapshots = await getSnapshotsFromAppdata( token.id );
		const snapshotToDelete = snapshots.find( ( s ) => s.url === host );
		if ( ! snapshotToDelete ) {
			throw new LoggerError(
				__(
					'Preview site not found. ' +
						'Use the `studio preview list` command to see available preview sites.'
				)
			);
		}
		logger.reportSuccess( __( 'Validation successful' ), true );

		logger.reportStart( LoggerAction.DELETE, __( 'Deleting…' ) );
		await deleteSnapshot( snapshotToDelete.atomicSiteId, token.accessToken );
		await deleteSnapshotFromAppdata( snapshotToDelete.url );
		logger.reportSuccess( __( 'Deletion successful' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to delete preview site' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete <host>',
		describe: __( 'Delete a preview site' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'host', {
					type: 'string',
					description: __( 'Hostname of the preview site to delete' ),
					demandOption: true,
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			const normalizedHost = normalizeHostname( argv.host );
			await runCommand( normalizedHost );
		},
	} );
};
