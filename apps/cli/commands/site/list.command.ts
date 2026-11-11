import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
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
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List sites' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/site/list' );
			return commandHandler( argv );
		},
	} );
};
