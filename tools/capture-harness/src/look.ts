import { existsSync } from 'node:fs';
import path from 'node:path';
import { LOOKS_DIR, readJson } from './paths.ts';
import { Look, describeIssues } from './schema.ts';

/** A look file by path, or a bundled look by name (`looks/<name>.json`). */
function lookFile( ref: string, relativeTo = process.cwd() ) {
	const bundled = path.join( LOOKS_DIR, `${ ref }.json` );
	if ( ! ref.includes( '/' ) && ! ref.endsWith( '.json' ) && existsSync( bundled ) ) {
		return bundled;
	}
	return path.resolve( relativeTo, ref );
}

function parseLook( data: unknown, source: string ): Look {
	const parsed = Look.safeParse( data );
	if ( ! parsed.success ) {
		throw new Error(
			`${ source } is not a valid look:\n  ${ describeIssues( parsed.error, data ).join( '\n  ' ) }`
		);
	}
	return parsed.data;
}

export async function loadLook( ref: string, relativeTo?: string ): Promise< Look > {
	const file = lookFile( ref, relativeTo );
	return parseLook( await readJson( file ), file );
}
