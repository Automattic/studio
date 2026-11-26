import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

// An `ssh` that records its arguments and runs the remote command on this computer, as a server
// would, in a home folder of its own.
const FAKE_SSH = `#!/bin/sh
if [ "$1" = -G ]; then printf 'user deploy\\nhostname %s.test\\nport 22\\n' "$3"; exit 0; fi
printf '%s\\n' "$*" | tr '\\n' ' ' >> "$FAKE_SSH_ARGS.log"; echo >> "$FAKE_SSH_ARGS.log"
[ "$1" != -O ] || exit 0
printf '%s\\n' "$@" > "$FAKE_SSH_ARGS"
if [ -n "$FAKE_SSH_FAIL" ]; then echo "$FAKE_SSH_FAIL" >&2; exit 255; fi
for command; do :; done
exec sh -c "$command"
`;

// A `php` that logs its arguments and runs the fake WP-CLI with what follows the phar's global
// flags, which it accepts only before the command, as with `WP_CLI_STRICT_ARGS_MODE`.
const FAKE_PHP = `#!/bin/sh
shift
printf '%s\\n' "$*" >> "$HOME/php.log"
while [ "\${1#--}" != "$1" ]; do shift; done
for arg; do
	case "$arg" in --allow-root | --skip-plugins | --skip-themes)
		echo "Error: Parameter errors: unknown $arg parameter" >&2; exit 1 ;;
	esac
done
exec "$(dirname "$0")/wp" "$@"
`;

/**
 * Puts a fake `ssh` first on PATH for each test, and a `php` that runs the given fake WP-CLI in place of
 * Studio's; returns their folder.
 */
export function useFakeServer( wp: string ): { dir: string } {
	const server = { dir: '' };
	beforeEach( () => {
		server.dir = mkdtempSync( path.join( tmpdir(), 'studio-ssh-' ) );
		// The server has the MySQL client, so WP-CLI's own commands run rather than the PHP fallbacks.
		for ( const [ name, script ] of [
			[ 'ssh', FAKE_SSH ],
			[ 'wp', wp ],
			[ 'php', FAKE_PHP ],
			[ 'mysql', '#!/bin/sh\n' ],
			[ 'mysqldump', '#!/bin/sh\n' ],
		] ) {
			writeFileSync( path.join( server.dir, name ), script );
			chmodSync( path.join( server.dir, name ), 0o755 );
		}
		vi.stubEnv( 'PATH', `${ server.dir }${ path.delimiter }${ process.env.PATH }` );
		vi.stubEnv( 'HOME', server.dir );
		// Worker threads don't pass a stubbed HOME to os.homedir(), which would be the user's own.
		vi.spyOn( os, 'homedir' ).mockReturnValue( server.dir );
		vi.stubEnv( 'FAKE_SSH_ARGS', path.join( server.dir, 'args' ) );
		writeFileSync( path.join( server.dir, 'studio-wp-cli.phar' ), 'phar' );
		vi.stubEnv( 'STUDIO_WP_CLI_PHAR', path.join( server.dir, 'studio-wp-cli.phar' ) );
	} );
	afterEach( () => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		rmSync( server.dir, { recursive: true, force: true } );
	} );
	return server;
}
