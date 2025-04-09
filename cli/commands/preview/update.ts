import os from 'node:os';
import path from 'node:path';
import { __, _n } from '@wordpress/i18n';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { createArchive } from 'cli/lib/archive';
import { getAuthToken } from 'cli/lib/auth';
import { addPreviewSiteToAppdata, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { RegisterCommand, OutputFormat } from 'cli/types';

enum LoggerAction {
	VALIDATE = 'validate',
	ARCHIVE = 'archive',
	UPLOAD = 'upload',
	READY = 'ready',
	APPDATA = 'appdata',
}

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

		logger.reportStart( LoggerAction.ARCHIVE, 'Creating archive...' );
		await createArchive( siteFolder, archivePath );
		logger.reportSuccess( 'Archive created' );

		logger.reportStart( LoggerAction.UPLOAD, 'Uploading archive...' );
		const uploadResponse = await uploadArchive(
			archivePath,
			token.accessToken,
			snapshotToUpdate.atomicSiteId
		);
		logger.reportSuccess( 'Archive uploaded' );

		logger.reportStart( LoggerAction.READY, 'Updating preview site...' );
		await waitForSiteReady( uploadResponse.site_id, token.accessToken );
		logger.reportSuccess( `Preview site available at: https://${ uploadResponse.site_url }` );

		logger.reportStart( LoggerAction.APPDATA, 'Saving preview site to Studio...' );
		await addPreviewSiteToAppdata( uploadResponse.site_url, uploadResponse.site_id, siteFolder );
		logger.reportSuccess( 'Preview site saved to Studio' );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to update preview site' ) );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'update [folder]' )
		.description(
			__( 'Update preview site for the specified folder (defaults to current directory)' )
		)
		.requiredOption( '-h, --host <host>', __( 'Host of the preview site to update' ) )
		.action( async ( siteFolder: string = process.cwd(), options ) => {
			const parentOptions = program.opts();
			await runCommand( siteFolder, options.host, parentOptions.outputFormat );
		} );
};
