import path from 'path';
import { __ } from '@wordpress/i18n';
import { untildify } from 'cli/lib/utils';
import { StudioArgv } from 'cli/types';

export const builder = ( yargs: StudioArgv ) => {
	return yargs
		.positional( 'output-dir', {
			type: 'string',
			description: __( 'Directory to write the static site to' ),
			coerce: ( value: string ) => path.resolve( untildify( value ) ),
		} )
		.option( 'base-url', {
			type: 'string',
			description: __(
				'URL the static site will be hosted at. Links are root-relative when omitted.'
			),
			coerce: ( value: string ) => {
				const url = URL.parse( value );
				if (
					! url ||
					! [ 'http:', 'https:' ].includes( url.protocol ) ||
					url.pathname !== '/'
				) {
					throw new Error(
						__( 'base-url must be an http(s) URL without a path, e.g. https://example.com' )
					);
				}
				return url.origin;
			},
		} )
		.option( 'overwrite', {
			type: 'boolean',
			default: false,
			description: __( 'Replace the contents of a non-empty output directory' ),
		} );
};

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'export-static [output-dir]',
		describe: __( 'Export site as static HTML files' ),
		builder,
		handler: async ( argv ) => {
			const { commandHandler } = await import( 'cli/commands/export-static' );
			return commandHandler( argv );
		},
	} );
};
