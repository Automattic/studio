import { isReprintPullEnabled } from '@studio/common/lib/sync/reprint-pull';
import { __ } from '@wordpress/i18n';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { StudioArgv } from 'cli/types';

// Help shows the active engine's options. The Reprint pull rejects the Jetpack Backup pull's.
export const builder = ( builderYargs: StudioArgv ) => {
	const reprint = isReprintPullEnabled();
	return builderYargs
		.option( 'remote-site', {
			type: 'string',
			describe: __( 'URL or WordPress.com ID of the remote site to pull from' ),
		} )
		.option( 'options', {
			type: 'string',
			describe: __( 'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents' ),
			hidden: reprint,
			coerce: ( val: string | undefined ) =>
				val !== undefined ? parseSyncOptions( val ) : undefined,
		} )
		.option( 'include-path-list', {
			type: 'array',
			describe: __( 'Backup node ids to pull when using the "paths" option' ),
			hidden: true,
			coerce: ( value ) => {
				if ( ! Array.isArray( value ) ) {
					throw new Error( __( 'include-path-list must be an array' ) );
				}
				return value.map( String );
			},
		} )
		.option( 'only', {
			type: 'string',
			array: true,
			hidden: ! reprint,
			describe: __(
				'Restrict the pull to specific wp-content files or folders (e.g. plugins/akismet, themes, uploads/index.php); repeatable.'
			),
		} )
		.option( 'skip-database', {
			type: 'boolean',
			hidden: ! reprint,
			describe: __( 'Do not pull the database (keeps the local one)' ),
		} )
		.option( 'skip-files', {
			type: 'boolean',
			hidden: ! reprint,
			describe: __( 'Pull only the database (keeps the local files)' ),
			conflicts: [ 'only', 'skip-database' ],
		} )
		.option( 'verbose', {
			type: 'boolean',
			hidden: ! reprint,
			describe: __( 'Show detailed error information and executed commands' ),
			default: false,
		} )
		.check( ( argv ) => {
			if (
				reprint &&
				( argv.options !== undefined || argv[ 'include-path-list' ] !== undefined )
			) {
				throw new Error(
					__(
						'--options and --include-path-list belong to the Jetpack Backup pull. Choose what to pull with --skip-database, --skip-files or --only.'
					)
				);
			}
			return true;
		} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull',
		describe: __( 'Pull a WordPress.com or Pressable site to your local site' ),
		builder,
		handler: async ( argv ) => {
			if ( ! isReprintPullEnabled() ) {
				const { commandHandler } = await import( 'cli/commands/pull-legacy' );
				return commandHandler( argv );
			}
			const { commandHandler } = await import( 'cli/commands/pull' );
			return commandHandler( argv );
		},
	} );
};
