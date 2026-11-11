import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs.help( false ).option( 'help', { type: 'boolean' } );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'mcp',
		describe: __( 'MCP server for AI agents' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/mcp' );
			return commandHandler( argv );
		},
	} );
};
