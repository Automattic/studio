import { deleteSnapshot } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/auth';
import { deleteSnapshotFromAppdata, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { Logger, LoggerError } from 'cli/logger';
import { RegisterCommand, OutputFormat } from 'cli/types';

export enum LoggerAction {
	VALIDATE = 'validate',
	DELETE = 'delete',
}

async function runCommand( host: string, outputFormat?: OutputFormat ): Promise< void > {
	const logger = new Logger< LoggerAction >( outputFormat );

	try {
		logger.reportStart( LoggerAction.VALIDATE, 'Validating...' );
		const token = await getAuthToken();
		const snapshots = await getSnapshotsFromAppdata( token.id );
		const snapshotToDelete = snapshots.find( ( s ) => s.url === host );
		if ( ! snapshotToDelete ) {
			throw new LoggerError( 'Preview site not found' );
		}
		logger.reportSuccess( 'Validation successful' );

		logger.reportStart( LoggerAction.DELETE, 'Deleting...' );
		await deleteSnapshot( snapshotToDelete.atomicSiteId, token.accessToken );
		await deleteSnapshotFromAppdata( snapshotToDelete.url );
		logger.reportSuccess( 'Deletion successful' );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( 'Failed to delete preview site' );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'delete <host>' )
		.description( 'Delete a preview site' )
		.action( async ( host: string ) => {
			const options = program.opts();
			const normalizedHost = host.replace( /^https?:\/\//, '' );
			await runCommand( normalizedHost, options.outputFormat );
		} );
};
