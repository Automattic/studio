import { __, _n, sprintf } from '@wordpress/i18n';
import Table from 'cli-table3';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getSiteUrl, readAppdata, type SiteData } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { getColumnWidths, getPrettyPath } from 'cli/lib/utils';
import { isServerRunning, subscribeSiteEvents } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface SiteListEntry {
	id: string;
	status: string;
	name: string;
	path: string;
	url: string;
}

async function getSiteListData( sites: SiteData[] ): Promise< SiteListEntry[] > {
	const result: SiteListEntry[] = [];

	for await ( const site of sites ) {
		const isOnline = await isServerRunning( site.id );
		const status = isOnline ? `🟢 ${ __( 'Online' ) }` : `🔴 ${ __( 'Offline' ) }`;
		const url = getSiteUrl( site );

		result.push( {
			id: site.id,
			status,
			name: site.name,
			path: getPrettyPath( site.path ),
			url,
		} );
	}

	return result;
}

function displaySiteList( sitesData: SiteListEntry[], format: 'table' | 'json' ): void {
	if ( format === 'table' ) {
		const colWidths = getColumnWidths( [ 0.1, 0.2, 0.3, 0.4 ] );

		const table = new Table( {
			head: [ __( 'Status' ), __( 'Name' ), __( 'Path' ), __( 'URL' ) ],
			wordWrap: true,
			wrapOnWordBoundary: false,
			colWidths,
			style: {
				head: [],
				border: [],
			},
		} );

		table.push(
			...sitesData.map( ( site ) => [
				site.status,
				site.name,
				site.path,
				{ href: new URL( site.url ).toString(), content: site.url },
			] )
		);

		console.log( table.toString() );
	} else {
		console.log( JSON.stringify( sitesData, null, 2 ) );
	}
}

const logger = new Logger< LoggerAction >();

export async function runCommand( format: 'table' | 'json', watch: boolean ): Promise< void > {
	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading sites…' ) );
		const appdata = await readAppdata();

		if ( appdata.sites.length === 0 ) {
			logger.reportSuccess( __( 'No sites found' ) );
			if ( ! watch ) {
				return;
			}
		} else {
			const sitesMessage = sprintf(
				_n( 'Found %d site', 'Found %d sites', appdata.sites.length ),
				appdata.sites.length
			);
			logger.reportSuccess( sitesMessage );
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon...' ) );
		await connect();
		logger.reportSuccess( __( 'Connected to process daemon' ) );

		const sitesData = await getSiteListData( appdata.sites );
		displaySiteList( sitesData, format );

		if ( watch ) {
			await subscribeSiteEvents(
				async () => {
					console.clear();
					const freshAppdata = await readAppdata();
					const freshSitesData = await getSiteListData( freshAppdata.sites );
					displaySiteList( freshSitesData, format );
				},
				{ debounceMs: 500 }
			);
		}
	} finally {
		if ( ! watch ) {
			disconnect();
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List local sites' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'format', {
					type: 'string',
					choices: [ 'table', 'json' ],
					default: 'table',
					description: __( 'Output format' ),
				} )
				.option( 'watch', {
					type: 'boolean',
					default: false,
					description: __( 'Watch for site status changes and update the list in real-time' ),
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.format as 'table' | 'json', argv.watch as boolean );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to load site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
