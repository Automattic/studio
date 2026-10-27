import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( uiYargs: StudioArgv ) =>
	uiYargs
		.option( 'port', {
			type: 'number',
			description: __( 'Port to listen on' ),
		} )
		.option( 'open', {
			type: 'boolean',
			default: true,
			description: __( 'Open the UI in your default browser' ),
		} )
		.option( 'path', { hidden: true } );

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'ui',
		describe: __( 'Start the local Studio web UI and open it in your browser' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/ui' );
			return commandHandler( argv );
		},
	} );
};
