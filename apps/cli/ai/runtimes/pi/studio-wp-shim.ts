import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import type { BashSpawnHook } from '@earendil-works/pi-coding-agent';

function shellQuote( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

/**
 * The commands of the agent's shell that run the Studio running the agent:
 * `studio`, whichever Studio is installed on the machine as well, and `wp`,
 * which runs `studio wp`: WP-CLI on Studio's PHP binary for the site, with
 * Studio's SQLite integration loaded. A system `wp`, where one is installed at
 * all, runs on whatever PHP the machine has and cannot open a Studio site's
 * database.
 */
export function getStudioShims( nodePath: string, cliPath: string ): Record< string, string > {
	const cli = `${ shellQuote( nodePath ) } ${ shellQuote( cliPath ) }`;
	return {
		studio: `#!/bin/sh\nexec ${ cli } "$@"\n`,
		wp: `#!/bin/sh\nexec ${ cli } wp "$@"\n`,
	};
}

// Writes the shims into a directory named after their content, so concurrent Studio
// processes (or different installs) never overwrite each other's scripts.
export function ensureStudioShimDirectory(
	shims: Record< string, string >,
	root: string = path.join( getConfigDirectory(), 'tmp', 'agent-bin' )
): string {
	const directory = path.join(
		root,
		createHash( 'sha256' ).update( JSON.stringify( shims ) ).digest( 'hex' ).slice( 0, 12 )
	);
	for ( const [ name, script ] of Object.entries( shims ) ) {
		const shimPath = path.join( directory, name );
		if ( ! fs.existsSync( shimPath ) ) {
			fs.mkdirSync( directory, { recursive: true } );
			const temporaryPath = `${ shimPath }.${ process.pid }`;
			fs.writeFileSync( temporaryPath, script, { mode: 0o755 } );
			fs.renameSync( temporaryPath, shimPath );
		}
	}
	return directory;
}

export function prependToPath( directory: string ): BashSpawnHook {
	return ( context ) => {
		const pathKey =
			Object.keys( context.env ).find( ( key ) => key.toUpperCase() === 'PATH' ) ?? 'PATH';
		const current = context.env[ pathKey ];
		return {
			...context,
			env: {
				...context.env,
				[ pathKey ]: current ? `${ directory }${ path.delimiter }${ current }` : directory,
			},
		};
	};
}
