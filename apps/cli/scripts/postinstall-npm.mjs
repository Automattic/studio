/**
 * Postinstall script for npm consumers of wp-studio.
 *
 * Applies patches via patch-package.
 *
 * This script is a no-op in workspace (monorepo) contexts where dependencies
 * are hoisted to the root node_modules and aren't present locally.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname( fileURLToPath( import.meta.url ) );
const packageDir = resolve( scriptDir, '..' );

// Skip if the patched packages aren't installed locally (e.g. in a monorepo
// workspace where dependencies are hoisted to the root node_modules).
const patchedPackages = [
	join( packageDir, 'node_modules', '@wp-playground', 'wordpress' ),
	join( packageDir, 'node_modules', 'ps-man' ),
];
if ( ! patchedPackages.some( ( pkg ) => existsSync( pkg ) ) ) {
	process.exit( 0 );
}

// Apply patches via patch-package
try {
	execSync( 'npx --no-install patch-package --patch-dir ./patches', {
		cwd: packageDir,
		stdio: 'inherit',
	} );
} catch ( error ) {
	console.error( 'patch-package failed — patches may not apply cleanly.' );
	console.error( error instanceof Error ? error.message : error );
	process.exit( 1 );
}
