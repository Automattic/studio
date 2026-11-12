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

/**
 * `look` with its frame on another background (`--background`): the dot
 * field in the other scheme, say, to put the light app on dark dots.
 */
export function withBackground( look: Look, background?: string ): Look {
	if ( ! background ) {
		return look;
	}
	if ( ! look.frame ) {
		throw new Error( `--background needs a look with a frame; ${ look.name } has none.` );
	}
	return parseLook(
		{ ...look, frame: { ...look.frame, background } },
		`${ look.name } with --background ${ background }`
	);
}
