import path from 'path';
import { __ } from '@wordpress/i18n';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs
		.positional( 'import-file', {
			type: 'string',
			normalize: true,
			demandOption: true,
			description: __( 'Path to the import file' ),
			coerce: ( value ) => {
				return path.resolve( untildify( value ) );
			},
		} )
		.option( 'start-server', {
			type: 'boolean',
			default: false,
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
		command: 'import <import-file>',
		describe: __( 'Import a backup file to site' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/import' );
			return commandHandler( argv );
		},
	} );
};
