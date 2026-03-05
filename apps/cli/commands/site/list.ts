import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import Table from 'cli-table3';
import { getSiteUrl, readAppdata, type SiteData } from 'cli/lib/appdata';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isSiteRunning } from 'cli/lib/site-utils';
import { getColumnWidths, getPrettyPath } from 'cli/lib/utils';
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
		const isReady = await isSiteRunning( site );
		const status = isReady ? `🟢 ${ __( 'Online' ) }` : `🔴 ${ __( 'Offline' ) }`;
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

export async function runCommand( format: 'table' | 'json' ): Promise< void > {
	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading sites…' ) );
		const appdata = await readAppdata();

		if ( appdata.sites.length === 0 ) {
			logger.reportSuccess( __( 'No sites found' ) );
			return;
		}

		const sitesMessage = sprintf(
			_n( 'Found %d site', 'Found %d sites', appdata.sites.length ),
			appdata.sites.length
		);
		logger.reportSuccess( sitesMessage );

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Connected to process daemon' ) );

		const sitesData = await getSiteListData( appdata.sites );
		displaySiteList( sitesData, format );
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List sites' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'format', {
					type: 'string',
					choices: [ 'table', 'json' ] as const,
					default: 'table' as const,
					// translators: Refers to the output format of the `studio site list` CLI command ("table" or "json")
					description: __( 'Output format' ),
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.format );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to list sites' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
