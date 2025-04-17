import { __, _n, sprintf } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getAuthToken } from 'cli/lib/appdata';
import { getSnapshotCliTable } from 'cli/lib/output';
import { getSnapshotsFromAppdata } from 'cli/lib/snapshots';
import { validateSiteFolder } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { RegisterCommand, OutputFormat } from 'cli/types';

async function runCommand( siteFolder: string, outputFormat?: OutputFormat ): Promise< void > {
	const logger = new Logger< LoggerAction >( outputFormat );

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating...' ) );
		validateSiteFolder( siteFolder );
		const token = await getAuthToken();
		logger.reportSuccess( __( 'Validation successful' ) );

		logger.reportStart( LoggerAction.LOAD, __( 'Loading snapshots...' ) );
		const snapshots = await getSnapshotsFromAppdata( token.id, siteFolder );

		if ( snapshots.length === 0 ) {
			logger.reportSuccess( __( 'No snapshots found' ) );
			return;
		}

		logger.reportSuccess(
			sprintf( _n( 'Found %d snapshot', 'Found %d snapshots', snapshots.length ), snapshots.length )
		);

		const table = getSnapshotCliTable( snapshots );
		console.log( table.toString() );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to load snapshots' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand: RegisterCommand = ( parentCommand, rootCommand = parentCommand ) => {
	parentCommand
		.command( 'list [folder]' )
		.description(
			__( 'List preview sites for the specified folder (defaults to current directory)' )
		)
		.action( async ( siteFolder: string = process.cwd() ) => {
			const outputFormat = rootCommand.opts().outputFormat;
			await runCommand( siteFolder, outputFormat );
		} );
};
