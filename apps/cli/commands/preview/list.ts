import { readAuthToken } from '@studio/common/lib/shared-config';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { Snapshot } from '@studio/common/types/snapshot';
import { __, _n, sprintf } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { format } from 'date-fns';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	formatDurationUntilExpiry,
	getSnapshotsFromConfig,
	isSnapshotExpired,
	pruneExpiredOrphanedSnapshots,
} from 'cli/lib/snapshots';
import { getColumnWidths } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

function buildSnapshotTable( snapshots: Snapshot[] ): string {
	const colWidths = getColumnWidths( [ 0.4, 0.25, 0.175, 0.175 ] );
	const table = new CliTable3( {
		head: [ __( 'URL' ), __( 'Site Name' ), __( 'Updated' ), __( 'Expires' ) ],
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

	return table.toString();
}

export async function runCommand(
	siteFolder: string,
	outputFormat: 'table' | 'json',
	all = false
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
		if ( ! all ) {
			await getSiteByFolder( siteFolder );
		}
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		logger.reportStart( LoggerAction.LOAD, __( 'Loading preview sites…' ) );

		// Expired orphans are almost certainly already deleted server-side — clean them up.
		await pruneExpiredOrphanedSnapshots( token.id, isSnapshotExpired );

		const snapshots = await getSnapshotsFromConfig( token.id, all ? undefined : siteFolder );

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

		if ( all ) {
			const config = await readCliConfig();
			const siteById = new Map( config.sites.map( ( site ) => [ site.id, site ] ) );
			const unknownSiteLabel = __( 'Unknown site' );

			// Group by localSiteId (names aren't unique), then collapse every group whose
			// site is missing from the config into a single "Unknown site" bucket.
			const snapshotsByLocalSiteId = new Map< string, Snapshot[] >();
			for ( const snapshot of snapshots ) {
				const key = siteById.has( snapshot.localSiteId ) ? snapshot.localSiteId : unknownSiteLabel;
				const bucket = snapshotsByLocalSiteId.get( key ) ?? [];
				bucket.push( snapshot );
				snapshotsByLocalSiteId.set( key, bucket );
			}

			const sortedGroups = [ ...snapshotsByLocalSiteId.entries() ]
				.map( ( [ key, siteSnapshots ] ) => {
					const site = siteById.get( key );
					// Include the path alongside the name since Studio doesn't enforce
					// unique site names and all CLI operations key off the path.
					const displayName = site ? `${ site.name } — ${ site.path }` : unknownSiteLabel;
					return { displayName, siteSnapshots };
				} )
				.sort( ( a, b ) => {
					if ( b.siteSnapshots.length !== a.siteSnapshots.length ) {
						return b.siteSnapshots.length - a.siteSnapshots.length;
					}
					return a.displayName.localeCompare( b.displayName );
				} );

			const sections = sortedGroups.map( ( { displayName, siteSnapshots } ) => {
				const header = sprintf(
					/* translators: 1: Local site name (may include path for disambiguation). 2: Number of preview sites for that local site. */
					_n( '%1$s (%2$d preview site)', '%1$s (%2$d preview sites)', siteSnapshots.length ),
					displayName,
					siteSnapshots.length
				);
				return `${ header }\n${ buildSnapshotTable( siteSnapshots ) }`;
			} );

			console.log( sections.join( '\n\n' ) );
			return;
		}

		console.log( buildSnapshotTable( snapshots ) );
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
			return yargs
				.option( 'format', {
					type: 'string',
					choices: [ 'table', 'json' ] as const,
					default: 'table' as const,
					description: __( 'Output format' ),
				} )
				.option( 'all', {
					type: 'boolean',
					default: false,
					description: __( 'List preview sites for all local sites, grouped by site' ),
				} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.format, argv.all );
		},
	} );
};
