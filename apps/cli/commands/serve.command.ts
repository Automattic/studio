import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( serveYargs: StudioArgv ) =>
	serveYargs
		.option( 'port', {
			type: 'number',
			default: 8080,
			description: __( 'Port to listen on' ),
		} )
		.option( 'host', {
			type: 'string',
			default: '127.0.0.1',
			description: __( 'Address to listen on' ),
		} );

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'serve',
		// Hidden until Studio Cloud launches: serves the Studio API and sites for a Studio UI
		// running elsewhere.
		describe: false,
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/serve' );
			return commandHandler( argv );
		},
	} );
};
