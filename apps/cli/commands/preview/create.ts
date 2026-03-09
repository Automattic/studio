import os from 'os';
import path from 'path';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config';
import { saveSnapshotToAppdata } from 'cli/lib/snapshots';
import { validateSiteSize } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( siteFolder: string ): Promise< void > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating…' ) );
		await getSiteByFolder( siteFolder );
		await validateSiteSize( siteFolder );
		const token = await getAuthToken();
		logger.reportSuccess( __( 'Validation successful' ), true );

		logger.reportStart( LoggerAction.ARCHIVE, __( 'Creating archive…' ) );
		await archiveSiteContent( siteFolder, archivePath );
		logger.reportSuccess( __( 'Archive created' ) );

		logger.reportStart( LoggerAction.UPLOAD, __( 'Uploading archive…' ) );
		const wordpressVersion = getWordPressVersion( siteFolder );
		const uploadResponse = await uploadArchive( archivePath, token.accessToken, wordpressVersion );
		logger.reportSuccess( __( 'Archive uploaded' ) );

		logger.reportStart( LoggerAction.READY, __( 'Creating preview site…' ) );
		await waitForSiteReady( uploadResponse.site_id, token.accessToken );
		logger.reportSuccess(
			sprintf( __( 'Preview site available at: %s' ), `https://${ uploadResponse.site_url }` )
		);

		logger.reportStart( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ) );
		const snapshot = await saveSnapshotToAppdata(
			siteFolder,
			uploadResponse.site_id,
			uploadResponse.site_url
		);
		logger.reportSuccess( __( 'Preview site saved to Studio' ) );

		logger.reportKeyValuePair( 'name', snapshot.name ?? '' );
		logger.reportKeyValuePair( 'url', snapshot.url );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to create preview site' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		void cleanup( archivePath );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a preview site' ),
		handler: async ( argv ) => {
			await runCommand( argv.path );
		},
	} );
};
