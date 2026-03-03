/**
 * Postinstall script for npm consumers of @automattic/studio-cli.
 *
 * 1. Prunes unnecessary PHP WASM binaries (asyncify + web builds) to save ~650MB.
 * 2. Removes fs-ext-extra-prebuilt binaries that don't match the current platform.
 *
 * This script is a no-op in workspace (monorepo) contexts where the package's own
 * node_modules doesn't exist. All operations fail silently if the target directories
 * don't exist, making this resilient to future dependency changes.
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync, unlinkSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname( fileURLToPath( import.meta.url ) );
const packageDir = resolve( scriptDir, '..' );
const nodeModulesPath = join( packageDir, 'node_modules' );

// Skip in workspace context where deps are hoisted to the root
if ( ! existsSync( nodeModulesPath ) ) {
	process.exit( 0 );
}

// Apply patches via patch-package
try {
	execSync( 'npx --no-install patch-package --patch-dir ./patches', {
		cwd: packageDir,
		stdio: 'inherit',
	} );
} catch {
	console.log( 'patch-package failed — patches may not apply cleanly' );
}

// 1. Prune PHP WASM binaries — remove asyncify builds for node and all web builds
try {
	const phpWasmDir = join( nodeModulesPath, '@php-wasm' );
	if ( existsSync( phpWasmDir ) ) {
		for ( const entry of readdirSync( phpWasmDir ) ) {
			// Remove asyncify directories inside node-* packages
			if ( entry.startsWith( 'node-' ) ) {
				const asyncifyPath = join( phpWasmDir, entry, 'asyncify' );
				if ( existsSync( asyncifyPath ) ) {
					rmSync( asyncifyPath, { recursive: true, force: true } );
					console.log( `Pruned ${ asyncifyPath }` );
				}
			}
			// Remove web-* packages entirely
			if ( /^web-\d+-\d+/.test( entry ) ) {
				const webPath = join( phpWasmDir, entry );
				rmSync( webPath, { recursive: true, force: true } );
				console.log( `Pruned ${ webPath }` );
			}
		}
	}
} catch {
	// Fail silently — dependencies may not be present
}

// 2. Remove cross-platform fs-ext-extra-prebuilt binaries
try {
	const binDir = join( nodeModulesPath, 'fs-ext-extra-prebuilt', 'binaries' );
	for ( const file of readdirSync( binDir ) ) {
		if ( ! file.startsWith( `fs-ext-${ process.platform }-` ) ) {
			try {
				unlinkSync( join( binDir, file ) );
				console.log( `Removed ${ file }` );
			} catch ( e ) {
				console.log( `Could not remove ${ file }: ${ e.message }` );
			}
		}
	}
} catch {
	// Fail silently — fs-ext-extra-prebuilt may not be present
}
