import fs from 'fs';
import { __ } from '@wordpress/i18n';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { createArchive } from 'cli/lib/archive';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( siteFolder: string ): Promise< void > {
	const archivePath = 'test.zip';
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Zipping…' ) );
		await createArchive( siteFolder, archivePath );

		logger.reportKeyValuePair( 'archive', archivePath );
		logger.reportSuccess( __( 'Zipped' ) );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to create zip file' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		if ( fs.existsSync( archivePath ) ) {
			console.log( 'zip created to ', archivePath );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'test',
		describe: __( 'Test a zip file' ),
		handler: async ( argv ) => {
			await runCommand( argv.path );
		},
	} );
};
