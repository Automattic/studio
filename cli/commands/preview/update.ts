import os from 'node:os';
import path from 'node:path';
import { __, _n, sprintf } from '@wordpress/i18n';
import { DEMO_SITE_EXPIRATION_DAYS } from 'common/constants';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { addDays } from 'date-fns';
import { Argv } from 'yargs';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { getAuthToken } from 'cli/lib/appdata';
import { cleanup, createArchive } from 'cli/lib/archive';
import { getSnapshotsFromAppdata, updateSnapshotDateInAppdata } from 'cli/lib/snapshots';
import { normalizeHostname } from 'cli/lib/utils';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions, OutputFormat } from 'cli/types';

export async function runCommand(
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

		const now = new Date();
		const endDate = addDays( snapshotToUpdate.date, DEMO_SITE_EXPIRATION_DAYS );
		if ( endDate < now ) {
			throw new LoggerError( __( 'Cannot update an expired preview site.' ) );
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

export const registerCommand = ( yargs: Argv< GlobalOptions > ) => {
	return yargs.command( {
		command: 'update <host>',
		describe: __( 'Update preview site' ),
		builder: ( yargs ) => {
			return yargs.positional( 'host', {
				type: 'string',
				description: __( 'Hostname of the preview site to update' ),
				demandOption: true,
			} );
		},
		handler: async ( argv ) => {
			const normalizedHost = normalizeHostname( argv.host );
			await runCommand( argv.path, normalizedHost, argv.outputFormat );
		},
	} );
};
