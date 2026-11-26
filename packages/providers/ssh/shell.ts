import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { __, sprintf } from '@wordpress/i18n';
import { RemoteSiteError } from '../errors';
import type { SshTarget } from './address';
import type { Readable } from 'node:stream';

type SshHost = Omit< SshTarget, 'path' >;

// POSIX single quotes: everything inside is literal, except a quote, which closes and reopens them.
export function shellQuote( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

// What Studio needs to reach a connected site: where it is, how PHP runs there, and where the site
// keeps its content.
export interface SshConnection extends SshTarget {
	php: string;
	contentDir: string;
}

/**
 * Shell lines that set `$base` to where Studio keeps its files on the server: the login user's home,
 * unless the site's folder holds it, where the web server might serve them.
 */
function studioBase( sitePath: string ): string {
	return `root=$(cd ${ shellQuote( sitePath ) } && pwd -P)
home=$(cd ~ && pwd -P)
case "$home/" in "$root"/*) base=\${TMPDIR:-/tmp} ;; *) base=$home ;; esac`;
}

// Shell lines that set `$dir` to the folder of a push or pull named `run`.
export function syncFolder( sitePath: string, run: string ): string {
	return `${ studioBase( sitePath ) }
dir="$base/.studio-sync/${ run }"`;
}

/**
 * Shell lines that move into the site's folder and define `studio_wp`, which runs Studio's WP-CLI
 * there, the phar `uploadWpCli` named. Its global flags come before the command, where a server that
 * sets `WP_CLI_STRICT_ARGS_MODE` accepts them. Hosts such as WordPress.com and Pressable keep
 * WordPress itself in a folder of its own, which the site's `wp-load.php` links into.
 */
export function inSite(
	{ path, php }: Pick< SshConnection, 'path' | 'php' >,
	wpCli: string
): string {
	return `${ studioBase( path ) }
cd ${ shellQuote( path ) }
studio_core=
if [ ! -e wp-includes/version.php ] && [ -L wp-load.php ]; then
	studio_core=$(dirname "$(readlink wp-load.php)")
	case "$studio_core" in /*) ;; *) studio_core=${ shellQuote( path ) }/$studio_core ;; esac
fi
studio_wp() { ${ php } "$base/.studio-sync/${ wpCli }" \${studio_core:+"--path=$studio_core"} $( [ "$(id -u)" != 0 ] || echo --allow-root ) --skip-plugins --skip-themes "$@"; }`;
}

// Windows ships the OpenSSH client, which an app's PATH doesn't always include.
export function sshExecutable(): string {
	const bundled =
		process.platform === 'win32' && process.env.SystemRoot
			? path.join( process.env.SystemRoot, 'System32', 'OpenSSH', 'ssh.exe' )
			: undefined;
	return bundled && existsSync( bundled ) ? bundled : 'ssh';
}

interface ConnectOptions {
	acceptNewHostKey?: boolean;
	// The socket of a shared connection to go through, or to open as its master.
	control?: string;
	master?: boolean;
}

function sshArgs(
	{ destination, port }: SshHost,
	command: string,
	{
		acceptNewHostKey = false,
		compress = false,
		control,
		master = false,
	}: ConnectOptions & { compress?: boolean }
): string[] {
	// Without a terminal or prompts, a key ssh can't use fails instead of waiting.
	const options = [
		'BatchMode=yes',
		`StrictHostKeyChecking=${ acceptNewHostKey ? 'accept-new' : 'yes' }`,
		'ConnectTimeout=15',
		'ServerAliveInterval=15',
		'ServerAliveCountMax=8',
		'LogLevel=ERROR',
		'RequestTTY=no',
		'RemoteCommand=none',
		'ClearAllForwardings=yes',
		...( control
			? [ `ControlPath=${ control }`, `ControlMaster=${ master ? 'yes' : 'no' }` ]
			: [] ),
		// A master left behind, by a crash, closes once it has been idle for 5 minutes.
		...( master ? [ 'ControlPersist=300' ] : [] ),
	];
	return [
		'-T',
		...( compress ? [ '-C' ] : [] ),
		...options.flatMap( ( option ) => [ '-o', option ] ),
		...( port ? [ '-p', String( port ) ] : [] ),
		'--',
		destination,
		command,
	];
}

function sshError( target: SshHost, exitCode: number | null, stderr: string ): RemoteSiteError {
	const hostname = target.destination.replace( /^.*@/, '' );
	// How known_hosts names it: a host on another port is `[host]:port`.
	const host = target.port ? `[${ hostname }]:${ target.port }` : hostname;
	const detail =
		stderr
			.trim()
			.split( '\n' )
			.pop()
			?.replace( /^Error:\s*/, '' ) ?? '';
	if ( exitCode === 255 ) {
		if ( stderr.includes( 'Host key verification failed' ) ) {
			return new RemoteSiteError(
				stderr.includes( 'CHANGED' )
					? sprintf(
							// translators: %s: a server's host name
							__(
								"The SSH host key of %1$s changed. If the server was set up again, remove its old key with `ssh-keygen -R '%1$s'`, then connect the site again."
							),
							host
					  )
					: sprintf(
							// translators: %s: a server's host name
							__(
								'This computer doesn’t know the SSH host key of %s yet. Connect the site again.'
							),
							host
					  ),
				'ssh_host_key'
			);
		}
		if ( stderr.includes( 'Permission denied' ) ) {
			return new RemoteSiteError(
				sprintf(
					// translators: %s: an SSH destination, such as deploy@example.com
					__(
						'%s didn’t accept your SSH key. Studio connects without prompts: `ssh %s` needs to work in a terminal without asking for a password, with a passphrase-protected key loaded in ssh-agent.'
					),
					target.destination,
					target.destination
				),
				'ssh_auth'
			);
		}
		return new RemoteSiteError(
			sprintf(
				// translators: 1: an SSH destination, 2: the error ssh reported
				__( 'Could not connect to %1$s over SSH: %2$s' ),
				target.destination,
				detail
			),
			'ssh_connect'
		);
	}
	if ( exitCode === 127 ) {
		return new RemoteSiteError(
			sprintf(
				// translators: %s: an SSH destination
				__(
					'PHP wasn’t found on %s. Install it, or set the command that runs it when you connect the site.'
				),
				target.destination
			),
			'ssh_wp_cli'
		);
	}
	return new RemoteSiteError( detail || __( 'The command on the server failed.' ), 'ssh_command' );
}

function spawnError( error: NodeJS.ErrnoException ): Error {
	if ( error.code !== 'ENOENT' ) {
		return error;
	}
	return new RemoteSiteError(
		process.platform === 'win32'
			? __(
					'Studio needs the OpenSSH client. Add it in Settings → System → Optional features, then try again.'
			  )
			: __( 'Studio needs the ssh command. Install an OpenSSH client, then try again.' ),
		'ssh_missing'
	);
}

interface RunOptions {
	// Compresses what the connection carries, for output that isn't compressed already.
	compress?: boolean;
	signal?: AbortSignal;
	stdin?: Readable;
	// Takes the output instead of the returned string.
	stdout?: WritableStream< Uint8Array >;
}

/**
 * Runs a shell command on the server with the user's own `ssh`, so their keys, agent, config and
 * known hosts apply. Resolves with its output; rejects with a RemoteSiteError that says what to fix.
 */
export function runSsh(
	target: SshHost,
	command: string,
	options: RunOptions & ConnectOptions = {}
): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( sshExecutable(), sshArgs( target, command, options ), {
			stdio: [ options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe' ],
			signal: options.signal,
		} );
		if ( options.stdin && child.stdin ) {
			// The command may exit before it reads everything; its exit code says what happened.
			child.stdin.on( 'error', () => undefined );
			options.stdin.pipe( child.stdin );
		}
		let stdout = '';
		let stderr = '';
		const output = options.stdout?.getWriter();
		child.stdout!.on( 'data', ( chunk: Buffer ) => {
			if ( ! output ) {
				stdout += chunk;
				return;
			}
			child.stdout!.pause();
			output.write( chunk ).then( () => child.stdout!.resume(), reject );
		} );
		child.stderr!.on( 'data', ( chunk: Buffer ) => ( stderr += chunk ) );
		child.on( 'error', ( error ) => reject( spawnError( error ) ) );
		child.on( 'close', ( exitCode ) => {
			if ( exitCode !== 0 ) {
				void output?.abort().catch( () => undefined );
				reject( sshError( target, exitCode, stderr ) );
			} else if ( output ) {
				output.close().then( () => resolve( '' ), reject );
			} else {
				resolve( stdout );
			}
		} );
	} );
}

