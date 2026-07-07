import { spawn } from 'child_process';
import path from 'path';

/**
 * SSH transport for third-party WordPress sites.
 *
 * Studio delegates the entire connection to the system `ssh` binary so that
 * keys, agents, `~/.ssh/config` aliases, and jump hosts work exactly as they
 * do in the user's terminal — no credential is stored or handled by Studio.
 * Commands run non-interactively (`BatchMode=yes`) so a missing key fails
 * fast instead of hanging the TUI on a password prompt.
 *
 * Each command is a one-off connection. We deliberately do NOT use
 * `ControlMaster`/`ControlPersist` multiplexing: a persistent master lingers
 * in the background holding the command's stdout/stderr pipes open, so Node's
 * child `close` event never fires until the master expires (up to
 * `ControlPersist` seconds) — which froze the agent for minutes on the first
 * remote tool call. Reconnecting per command is cheap and non-interactive when
 * the key is loaded in ssh-agent. Turn-scoped connection reuse could be
 * reintroduced later, but only via a master whose stdio is detached so it
 * cannot hold command pipes.
 */

export interface SshConnection {
	// `host`, `user@host`, or an ~/.ssh/config alias.
	destination: string;
	port?: number;
	// Absolute path of the WordPress root on the remote server.
	remotePath: string;
	// WP-CLI executable on the remote; defaults to `wp` on PATH.
	wpCliPath?: string;
}

export interface SshExecOptions {
	stdin?: string;
	timeoutMs?: number;
	maxOutputBytes?: number;
	spawnImplementation?: typeof spawn;
}

export interface SshExecResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;

// `[user@]host` where host is a hostname, IPv4 address, or ssh-config alias.
// Deliberately strict: rejects whitespace, shell metacharacters, and
// option-injection via a leading `-`.
const SSH_DESTINATION_PATTERN = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidSshDestination( destination: string ): boolean {
	return SSH_DESTINATION_PATTERN.test( destination );
}

