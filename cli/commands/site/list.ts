import { __, _n, sprintf } from '@wordpress/i18n';
import Table from 'cli-table3';
import { PreviewCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { readAppdata, type SiteData } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface SiteTable {
	id: string;
	name: string;
	path: string;
	phpVersion: string;
}

function getSitesCliTable( sites: SiteData[] ) {
	const table = new Table( {
		head: [ __( 'Name' ), __( 'Path' ), __( 'ID' ), __( 'PHP' ) ],
		style: {
			head: [ 'cyan' ],
			border: [ 'grey' ],
		},
		wordWrap: true,
		wrapOnWordBoundary: false,
	} );

	sites.forEach( ( site ) => {
		table.push( [ site.name, site.path, site.id, site.phpVersion ] );
	} );

	return table;
}

function getSitesCliJson( sites: SiteData[] ): SiteTable[] {
	return sites.map( ( site ) => ( {
		id: site.id,
		name: site.name,
		path: site.path,
		phpVersion: site.phpVersion,
	} ) );
}

export async function runCommand( format: 'table' | 'json' ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.LOAD, __( 'Loading sites…' ) );
		const appdata = await readAppdata();
		const allSites = appdata.sites;

		if ( allSites.length === 0 ) {
			logger.reportSuccess( __( 'No sites found' ) );
			return;
		}

		const sitesMessage = sprintf(
			_n( 'Found %d site', 'Found %d sites', allSites.length ),
			allSites.length
		);

		logger.reportSuccess( sitesMessage );

		if ( format === 'table' ) {
			const table = getSitesCliTable( allSites );
			console.log( table.toString() );
		} else {
			console.log( JSON.stringify( getSitesCliJson( allSites ), null, 2 ) );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to load sites' ), error );
			logger.reportError( loggerError );
		}
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
