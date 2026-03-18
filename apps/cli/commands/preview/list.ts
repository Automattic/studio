import { readAuthToken } from '@studio/common/lib/shared-config';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { format } from 'date-fns';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	formatDurationUntilExpiry,
	getSnapshotsFromConfig,
	isSnapshotExpired,
} from 'cli/lib/snapshots';
import { getColumnWidths } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(
	siteFolder: string,
	outputFormat: 'table' | 'json'
): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		if ( outputFormat === 'json' ) {
			const config = await readCliConfig();
			const json = JSON.stringify( config.snapshots );
			console.log( json );
			logger.reportKeyValuePair( 'snapshots', json );
			return;
		}

		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating…' ) );
		await getSiteByFolder( siteFolder );
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}
		logger.reportSuccess( __( 'Validation successful' ), true );

		logger.reportStart( LoggerAction.LOAD, __( 'Loading preview sites…' ) );
		const snapshots = await getSnapshotsFromConfig( token.id, siteFolder );

		if ( snapshots.length === 0 ) {
			logger.reportSuccess( __( 'No preview sites found' ) );
			return;
		}

		const expiredSnapshots = snapshots.filter( isSnapshotExpired );
		const snapshotsMessage = sprintf(
			_n( 'Found %d preview site', 'Found %d preview sites', snapshots.length ),
			snapshots.length
		);

		if ( expiredSnapshots.length > 0 ) {
			const expiredSnapshotsMessage = sprintf(
				/* translators: This string is appended to "Found %d preview sites" if there are expired preview sites */
				_n( '(%d expired)', '(%d expired)', expiredSnapshots.length ),
				expiredSnapshots.length
			);

			logger.reportSuccess( `${ snapshotsMessage } ${ expiredSnapshotsMessage }` );
		} else {
			logger.reportSuccess( snapshotsMessage );
		}

		if ( outputFormat === 'table' ) {
			const colWidths = getColumnWidths( [ 0.4, 0.25, 0.175, 0.175 ] );
			const table = new CliTable3( {
				head: [ __( 'URL' ), __( 'Site Name' ), __( 'Updated' ), __( 'Expires in' ) ],
				wordWrap: true,
				wrapOnWordBoundary: false,
				colWidths,
				style: {
					head: [],
					border: [],
				},
			} );

			for ( const snapshot of snapshots ) {
				const durationUntilExpiry = formatDurationUntilExpiry( snapshot.date );
				const url = `https://${ snapshot.url }`;

				table.push( [
					{ href: url, content: url },
					snapshot.name,
					format( snapshot.date, 'yyyy-MM-dd HH:mm' ),
					durationUntilExpiry,
				] );
			}

			console.log( table.toString() );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to load preview sites' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List preview sites' ),
		builder: ( yargs ) => {
			return yargs.option( 'format', {
				type: 'string',
				choices: [ 'table', 'json' ],
				default: 'table',
				description: __( 'Output format' ),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.format as 'table' | 'json' );
		},
	} );
};
