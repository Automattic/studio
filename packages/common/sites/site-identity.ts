import { z } from 'zod';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

// A site's active theme, read on demand through WP-CLI without starting its server.

export const themeDetailsSchema = z.object( {
	name: z.string().catch( '' ),
	path: z.string(),
	slug: z.string(),
	isBlockTheme: z.boolean(),
	supportsWidgets: z.boolean(),
	supportsMenus: z.boolean(),
} );

export type ThemeDetails = z.infer< typeof themeDetailsSchema >;

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
