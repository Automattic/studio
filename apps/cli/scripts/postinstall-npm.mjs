/**
 * Postinstall script for npm consumers of @automattic/studio-cli.
 *
 * 1. Applies patches via patch-package.
 * 2. Prunes unnecessary PHP WASM asyncify binaries to save ~250MB.
 *
 * This script is a no-op in workspace (monorepo) contexts where the package's own
 * node_modules doesn't exist. All operations fail silently if the target directories
 * don't exist, making this resilient to future dependency changes.
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync } from 'fs';
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

// Prune PHP WASM asyncify binaries — the CLI only uses JSPI builds
try {
	const phpWasmDir = join( nodeModulesPath, '@php-wasm' );
	if ( existsSync( phpWasmDir ) ) {
		for ( const entry of readdirSync( phpWasmDir ) ) {
			if ( entry.startsWith( 'node-' ) ) {
				const asyncifyPath = join( phpWasmDir, entry, 'asyncify' );
				if ( existsSync( asyncifyPath ) ) {
					rmSync( asyncifyPath, { recursive: true, force: true } );
					console.log( `Pruned ${ asyncifyPath }` );
				}
			}
		}
	}
} catch {
	// Fail silently — dependencies may not be present
}
