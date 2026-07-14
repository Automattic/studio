import { isOnline } from '@studio/common/lib/network-utils';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { fetchStudioBlueprints, type Blueprint } from '@studio/common/lib/studio-blueprints-api';
import { BlueprintCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { getColumnWidths } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

function truncate( str: string, maxLength: number ): string {
	if ( str.length <= maxLength ) {
		return str;
	}
	return str.slice( 0, maxLength - 1 ) + '…';
}

function displayBlueprints( blueprints: Blueprint[], format: 'table' | 'json' ): void {
	if ( format === 'json' ) {
		const json = JSON.stringify( blueprints );
		console.log( json );
		logger.reportKeyValuePair( 'blueprints', json );
		return;
	}

	const colWidths = getColumnWidths( [ 0.2, 0.3, 0.5 ] );

	const table = new CliTable3( {
		head: [ __( 'Slug' ), __( 'Title' ), __( 'Description' ) ],
		wordWrap: true,
		wrapOnWordBoundary: false,
		colWidths,
		style: {
			head: [],
			border: [],
		},
	} );

	table.push(
		...blueprints.map( ( bp ) => [ bp.slug, bp.title, truncate( bp.excerpt, colWidths[ 2 ] - 4 ) ] )
	);

	console.log( table.toString() );
}

export async function runCommand( format: 'table' | 'json', category?: string ): Promise< void > {
	if ( ! ( await isOnline() ) ) {
		throw new LoggerError( __( 'An internet connection is required to list blueprints.' ) );
	}

	logger.reportStart( LoggerAction.FETCH_BLUEPRINTS, __( 'Fetching blueprints…' ) );

	const sharedConfig = await readSharedConfig();
	const locale = sharedConfig.locale;
	const blueprints = await fetchStudioBlueprints( locale );

	if ( blueprints.length === 0 ) {
		logger.reportSuccess( __( 'No blueprints available' ) );
		if ( format === 'json' ) {
			displayBlueprints( [], format );
		}
		return;
	}

	let filtered = blueprints;
	if ( category ) {
		const lowerCategory = category.toLowerCase();
		filtered = blueprints.filter( ( bp ) => {
			const meta = bp.blueprint?.meta as { categories?: string[] } | undefined;
			return meta?.categories?.some( ( cat ) => cat.toLowerCase() === lowerCategory );
		} );
	}

	const message = sprintf(
		_n( 'Found %d blueprint', 'Found %d blueprints', filtered.length ),
		filtered.length
	);
	logger.reportSuccess( message );

	displayBlueprints( filtered, format );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List available blueprints' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'format', {
					type: 'string',
					choices: [ 'table', 'json' ] as const,
					default: 'table' as const,
					description: __( 'Output format' ),
				} )
				.option( 'category', {
					type: 'string',
					description: __( 'Filter by category' ),
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.format, argv.category );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to list blueprints' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
