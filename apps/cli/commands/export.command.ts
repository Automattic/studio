import path from 'path';
import { __ } from '@wordpress/i18n';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs
		.positional( 'export-file', {
			type: 'string',
			normalize: true,
			demandOption: false,
			description: __(
				'Path to the export file. All exports can use .zip or .tar.gz. Database-only exports can also use .sql.'
			),
			coerce: ( value ) => {
				return path.resolve( untildify( value ) );
			},
		} )
		.option( 'mode', {
			type: 'string',
			choices: [ 'full', 'content', 'db' ] as const,
			default: 'full' as const,
			description: __(
				'Export the full site, just the content, or just the database. Default exports full site.'
			),
		} )
		.option( 'split-db-dump-by-table', {
			type: 'boolean',
			default: false,
			description: __( 'Split the database dump by table' ),
			hidden: true,
		} )
		.option( 'include-only', {
			type: 'array',
			description: __( 'Include only the specified paths in the export' ),
			coerce: ( value ) => {
				if ( ! Array.isArray( value ) ) {
					throw new Error( __( 'include-only must be an array' ) );
				}
				return value.map( String );
			},
			hidden: true,
		} )
		.option( 'apply-deploy-ignore', {
			type: 'boolean',
			default: false,
			description: __( 'Apply .deployignore patterns when exporting' ),
			hidden: true,
		} )
		.option( 'suppress-tracks-event', {
			type: 'boolean',
			default: false,
			hidden: true,
		} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'export [export-file]',
		describe: __( 'Export site to a backup file' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/export' );
			return commandHandler( argv );
		},
	} );
};