/*
 * Signs in once and leaves a master connection in the background, which the commands of one push,
 * pull or connection share. Windows' OpenSSH can't share a connection: there, each command connects.
 */
async function openShared(
	target: SshHost,
	acceptNewHostKey: boolean
): Promise< string | undefined > {
	if ( process.platform === 'win32' ) {
		return undefined;
	}
	const control = path.join( os.tmpdir(), `studio-ssh-${ randomBytes( 6 ).toString( 'hex' ) }` );
	await new Promise< void >( ( resolve, reject ) => {
		const child = spawn(
			sshExecutable(),
			sshArgs( target, 'true', { acceptNewHostKey, control, master: true } ),
			{ stdio: [ 'ignore', 'ignore', 'pipe' ] }
		);
		let stderr = '';
		child.stderr!.on( 'data', ( chunk: Buffer ) => ( stderr += chunk ) );
		child.on( 'error', ( error ) => reject( spawnError( error ) ) );
		// Once signed in, the first command exits while the master, in the background, still holds
		// its stderr: `close` would wait for the master.
		child.on( 'exit', ( exitCode ) => {
			if ( exitCode === 0 ) {
				child.stderr!.destroy();
				resolve();
			}
		} );
		child.on( 'close', ( exitCode ) => {
			if ( exitCode !== 0 ) {
				reject( sshError( target, exitCode, stderr ) );
			}
		} );
	} );
	return control;
}

