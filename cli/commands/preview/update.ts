import os from 'node:os';
import path from 'node:path';
import { __, _n, sprintf } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { cleanup, createArchive } from 'cli/lib/archive';
import { getSnapshotsFromAppdata, updateSnapshotDateInAppdata } from 'cli/lib/snapshots';
import { normalizeHostname } from 'cli/lib/utils';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { RegisterCommand, OutputFormat } from 'cli/types';

async function runCommand(
	siteFolder: string,
	host: string,
	outputFormat?: OutputFormat
): Promise< void > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const logger = new Logger< LoggerAction >( outputFormat );

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating...' ) );
		validateSiteFolder( siteFolder );
		const token = await getAuthToken();
		const snapshots = await getSnapshotsFromAppdata( token.id );
		const snapshotToUpdate = snapshots.find( ( s ) => s.url === host );
		if ( ! snapshotToUpdate ) {
			throw new LoggerError( 'Preview site not found' );
		}
		logger.reportSuccess( __( 'Validation successful' ) );

		logger.reportStart( LoggerAction.ARCHIVE, __( 'Creating archive...' ) );
		await createArchive( siteFolder, archivePath );
		logger.reportSuccess( __( 'Archive created' ) );

		logger.reportStart( LoggerAction.UPLOAD, __( 'Uploading archive...' ) );
		const uploadResponse = await uploadArchive(
			archivePath,
			token.accessToken,
			snapshotToUpdate.atomicSiteId
		);
		logger.reportSuccess( __( 'Archive uploaded' ) );

		logger.reportStart( LoggerAction.READY, __( 'Updating preview site...' ) );
		await waitForSiteReady( uploadResponse.site_id, token.accessToken );
		logger.reportSuccess(
			sprintf( __( 'Preview site available at: %s' ), `https://${ uploadResponse.site_url }` )
		);

		logger.reportStart( LoggerAction.APPDATA, __( 'Saving preview site to Studio...' ) );
		const snapshot = await updateSnapshotDateInAppdata( uploadResponse.site_id );
		logger.reportSuccess( __( 'Preview site saved to Studio' ) );

		logger.reportKeyValuePair( 'name', snapshot.name );
		logger.reportKeyValuePair( 'url', snapshot.url );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to update preview site' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		void cleanup( archivePath );
	}
}

export const registerCommand: RegisterCommand = ( parentCommand, rootCommand = parentCommand ) => {
	parentCommand
		.command( 'update [folder]' )
		.description(
			__( 'Update preview site for the specified folder (defaults to current directory)' )
		)
		.requiredOption( '-h, --host <host>', __( 'Host of the preview site to update' ) )
		.action( async ( siteFolder: string = process.cwd(), options ) => {
			const outputFormat = rootCommand.opts().outputFormat;
			const normalizedHost = normalizeHostname( options.host );
			await runCommand( siteFolder, normalizedHost, outputFormat );
		} );
};
