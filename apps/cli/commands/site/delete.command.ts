import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs
		.positional( 'sites', {
			type: 'string',
			array: true,
			description: __( 'Site paths or IDs to delete' ),
		} )
		.option( 'files', {
			type: 'boolean',
			description: __( 'Move site files to trash (use --no-files to keep files)' ),
			default: true,
		} )
		.option( 'dry-run', {
			alias: 'preview',
			type: 'boolean',
			description: __( 'Show which sites and files would be deleted without deleting them' ),
			default: false,
		} )
		.option( 'format', {
			type: 'string',
			choices: [ 'text', 'json' ] as const,
			default: 'text' as const,
			description: __( 'Output format' ),
		} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete [sites..]',
		describe: __( 'Delete site' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/site/delete' );
			return commandHandler( argv );
		},
	} );
};
