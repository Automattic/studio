import { __, sprintf } from '@wordpress/i18n';
import { AiPluginManager } from 'cli/ai/plugin-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

export async function runCommand( pluginName: string, targetPath: string ): Promise< void > {
	const manager = new AiPluginManager();
	await manager.linkPlugin( pluginName, targetPath );
	console.log(
		sprintf(
			/* translators: 1: plugin name, 2: path */
			__( 'Linked %1$s → %2$s' ),
			pluginName,
			targetPath
		)
	);
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'link <path>',
		describe: __( 'Link a local plugin directory for development' ),
		builder: ( linkYargs ) => {
			return linkYargs.positional( 'path', {
				type: 'string',
				description: __( 'Path to the plugin directory' ),
				demandOption: true,
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( 'data-liberation', argv.path as string );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError(
						new LoggerError(
							error instanceof Error ? error.message : __( 'Failed to link plugin' ),
							error
						)
					);
				}
			}
		},
	} );
};
