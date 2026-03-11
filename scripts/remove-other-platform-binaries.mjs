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

import { readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

const nodeModulesPath = join( process.cwd(), 'node_modules' );

const foreignPlatforms =
	process.platform === 'win32'
		? [ 'darwin', 'linux' ]
		: process.platform === 'darwin'
		? [ 'win32', 'linux' ]
		: [ 'darwin', 'win32' ];

function isForeignPlatformDir( name ) {
	return foreignPlatforms.some( ( p ) => name.includes( p ) );
}

let removedCount = 0;

function walk( dir ) {
	let entries;
	try {
		entries = readdirSync( dir );
	} catch {
		return;
	}

	for ( const entry of entries ) {
		const fullPath = join( dir, entry );
		let stat;
		try {
			stat = statSync( fullPath );
		} catch {
			continue;
		}

		if ( ! stat.isDirectory() ) {
			continue;
		}

		if ( isForeignPlatformDir( entry ) ) {
			try {
				rmSync( fullPath, { recursive: true, force: true } );
				removedCount++;
			} catch ( e ) {
				console.log( `Could not remove ${ fullPath }: ${ e.message }` );
			}
		} else {
			walk( fullPath );
		}
	}
}

walk( nodeModulesPath );

console.log( `Removed ${ removedCount } foreign-platform directories from node_modules` );
