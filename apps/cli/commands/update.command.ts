import { __ } from '@wordpress/i18n';
import type { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) =>
	yargs.option( 'auto-updates', {
		type: 'boolean',
		description: __( 'Enable automatic updates; use --no-auto-updates to disable them' ),
	} );

export const registerCommand = ( yargs: StudioArgv ) =>
	yargs.command( {
		command: 'update',
		describe: __( 'Update the standalone Studio CLI' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/update' );
			return commandHandler( argv );
		},
	} );
