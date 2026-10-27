import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs
		.option( 'skip-browser', {
			type: 'boolean',
			describe: __( 'Skip opening the site in browser after starting' ),
			default: false,
		} )
		.option( 'skip-log-details', {
			type: 'boolean',
			describe: __( 'Skip printing site URL and admin credentials after starting' ),
			default: false,
		} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'start',
		describe: __( 'Start site' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/site/start' );
			return commandHandler( argv );
		},
	} );
};
