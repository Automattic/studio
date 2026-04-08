import { __, sprintf } from '@wordpress/i18n';
import { AiPluginManager } from 'cli/ai/plugin-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

export async function runCommand( pluginName: string ): Promise< void > {
	const manager = new AiPluginManager();
	await manager.unlinkPlugin( pluginName );
	console.log(
		sprintf(
			/* translators: %s: plugin name */
			__( 'Unlinked %s' ),
			pluginName
		)
	);
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'unlink [name]',
		describe: __( 'Remove a linked plugin' ),
		builder: ( unlinkYargs ) => {
			return unlinkYargs.positional( 'name', {
				type: 'string',
				default: 'data-liberation',
				description: __( 'Plugin name to unlink' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.name as string );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError(
						new LoggerError(
							error instanceof Error ? error.message : __( 'Failed to unlink plugin' ),
							error
						)
					);
				}
			}
		},
	} );
};
