import { z } from 'zod';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

// A site's active theme and its global styles, read on demand through WP-CLI.
// WP-CLI boots WordPress without the site's server, so they work on a stopped site.

export const themeDetailsSchema = z.object( {
	name: z.string().catch( '' ),
	path: z.string(),
	slug: z.string(),
	isBlockTheme: z.boolean(),
	supportsWidgets: z.boolean(),
	supportsMenus: z.boolean(),
} );

export type ThemeDetails = z.infer< typeof themeDetailsSchema >;

/**
 * The settings and styles WordPress resolves for the site, as the editor shows
 * them: core's theme.json, the active themes' and the user's Global Styles
 * merged (wp_get_global_settings(), wp_get_global_styles()). Presets stay
 * keyed by origin. Null when the active theme is not a block theme, which the
 * Site Editor's Styles are for.
 */
export const globalStylesSchema = z
	.object( {
		settings: z.record( z.string(), z.unknown() ),
		styles: z.record( z.string(), z.unknown() ),
	} )
	.nullable();

export type GlobalStyles = z.infer< typeof globalStylesSchema >;

function runStudioWpCommand(
	execute: ExecuteCliCommand,
	sitePath: string,
	command: string
): Promise< unknown > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = execute( [ 'wp', '--path', sitePath, 'studio', command ], {
			output: 'capture',
		} );
		// A throw in this listener would escape the promise and crash the host process.
		emitter.on( 'success', ( { result } ) => {
			try {
				resolve( parseJsonFromPhpOutput( result.stdout ) );
			} catch ( error ) {
				reject( error );
			}
		} );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}

export async function readThemeDetails(
	execute: ExecuteCliCommand,
	sitePath: string
): Promise< ThemeDetails > {
	return themeDetailsSchema.parse(
		await runStudioWpCommand( execute, sitePath, 'get-theme-details' )
	);
}

export async function readGlobalStyles(
	execute: ExecuteCliCommand,
	sitePath: string
): Promise< GlobalStyles > {
	return globalStylesSchema.parse(
		await runStudioWpCommand( execute, sitePath, 'get-global-styles' )
	);
}
