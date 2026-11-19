import { existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach } from 'vitest';

// Tests never reach the real `~/.studio`: one that doesn't set `DEV_CONFIG_DIR`,
// or deletes it, gets a throwaway folder. It links the PHP and WordPress caches,
// which tests only read, so the ones that run PHP find it.
const fallback = mkdtempSync( path.join( os.tmpdir(), 'studio-test-config-' ) );
for ( const cache of [ 'php-bin', 'server-files' ] ) {
	const real = path.join( os.homedir(), '.studio', cache );
	if ( existsSync( real ) ) {
		symlinkSync( real, path.join( fallback, cache ), 'junction' );
	}
}
process.env.DEV_CONFIG_DIR ??= fallback;
beforeEach( () => {
	process.env.DEV_CONFIG_DIR ??= fallback;
} );
