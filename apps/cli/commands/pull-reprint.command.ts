import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( builderYargs: StudioArgv ) => {
	return builderYargs
		.option( 'url', {
			type: 'string',
			describe: __( 'URL of the remote WordPress site to pull from (remote source)' ),
		} )
		.option( 'only', {
			type: 'string',
			array: true,
			describe: __(
				'Restrict the pull to specific wp-content files or folders (e.g. plugins/akismet, themes, uploads/index.php); repeatable.'
			),
		} )
		.option( 'skip-database', {
			type: 'boolean',
			describe: __( 'Do not pull the database (keeps the local one)' ),
			default: false,
		} )
		.option( 'verbose', {
			type: 'boolean',
			describe: __( 'Show detailed error information and executed commands' ),
			default: false,
		} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull-reprint',
		describe: __(
			'Pull a remote WordPress site into an existing local site (run `studio create` first; remove with `studio delete`)'
		),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/pull-reprint' );
			return commandHandler( argv );
		},
	} );
};
