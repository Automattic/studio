import { type SiteDetails } from '@studio/common/lib/cli-events';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getLiveSiteOperations } from 'cli/lib/site-lock';
import { isSiteRunning } from 'cli/lib/site-utils';
import { getColumnWidths, getPrettyPath } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface SiteListTableEntry {
	id: string;
	status: string;
	name: string;
	path: string;
	url: string;
}

interface SiteListJsonEntry extends SiteDetails {
	running: boolean;
}

async function getSiteListData( sites: SiteData[] ): Promise< {
	tableEntries: SiteListTableEntry[];
	jsonEntries: SiteListJsonEntry[];
} > {
	const tableEntries: SiteListTableEntry[] = [];
	const jsonEntries: SiteListJsonEntry[] = [];

	for await ( const site of sites ) {
		const running = await isSiteRunning( site );
		const url = getSiteUrl( site );
		const status = running ? `🟢 ${ __( 'Online' ) }` : `🔴 ${ __( 'Offline' ) }`;

		tableEntries.push( {
			id: site.id,
			status,
			name: site.name,
			path: getPrettyPath( site.path ),
			url,
		} );

		// Must override what `...site` carries, not just add to it: the stored
		// array can hold leases from crashed processes, and reporting those
		// would leave clients disabling the site forever. `undefined` drops the
		// key on serialization, so an idle site reports no `operations` at all.
		const liveOperations = getLiveSiteOperations( site );

		jsonEntries.push( {
			...site,
			operations: liveOperations.length > 0 ? liveOperations : undefined,
			url,
			running,
		} );
	}

	return { tableEntries, jsonEntries };
}

function displaySiteList(
	data: { tableEntries: SiteListTableEntry[]; jsonEntries: SiteListJsonEntry[] },
	format: 'table' | 'json'
): void {
	if ( format === 'table' ) {
		const colWidths = getColumnWidths( [ 0.1, 0.2, 0.3, 0.4 ] );

		const table = new CliTable3( {
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
			...data.tableEntries.map( ( site ) => [
				site.status,
				site.name,
				site.path,
				{ href: new URL( site.url ).toString(), content: site.url },
			] )
		);

		console.log( table.toString() );
	} else {
		const json = JSON.stringify( data.jsonEntries );
		console.log( json );
		logger.reportKeyValuePair( 'sites', json );
	}
}

const logger = new Logger< LoggerAction >();

export async function runCommand( format: 'table' | 'json' ): Promise< void > {
	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading sites…' ) );
		const cliConfig = await readCliConfig();

		if ( cliConfig.sites.length === 0 ) {
			logger.reportSuccess( __( 'No sites found' ) );
			if ( format === 'json' ) {
				displaySiteList( { tableEntries: [], jsonEntries: [] }, format );
			}
			return;
		}

		const sitesMessage = sprintf(
			_n( 'Found %d site', 'Found %d sites', cliConfig.sites.length ),
			cliConfig.sites.length
		);
		logger.reportSuccess( sitesMessage );

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Connected to process daemon' ) );

		const siteListData = await getSiteListData( cliConfig.sites );
		displaySiteList( siteListData, format );
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
