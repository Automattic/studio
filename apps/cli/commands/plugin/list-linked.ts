import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { PluginCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface LinkedPlugin {
	name: string;
	sourcePath: string;
}

async function getLinkedPlugins( sitePath: string ): Promise< LinkedPlugin[] > {
	const pluginsDir = path.join( sitePath, 'wp-content', 'plugins' );

	if ( ! ( await pathExists( pluginsDir ) ) ) {
		return [];
	}

	const entries = await fs.promises.readdir( pluginsDir, { withFileTypes: true } );
	const linkedPlugins: LinkedPlugin[] = [];

	for ( const entry of entries ) {
		const entryPath = path.join( pluginsDir, entry.name );

		try {
			const stats = await fs.promises.lstat( entryPath );
			if ( stats.isSymbolicLink() ) {
				const linkTarget = await fs.promises.readlink( entryPath );
				const resolvedTarget = path.resolve( path.dirname( entryPath ), linkTarget );

				linkedPlugins.push( {
					name: entry.name,
					sourcePath: resolvedTarget,
				} );
			}
		} catch {
			// Skip entries we can't read
			continue;
		}
	}

	return linkedPlugins;
}

export async function runCommand( sitePath: string, format: 'table' | 'json' ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		// Validate site exists
		await getSiteByFolder( sitePath );

		if ( format === 'json' ) {
			const linkedPlugins = await getLinkedPlugins( sitePath );
			console.log( JSON.stringify( linkedPlugins, null, 2 ) );
			return;
		}

		logger.reportStart( LoggerAction.LIST_LINKED, __( 'Listing linked plugins…' ) );
		const linkedPlugins = await getLinkedPlugins( sitePath );

		if ( linkedPlugins.length === 0 ) {
			logger.reportSuccess( __( 'No linked plugins found.' ) );
			console.log( __( 'Use "studio plugin link <source-path>" to link an external plugin.' ) );
			return;
		}

		logger.reportSuccess( sprintf( __( 'Found %d linked plugin(s):' ), linkedPlugins.length ) );

		for ( const plugin of linkedPlugins ) {
			console.log( `  ${ plugin.name }` );
			console.log( `    → ${ plugin.sourcePath }` );
			console.log();
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to list linked plugins' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list-linked',
		describe: __( 'List all linked plugins in the site' ),
		builder: ( listYargs ) => {
			return listYargs.option( 'format', {
				type: 'string',
				choices: [ 'table', 'json' ] as const,
				default: 'table' as const,
				describe: __( 'Output format' ),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.format as 'table' | 'json' );
		},
	} );
};