function closeShared( { destination }: SshHost, control: string ): Promise< void > {
	return new Promise( ( resolve ) => {
		spawn( sshExecutable(), [ '-O', 'exit', '-o', `ControlPath=${ control }`, '--', destination ], {
			stdio: 'ignore',
		} )
			.on( 'error', () => resolve() )
			.on( 'close', () => resolve() );
	} );
}

export interface Ssh {
	// Runs a command over the shared connection.
	run( command: string, options?: RunOptions ): Promise< string >;
	// Runs a command that moves an archive, on a connection of its own: a shared one slows it to a
	// crawl.
	transfer( command: string, options?: RunOptions ): Promise< string >;
}

// Runs the commands of one push, pull or connection over one connection to the server.
export async function withSsh< T >(
	target: SshHost,
	operation: ( ssh: Ssh ) => Promise< T >,
	{ acceptNewHostKey = false }: { acceptNewHostKey?: boolean } = {}
): Promise< T > {
	const control = await openShared( target, acceptNewHostKey );
	try {
		return await operation( {
			run: ( command, options ) =>
				runSsh( target, command, { ...options, acceptNewHostKey, control } ),
			transfer: ( command, options ) => runSsh( target, command, { ...options, acceptNewHostKey } ),
		} );
	} finally {
		if ( control ) {
			await closeShared( target, control );
		}
	}
}

// Studio's own WP-CLI, which each Studio process names in STUDIO_WP_CLI_PHAR, named by its hash.
let studioWpCli: { file: string; name: Promise< string > } | undefined;
function studioWpCliName( file: string ): Promise< string > {
	if ( studioWpCli?.file !== file ) {
		const name = readFile( file ).then(
			( phar ) =>
				`wp-cli-${ createHash( 'sha256' ).update( phar ).digest( 'hex' ).slice( 0, 12 ) }.phar`
		);
		studioWpCli = { file, name };
	}
	return studioWpCli.name;
}

/**
 * Puts Studio's WP-CLI on the server, in the folder Studio keeps there, unless it's there already,
 * and removes the ones older Studio versions put there. Resolves with its file name, for `inSite`.
 * One WP-CLI everywhere behaves the same on every server, whichever one the host installed.
 */
export async function uploadWpCli(
	ssh: Ssh,
	site: Pick< SshConnection, 'destination' | 'path' | 'php' >
): Promise< string > {
	const file = process.env.STUDIO_WP_CLI_PHAR;
	if ( ! file || ! existsSync( file ) ) {
		throw new RemoteSiteError(
			__( 'WordPress Studio’s copy of WP-CLI is missing. Install WordPress Studio again.' ),
			'ssh_wp_cli'
		);
	}
	const name = await studioWpCliName( file );
	const phar = `"$base/.studio-sync/${ name }"`;
	const state = (
		await ssh.run( `${ studioBase( site.path ) }
if ! command -v ${ site.php.split( ' ' )[ 0 ] } >/dev/null 2>&1; then echo php
elif [ -s ${ phar } ]; then echo ready
fi` )
	)
		.trim()
		.split( '\n' )
		.pop();
	if ( state === 'php' ) {
		throw new RemoteSiteError(
			sprintf(
				// translators: 1: a command, such as php, 2: an SSH destination, such as deploy@example.com
				__(
					'Studio runs WP-CLI on the server with PHP, but %2$s has no %1$s command. Install PHP there, or set the command that runs it when you connect the site.'
				),
				site.php,
				site.destination
			),
			'ssh_php'
		);
	}
	if ( state !== 'ready' ) {
		await ssh.transfer(
			`set -e
${ studioBase( site.path ) }
mkdir -p "$base/.studio-sync"
cat > ${ phar }.part
mv ${ phar }.part ${ phar }
for old in "$base"/.studio-sync/wp-cli-*.phar; do [ "$old" = ${ phar } ] || rm -f "$old"; done`,
			{ stdin: createReadStream( file ) }
		);
	}
	return name;
}
