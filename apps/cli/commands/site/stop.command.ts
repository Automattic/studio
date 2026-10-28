import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs.option( 'all', {
		type: 'boolean',
		describe: __( 'Stop all sites' ),
		default: false,
	} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'stop',
		describe: __( 'Stop site(s)' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/site/stop' );
			return commandHandler( argv );
		},
	} );
};
