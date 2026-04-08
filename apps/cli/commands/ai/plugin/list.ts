import { __ } from '@wordpress/i18n';
import { AiPluginManager } from 'cli/ai/plugin-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

type OutputFormat = 'compact' | 'json';

export async function runCommand( format: OutputFormat ): Promise< void > {
	const manager = new AiPluginManager();
	const plugins = manager.getDefaultPlugins();
	const results = [];

	for ( const manifest of plugins ) {
		const info = await manager.getPluginInfo( manifest );
		if ( ! info ) {
			continue;
		}

		const updates = await manager.checkForUpdates( manifest );
		results.push( {
			name: info.name,
			version: info.version,
			source: info.source,
			path: info.linkTarget ?? info.path,
			updateAvailable: updates.available ? updates.latestVersion : null,
		} );
	}

	if ( format === 'json' ) {
		console.log( JSON.stringify( results, null, 2 ) );
		return;
	}

	if ( results.length === 0 ) {
		console.log( __( 'No AI plugins installed' ) );
		return;
	}

	for ( const plugin of results ) {
		const version = plugin.version ?? 'local';
		const source = plugin.source === 'linked' ? `(linked → ${ plugin.path })` : '(cloned)';
		const update = plugin.updateAvailable ? `   update available: ${ plugin.updateAvailable }` : '';
		console.log( `${ plugin.name }  ${ version }  ${ source }${ update }` );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List installed AI plugins' ),
		builder: ( listYargs ) => {
			return listYargs.option( 'format', {
				type: 'string',
				choices: [ 'compact', 'json' ] as const,
				default: 'compact' as const,
				description: __( 'Output format' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.format as OutputFormat );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to list AI plugins' ), error ) );
				}
			}
		},
	} );
};
