import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';

export const builder = ( builderYargs: StudioArgv ) => {
	return builderYargs
		.option( 'remote-site', {
			type: 'string',
			describe: __( 'URL or WordPress.com ID of the remote site to pull from' ),
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
		} )
		.option( 'skip-files', {
			type: 'boolean',
			describe: __( 'Pull only the database (keeps the local files)' ),
			conflicts: [ 'only', 'skip-database' ],
		} )
		.option( 'verbose', {
			type: 'boolean',
			describe: __( 'Show detailed error information and executed commands' ),
			default: false,
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
		describe: __( 'Pull a WordPress.com or Pressable site to your local site' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/pull' );
			return commandHandler( argv );
		},
	} );
};
