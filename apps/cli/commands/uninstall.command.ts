import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs.option( 'purge', {
		type: 'boolean',
		alias: 'all',
		describe: __( 'Also delete your Studio config (~/.studio)' ),
		default: false,
	} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'uninstall',
		describe: __( 'Uninstall the standalone Studio CLI' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/uninstall' );
			return commandHandler( argv );
		},
	} );
};
