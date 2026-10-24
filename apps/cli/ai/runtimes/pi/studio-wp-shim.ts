import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import type { BashSpawnHook } from '@earendil-works/pi-coding-agent';

function shellQuote( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

// `wp` in the agent's shell runs `studio wp`: WP-CLI on Studio's PHP binary for the site,
// with Studio's SQLite integration loaded. A system `wp`, where one is installed at all,
// runs on whatever PHP the machine has and cannot open a Studio site's database.
export function getStudioWpShimScript( nodePath: string, cliPath: string ): string {
	return `#!/bin/sh\nexec ${ shellQuote( nodePath ) } ${ shellQuote( cliPath ) } wp "$@"\n`;
}

// Writes the shim into a directory named after its content, so concurrent Studio
// processes (or different installs) never overwrite each other's script.
export function ensureStudioWpShimDirectory(
	script: string,
	root: string = path.join( getConfigDirectory(), 'tmp', 'agent-bin' )
): string {
	const directory = path.join(
		root,
		createHash( 'sha256' ).update( script ).digest( 'hex' ).slice( 0, 12 )
	);
	const shimPath = path.join( directory, 'wp' );
	if ( ! fs.existsSync( shimPath ) ) {
		fs.mkdirSync( directory, { recursive: true } );
		const temporaryPath = `${ shimPath }.${ process.pid }`;
		fs.writeFileSync( temporaryPath, script, { mode: 0o755 } );
		fs.renameSync( temporaryPath, shimPath );
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
