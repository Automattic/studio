/**
 * Postinstall script for npm consumers of @automattic/wp-studio.
 *
 * Applies patches via patch-package.
 *
 * This script is a no-op in workspace (monorepo) contexts where the package's own
 * node_modules doesn't exist.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
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
} catch ( error ) {
	console.error( 'patch-package failed — patches may not apply cleanly.' );
	console.error( error instanceof Error ? error.message : error );
	process.exit( 1 );
}
