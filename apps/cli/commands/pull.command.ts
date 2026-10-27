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
		.option( 'include-path-list', {
			type: 'array',
			description: __( 'Backup node ids to pull when using the "paths" option' ),
			hidden: true,
			coerce: ( value ) => {
				if ( ! Array.isArray( value ) ) {
					throw new Error( __( 'include-path-list must be an array' ) );
				}
				return value.map( String );
			},
		} )
		.option( 'suppress-tracks-event', {
			type: 'boolean',
			default: false,
			hidden: true,
		} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull',
		describe: __( 'Pull a WordPress.com site to your local site' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/pull' );
			return commandHandler( argv );
		},
	} );
};
