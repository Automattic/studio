import { __ } from '@wordpress/i18n';
import { deleteSnapshot } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { deleteSnapshotFromAppdata, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { normalizeHostname } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { RegisterCommand, OutputFormat } from 'cli/types';

export enum LoggerAction {
	VALIDATE = 'validate',
	DELETE = 'delete',
}

async function runCommand( host: string, outputFormat?: OutputFormat ): Promise< void > {
	const logger = new Logger< LoggerAction >( outputFormat );

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating...' ) );
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
		logger.reportSuccess( __( 'Validation successful' ) );

		logger.reportStart( LoggerAction.DELETE, __( 'Deleting...' ) );
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

export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'delete <host>' )
		.description( __( 'Delete a preview site' ) )
		.action( async ( host: string ) => {
			const options = program.opts();
			const normalizedHost = normalizeHostname( host );
			await runCommand( normalizedHost, options.outputFormat );
		} );
};
