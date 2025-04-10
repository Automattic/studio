import os from 'os';
import path from 'path';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { createArchive, cleanup } from 'cli/lib/archive';
import { getAuthToken } from 'cli/lib/auth';
import { addPreviewSiteToAppdata } from 'cli/lib/snapshots';
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

async function runCommand( siteFolder: string, outputFormat?: OutputFormat ): Promise< void > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const logger = new Logger< LoggerAction >( outputFormat );

	try {
		logger.reportStart( LoggerAction.VALIDATE, 'Validating...' );
		validateSiteFolder( siteFolder );
		const token = await getAuthToken();
		logger.reportSuccess( 'Validation successful' );

		logger.reportStart( LoggerAction.ARCHIVE, 'Creating archive...' );
		await createArchive( siteFolder, archivePath );
		logger.reportSuccess( 'Archive created' );

		logger.reportStart( LoggerAction.UPLOAD, 'Uploading archive...' );
		const uploadResponse = await uploadArchive( archivePath, token.accessToken );
		logger.reportSuccess( 'Archive uploaded' );

		logger.reportStart( LoggerAction.READY, 'Creating preview site...' );
		await waitForSiteReady( uploadResponse.site_id, token.accessToken );
		logger.reportSuccess( `Preview site available at: https://${ uploadResponse.site_url }` );

		logger.reportStart( LoggerAction.APPDATA, 'Saving preview site to Studio...' );
		await addPreviewSiteToAppdata( uploadResponse.site_url, uploadResponse.site_id, siteFolder );
		logger.reportSuccess( 'Preview site saved to Studio' );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const message = error instanceof Error ? error.message : String( error );
			logger.reportError( new LoggerError( message ) );
		}
	} finally {
		cleanup( archivePath );
	}
}

export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'go [folder]' )
		.description(
			'Create a preview site from the specified folder (defaults to current directory)'
		)
		.action( async ( siteFolder: string = process.cwd() ) => {
			const options = program.opts();
			await runCommand( siteFolder, options.outputFormat );
		} );
};
