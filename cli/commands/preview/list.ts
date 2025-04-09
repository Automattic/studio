import { __, _n, sprintf } from '@wordpress/i18n';
import { getSiteIdFromFolder, readAppdata, Snapshot } from 'cli/commands/preview/lib/appdata';
import { getAuthToken } from 'cli/commands/preview/lib/auth';
import { getSnapshotCliTable } from 'cli/commands/preview/lib/output';
import { validateSiteFolder } from 'cli/commands/preview/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { RegisterCommand, OutputFormat } from 'cli/types';

export enum LoggerAction {
	VALIDATE = 'validate',
	LOAD = 'load',
}

async function getAllSnapshots( userId: number, siteFolder: string ): Promise< Snapshot[] > {
	const siteId = await getSiteIdFromFolder( siteFolder );
	const userData = await readAppdata();
	const snapshots = userData.snapshots ?? [];

	return snapshots
		.filter( ( snapshot ) => snapshot.userId === userId )
		.filter( ( snapshot ) => snapshot.localSiteId === siteId );
}

async function runCommand( siteFolder: string, outputFormat?: OutputFormat ): Promise< void > {
	const logger = new Logger< LoggerAction >( outputFormat );

	try {
		logger.reportStart( LoggerAction.VALIDATE, 'Validating...' );
		validateSiteFolder( siteFolder );
		const token = await getAuthToken();
		logger.reportSuccess( 'Validation successful' );

		logger.reportStart( LoggerAction.LOAD, __( 'Loading snapshots...' ) );
		const snapshots = await getAllSnapshots( token.id, siteFolder );

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
			const loggerError = new LoggerError( 'Failed to load snapshots' );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'list [folder]' )
		.description( 'List preview sites' )
		.action( async ( siteFolder: string = process.cwd() ) => {
			const options = program.opts();
			await runCommand( siteFolder, options.outputFormat );
		} );
};
