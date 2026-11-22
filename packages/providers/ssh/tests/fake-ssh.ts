import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

// An `ssh` that records its arguments and runs the remote command on this computer, as a server
// would, in a home folder of its own.
const FAKE_SSH = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_SSH_ARGS"
if [ -n "$FAKE_SSH_FAIL" ]; then echo "$FAKE_SSH_FAIL" >&2; exit 255; fi
for command; do :; done
exec sh -c "$command"
`;

/** Puts a fake `ssh` and the given fake `wp` first on PATH for each test; returns their folder. */
export function useFakeServer( wp: string ): { dir: string } {
	const server = { dir: '' };
	beforeEach( () => {
		server.dir = mkdtempSync( path.join( tmpdir(), 'studio-ssh-' ) );
		for ( const [ name, script ] of [
			[ 'ssh', FAKE_SSH ],
			[ 'wp', wp ],
		] ) {
			writeFileSync( path.join( server.dir, name ), script );
			chmodSync( path.join( server.dir, name ), 0o755 );
		}
		vi.stubEnv( 'PATH', `${ server.dir }${ path.delimiter }${ process.env.PATH }` );
		vi.stubEnv( 'HOME', server.dir );
		vi.stubEnv( 'FAKE_SSH_ARGS', path.join( server.dir, 'args' ) );
	} );
	afterEach( () => {
		vi.unstubAllEnvs();
		rmSync( server.dir, { recursive: true, force: true } );
	} );
	return server;
}
