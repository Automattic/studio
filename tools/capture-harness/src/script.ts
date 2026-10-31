import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './paths.ts';
import { Script, describeIssues } from './schema.ts';

export interface LoadedScript extends Script {
	file: string;
}

function parseScript( data: unknown, source: string ): Script {
	const parsed = Script.safeParse( data );
	if ( ! parsed.success ) {
		throw new Error(
			`${ source } is not a valid script:\n  ${ describeIssues( parsed.error, data ).join(
				'\n  '
			) }`
		);
	}
	return parsed.data;
}

/**
 * The scripts in `refs`, each a file or a folder of them, in name order
 * within a folder.
 */
export async function loadScripts( refs: string[] ): Promise< LoadedScript[] > {
	const files: string[] = [];
	for ( const ref of refs ) {
		const full = path.resolve( ref );
		if ( ( await stat( full ) ).isDirectory() ) {
			files.push(
				...( await readdir( full ) )
					.filter( ( name ) => name.endsWith( '.json' ) )
					.sort()
					.map( ( name ) => path.join( full, name ) )
			);
		} else {
			files.push( full );
		}
	}
	return Promise.all(
		files.map( async ( file ) => ( { ...parseScript( await readJson( file ), file ), file } ) )
	);
}