// POSIX single-quoting: safe for any byte except that embedded single quotes
// must be closed, escaped, and reopened.
export function shellQuote( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

/**
 * Normalizes an agent-supplied path relative to the WordPress root, rejecting
 * absolute paths and `..` traversal so every file operation stays jailed to
 * the site directory. Remote commands `cd` into the WordPress root first, so
 * the returned path is used as-is against that working directory (this also
 * keeps home-relative roots like `public_html` working).
 */
export function ensureRelativeSitePath( relativePath: string ): string {
	const normalized = path.posix.normalize( relativePath.replace( /\\/g, '/' ) );
	if (
		path.posix.isAbsolute( normalized ) ||
		normalized === '..' ||
		normalized.startsWith( '../' )
	) {
		throw new Error(
			`Path must be relative to the WordPress root and must not escape it: "${ relativePath }"`
		);
	}
	return normalized;
}

export function buildSshCommandArgs(
	connection: Pick< SshConnection, 'destination' | 'port' >,
	remoteCommand: string
): string[] {
	if ( ! isValidSshDestination( connection.destination ) ) {
		throw new Error( `Invalid SSH destination: "${ connection.destination }"` );
	}

	const args = [
		'-o',
		'BatchMode=yes',
		'-o',
		'StrictHostKeyChecking=accept-new',
		'-o',
		'ConnectTimeout=15',
		'-o',
		'LogLevel=ERROR',
	];

	if ( connection.port ) {
		args.push( '-p', String( connection.port ) );
	}

	args.push( '--', connection.destination, remoteCommand );
	return args;
}

/**
 * Builds a remote command that runs inside the site's WordPress root. The
 * caller is responsible for quoting every dynamic fragment of `command` with
 * `shellQuote` — only `remotePath` is quoted here.
 */
export function buildRemoteShellCommand( connection: SshConnection, command: string ): string {
	return `cd ${ shellQuote( connection.remotePath ) } && ${ command }`;
}

export async function execSsh(
	connection: Pick< SshConnection, 'destination' | 'port' >,
	remoteCommand: string,
	options: SshExecOptions = {}
): Promise< SshExecResult > {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	const spawnImplementation = options.spawnImplementation ?? spawn;

	const args = buildSshCommandArgs( connection, remoteCommand );

	return new Promise< SshExecResult >( ( resolve, reject ) => {
		const child = spawnImplementation( 'ssh', args, {
			stdio: [ options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe' ],
		} );

		let stdout = '';
		let stderr = '';
		let outputBytes = 0;
		let timedOut = false;
		let truncated = false;
		let settled = false;

		const timeout = setTimeout( () => {
			timedOut = true;
			child.kill( 'SIGTERM' );
			setTimeout( () => child.kill( 'SIGKILL' ), 5_000 ).unref();
		}, timeoutMs );

		const collect = ( chunk: Buffer, target: 'stdout' | 'stderr' ) => {
			outputBytes += chunk.length;
			if ( outputBytes > maxOutputBytes ) {
				if ( ! truncated ) {
					truncated = true;
					child.kill( 'SIGTERM' );
				}
				return;
			}
			if ( target === 'stdout' ) {
				stdout += chunk.toString( 'utf8' );
			} else {
				stderr += chunk.toString( 'utf8' );
			}
		};

		child.stdout?.on( 'data', ( chunk: Buffer ) => collect( chunk, 'stdout' ) );
		child.stderr?.on( 'data', ( chunk: Buffer ) => collect( chunk, 'stderr' ) );

		child.on( 'error', ( error: NodeJS.ErrnoException ) => {
			if ( settled ) return;
			settled = true;
			clearTimeout( timeout );
			if ( error.code === 'ENOENT' ) {
				reject(
					new Error(
						'The `ssh` command was not found. Install an OpenSSH client (on Windows: Settings → Apps → Optional features → OpenSSH Client) and try again.'
					)
				);
				return;
			}
			reject( error );
		} );

		child.on( 'close', ( exitCode ) => {
			if ( settled ) return;
			settled = true;
			clearTimeout( timeout );
			if ( timedOut ) {
				reject( new Error( `SSH command timed out after ${ Math.round( timeoutMs / 1000 ) }s` ) );
				return;
			}
			if ( truncated ) {
				reject(
					new Error(
						`SSH command output exceeded ${ maxOutputBytes } bytes and was aborted. Narrow the command (e.g. read a smaller range or add filters) and try again.`
					)
				);
				return;
			}
			resolve( { stdout, stderr, exitCode } );
		} );

		if ( options.stdin !== undefined && child.stdin ) {
			child.stdin.on( 'error', () => {
				// EPIPE when the remote command exits before consuming stdin; the
				// close handler reports the real outcome.
			} );
			child.stdin.write( options.stdin );
			child.stdin.end();
		}
	} );
}

// ssh exits with 255 for its own failures (connection, auth, host key);
// remote commands exit 127 when the shell can't find the executable.
const SSH_TRANSPORT_EXIT_CODE = 255;
const COMMAND_NOT_FOUND_EXIT_CODE = 127;

export function describeSshFailure( result: SshExecResult, connection: SshConnection ): string {
	const detail = result.stderr.trim() || result.stdout.trim();
	if ( result.exitCode === SSH_TRANSPORT_EXIT_CODE ) {
		return `Could not connect to ${ connection.destination } over SSH: ${
			detail || 'connection failed'
		}. Check the destination, and make sure key-based authentication works non-interactively (e.g. \`ssh ${
			connection.destination
		}\` in a terminal, using a key or ssh-agent — password prompts are not supported).`;
	}
	if ( result.exitCode === COMMAND_NOT_FOUND_EXIT_CODE ) {
		return `WP-CLI was not found on ${ connection.destination } (${
			detail || 'command not found'
		}). Studio manages SSH sites through WP-CLI on the server — install it (https://wp-cli.org) or set the correct executable path for this site.`;
	}
	return detail || `SSH command failed with exit code ${ result.exitCode }`;
}

export interface SshWordPressProbe {
	homeUrl: string;
	siteName: string;
}

/**
 * Verifies in one round-trip that the destination is reachable, WP-CLI exists,
 * and `remotePath` is a working WordPress install — and reads the site's home
 * URL and name while at it. Mirrors the connect-time validation used by
 * cove.run's pull/push (`ssh <dest> "cd <path> && wp option get home"`).
 */
export async function probeSshWordPressSite(
	connection: SshConnection,
	options: SshExecOptions = {}
): Promise< SshWordPressProbe > {
	const wp = shellQuote( connection.wpCliPath ?? 'wp' );
	const command = buildRemoteShellCommand(
		connection,
		`${ wp } option get home && ${ wp } option get blogname`
	);
	const result = await execSsh( connection, command, { timeoutMs: 45_000, ...options } );

	if ( result.exitCode !== 0 ) {
		throw new Error( describeSshFailure( result, connection ) );
	}

	const lines = result.stdout
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( Boolean );
	const homeUrl = lines[ 0 ];
	if ( ! homeUrl || ! /^https?:\/\//.test( homeUrl ) ) {
		throw new Error(
			`Could not read the site URL from ${ connection.remotePath } on ${ connection.destination }. Is it the root directory of a WordPress install?`
		);
	}
	return { homeUrl, siteName: lines[ 1 ] || new URL( homeUrl ).hostname };
}
