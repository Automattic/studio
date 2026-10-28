import { __ } from '@wordpress/i18n';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs
		.option( 'options', {
			type: 'string',
			description: __(
				'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents'
			),
			coerce: ( val: string | undefined ) =>
				val !== undefined ? parseSyncOptions( val ) : undefined,
		} )
		.option( 'remote-site', {
			type: 'string',
			description: __( 'Remote site URL or ID' ),
		} )
		.option( 'include-only', {
			type: 'string',
			array: true,
			description: __( 'Only push these paths from the selection made with --options' ),
		} )
		.option( 'suppress-tracks-event', {
			type: 'boolean',
			default: false,
			hidden: true,
		} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'push',
		describe: __( 'Push your local site to a WordPress.com site' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/push' );
			return commandHandler( argv );
		},
	} );
};
