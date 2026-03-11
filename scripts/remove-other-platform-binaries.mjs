/**
 * Removes directories named after foreign platforms from node_modules.
 *
 * Many native packages (e.g. koffi, @anthropic-ai/claude-agent-sdk) ship
 * prebuilt binaries for every OS inside platform-specific directories like
 * `darwin_arm64/`, `arm64-darwin/`, `linux-x64/`, etc. Downstream tools such
 * as Windows code-signing (signtool) will fail if they encounter binaries
 * built for another OS. This script removes any directory whose name contains
 * a foreign platform identifier.
 *
 * Usage: node scripts/remove-other-platform-binaries.mjs
 *
 * Resolves node_modules relative to process.cwd() so it works from any
 * workspace (e.g. apps/studio or apps/cli).
 */

import { rmSync } from 'fs';
import { join } from 'path';
import { globSync } from 'glob';

const nodeModulesPath = join( process.cwd(), 'node_modules' );

const foreignPlatforms =
	process.platform === 'win32'
		? [ 'darwin', 'linux' ]
		: process.platform === 'darwin'
		? [ 'win32', 'linux' ]
		: [ 'darwin', 'win32' ];

const patterns = foreignPlatforms.map( ( p ) => `**/*${ p }*/` );

let removedCount = 0;

for ( const pattern of patterns ) {
	const matches = globSync( pattern, {
		cwd: nodeModulesPath,
		absolute: true,
	} );
	for ( const match of matches ) {
		try {
			rmSync( match, { recursive: true, force: true } );
			removedCount++;
		} catch ( e ) {
			console.log( `Could not remove ${ match }: ${ e.message }` );
		}
	}
}

console.log( `Removed ${ removedCount } foreign-platform directories from node_modules` );
