import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

// A site's active theme and Site Icon, read on demand through WP-CLI. WP-CLI
// boots WordPress without the site's server, so both work on a stopped site.

export const themeDetailsSchema = z.object( {
	name: z.string().catch( '' ),
	path: z.string(),
	slug: z.string(),
	isBlockTheme: z.boolean(),
	supportsWidgets: z.boolean(),
	supportsMenus: z.boolean(),
} );

export type ThemeDetails = z.infer< typeof themeDetailsSchema >;

const siteIconSchema = z.object( { relativePath: z.string() } ).nullable();

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

/** The site's icon as a data URL, or `null` when it has none. */
export async function readSiteIcon(
	execute: ExecuteCliCommand,
	sitePath: string
): Promise< string | null > {
	const icon = siteIconSchema.parse(
		await runStudioWpCommand( execute, sitePath, 'get-site-icon' )
	);
	if ( ! icon ) {
		return null;
	}
	const iconPath = path.join( sitePath, icon.relativePath );
	const data = await readFile( iconPath ).catch( () => null );
	const extension = path.extname( iconPath ).slice( 1 ).toLowerCase();
	return data && `data:image/${ extension };base64,${ data.toString( 'base64' ) }`;
}
