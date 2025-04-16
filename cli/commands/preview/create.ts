import os from 'os';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { createArchive, cleanup } from 'cli/lib/archive';
import { upsertPreviewSiteInAppdata } from 'cli/lib/snapshots';
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
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating...' ) );
		validateSiteFolder( siteFolder );
		const token = await getAuthToken();
		logger.reportSuccess( __( 'Validation successful' ) );

		logger.reportStart( LoggerAction.ARCHIVE, __( 'Creating archive...' ) );
		await createArchive( siteFolder, archivePath );
		logger.reportSuccess( __( 'Archive created' ) );

		logger.reportStart( LoggerAction.UPLOAD, __( 'Uploading archive...' ) );
		const uploadResponse = await uploadArchive( archivePath, token.accessToken );
		logger.reportSuccess( __( 'Archive uploaded' ) );

		logger.reportStart( LoggerAction.READY, __( 'Creating preview site...' ) );
		await waitForSiteReady( uploadResponse.site_id, token.accessToken );
		logger.reportSuccess(
			sprintf( __( 'Preview site available at: %s' ), `https://${ uploadResponse.site_url }` )
		);

		logger.reportStart( LoggerAction.APPDATA, __( 'Saving preview site to Studio...' ) );
		await upsertPreviewSiteInAppdata( siteFolder, uploadResponse.site_id, uploadResponse.site_url );
		logger.reportSuccess( __( 'Preview site saved to Studio' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to create preview site' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		cleanup( archivePath );
	}
}

export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'go [folder]' )
		.description(
			__( 'Create a preview site from the specified folder (defaults to current directory)' )
		)
		.action( async ( siteFolder: string = process.cwd() ) => {
			const options = program.opts();
			await runCommand( siteFolder, options.outputFormat );
		} );
};
