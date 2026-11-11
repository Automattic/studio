import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs.option( 'format', {
		type: 'string',
		choices: [ 'table', 'json' ] as const,
		default: 'table' as const,
		description: __( 'Output format' ),
	} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status',
		describe: __( 'Get status of site' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/site/status' );
			return commandHandler( argv );
		},
	} );
};
