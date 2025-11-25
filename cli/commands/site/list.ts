import os from 'node:os';
import { __, _n, sprintf } from '@wordpress/i18n';
import Table from 'cli-table3';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getSiteUrl, readAppdata, type SiteData } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { getColumnWidths } from 'cli/lib/utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface SiteListEntry {
	status: string;
	name: string;
	path: string;
	url: string;
	phpVersion: string;
}

function getPrettyPath( path: string ): string {
	return path.replace( process.cwd(), '.' ).replace( os.homedir(), '~' );
}

async function getSiteListData( sites: SiteData[] ) {
	const result: SiteListEntry[] = [];

	for await ( const site of sites ) {
		const isOnline = await isServerRunning( site.id );
		const status = isOnline ? '🟢 Online' : '🔴 Offline';
		const url = getSiteUrl( site );

		result.push( {
			status,
			name: site.name,
			path: getPrettyPath( site.path ),
			url,
			phpVersion: site.phpVersion,
		} );
	}

	return result;
}

export async function runCommand( format: 'table' | 'json' ): Promise< void > {
	const logger = new Logger< LoggerAction >();

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

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon...' ) );
		await connect();
		logger.reportSuccess( __( 'Connected to process daemon' ) );

		const sitesData = await getSiteListData( appdata.sites );

		if ( format === 'table' ) {
			const colWidths = getColumnWidths( [ 0.1, 0.2, 0.25, 0.4, 0.05 ] );

			const table = new Table( {
				head: [ __( 'Status' ), __( 'Name' ), __( 'Path' ), __( 'URL' ), __( 'PHP' ) ],
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
					site.phpVersion,
				] )
			);

			console.log( table.toString() );
		} else {
			console.log( JSON.stringify( sitesData, null, 2 ) );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to load sites' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List local sites' ),
		builder: ( yargs ) => {
			return yargs.option( 'format', {
				type: 'string',
				choices: [ 'table', 'json' ],
				default: 'table',
				description: __( 'Output format' ),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.format as 'table' | 'json' );
		},
	} );
};
