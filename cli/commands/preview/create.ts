import os from 'os';
import path from 'path';
import { Logger } from 'cli/logger';
import { RegisterCommand, OutputFormat } from 'cli/types';
import { uploadArchive, waitForSiteReady } from './lib/api';
import { createArchive, cleanup } from './lib/archive';
import { getAuthToken } from './lib/auth';
import { validateSiteFolder } from './lib/validation';

enum LoggerAction {
	VALIDATE = 'validate',
	ARCHIVE = 'archive',
	UPLOAD = 'upload',
	READY = 'ready',
}

async function runCommand( siteFolder: string, outputFormat?: OutputFormat ): Promise< void > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const logger = new Logger< LoggerAction >( outputFormat );

	logger.reportStart( LoggerAction.VALIDATE, 'Validating...' );
	const isValidSiteFolder = validateSiteFolder( siteFolder );
	if ( isValidSiteFolder instanceof Error ) {
		logger.reportError( LoggerAction.VALIDATE, isValidSiteFolder.message );
		return;
	}
	const token = await getAuthToken();
	if ( ! token ) {
		logger.reportError(
			LoggerAction.VALIDATE,
			'Authentication required. Please run the Studio app and authenticate first.'
		);
		return;
	}
	logger.reportSuccess( LoggerAction.VALIDATE, 'Validation successful' );

	logger.reportStart( LoggerAction.ARCHIVE, 'Creating archive...' );
	const archive = await createArchive( siteFolder, archivePath );
	if ( archive instanceof Error ) {
		logger.reportError( LoggerAction.ARCHIVE, archive.message );
		return;
	}
	logger.reportSuccess( LoggerAction.ARCHIVE, 'Archive created' );

	logger.reportStart( LoggerAction.UPLOAD, 'Uploading archive...' );
	const uploadResponse = await uploadArchive( archivePath, token );
	if ( uploadResponse instanceof Error ) {
		logger.reportError( LoggerAction.UPLOAD, uploadResponse.message );
		return;
	}
	if ( ! uploadResponse.site_url || ! uploadResponse.site_id ) {
		logger.reportError( LoggerAction.UPLOAD, 'Failed to upload archive' );
		return;
	}
	logger.reportSuccess( LoggerAction.UPLOAD, 'Archive uploaded' );

	logger.reportStart( LoggerAction.READY, 'Creating preview site...' );
	const isSiteReady = await waitForSiteReady( uploadResponse.site_id, token );
	if ( ! isSiteReady ) {
		logger.reportError( LoggerAction.READY, 'Failed to create preview site' );
		return;
	}
	cleanup( archivePath );
	logger.reportSuccess(
		LoggerAction.READY,
		`Preview site available at: https://${ uploadResponse.site_url }`
	);
}

export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'go [folder]' )
		.description(
			'Create a preview site from the specified folder (defaults to current directory)'
		)
		.action( async ( siteFolder: string = process.cwd(), options: { outputFormat?: 'json' } ) => {
			await runCommand( siteFolder, options.outputFormat );
		} );
};
