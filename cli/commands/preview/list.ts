import { __, _n, sprintf } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getAuthToken } from 'cli/lib/appdata';
import { getSnapshotCliTable, getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { OutputFormat, StudioArgv } from 'cli/types';

export async function runCommand(
	siteFolder: string,
	outputFormat?: OutputFormat
): Promise< void > {
	const logger = new Logger< LoggerAction >( outputFormat );

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating...' ) );
		validateSiteFolder( siteFolder );
		const token = await getAuthToken();
		logger.reportSuccess( __( 'Validation successful' ) );

		logger.reportStart( LoggerAction.LOAD, __( 'Loading previews...' ) );
		const snapshots = await getSnapshotsFromAppdata( token.id, siteFolder );

		if ( snapshots.length === 0 ) {
			logger.reportSuccess( __( 'No previews found' ) );
			return;
		}

		logger.reportSuccess(
			sprintf( _n( 'Found %d preview', 'Found %d previews', snapshots.length ), snapshots.length )
		);

		const table = getSnapshotCliTable( snapshots );
		console.log( table.toString() );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to load previews' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list [folder]',
		describe: __( 'List preview sites for the specified folder (defaults to current directory)' ),
		builder: ( yargs ) => {
			return yargs.positional( 'folder', {
				type: 'string',
				default: process.cwd(),
				description: __( 'The folder to list previews for' ),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.folder, argv.outputFormat );
		},
	} );
};
