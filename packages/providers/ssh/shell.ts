import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { __, sprintf } from '@wordpress/i18n';
import { RemoteSiteError } from '../errors';
import type { SshTarget } from './address';
import type { Readable } from 'node:stream';

// POSIX single quotes: everything inside is literal, except a quote, which closes and reopens them.
export function shellQuote( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

// What Studio needs to reach a connected site: where it is, how WP-CLI runs there, and where the
// site keeps its content.
export interface SshConnection extends SshTarget {
	wpCli: string;
	contentDir: string;
}

// Shell lines that move into the site's folder and define `studio_wp`, which runs WP-CLI there.
export function inSite( { path, wpCli }: Pick< SshConnection, 'path' | 'wpCli' > ): string {
	return `cd ${ shellQuote( path ) }
studio_wp() { ${ wpCli } "$@" --skip-plugins --skip-themes; }`;
}

/**
 * Shell lines that set `$dir` to the folder of a push or pull named `run`: in the login user's home,
 * unless the site's folder holds it, where the web server might serve what's in it.
 */
export function syncFolder( sitePath: string, run: string ): string {
	return `root=$(cd ${ shellQuote( sitePath ) } && pwd -P)
home=$(cd ~ && pwd -P)
case "$home/" in "$root"/*) base=\${TMPDIR:-/tmp} ;; *) base=$home ;; esac
dir="$base/.studio-sync/${ run }"`;
}

// Windows ships the OpenSSH client, which an app's PATH doesn't always include.
export function sshExecutable(): string {
	const bundled =
		process.platform === 'win32' && process.env.SystemRoot
			? path.join( process.env.SystemRoot, 'System32', 'OpenSSH', 'ssh.exe' )
			: undefined;
	return bundled && existsSync( bundled ) ? bundled : 'ssh';
}

function sshArgs(
	{ destination, port }: SshTarget,
	command: string,
	acceptNewHostKey = false,
	compress = false
): string[] {
	// One connection per command: a shared master (ControlMaster) keeps the command's pipes open
	// after it exits. Without a terminal or prompts, a key ssh can't use fails instead of waiting.
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

function sshError( target: SshTarget, exitCode: number | null, stderr: string ): RemoteSiteError {
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
					'WP-CLI wasn’t found on %s. Install it from wp-cli.org, or set the command that runs it.'
				),
				target.destination
			),
			'ssh_wp_cli'
		);
	}
	return new RemoteSiteError( detail || __( 'The command on the server failed.' ), 'ssh_command' );
}

/**
 * Runs a shell command on the server with the user's own `ssh`, so their keys, agent, config and
 * known hosts apply. Resolves with its output; rejects with a RemoteSiteError that says what to fix.
 */
export function runSsh(
	target: SshTarget,
	command: string,
	options: {
		acceptNewHostKey?: boolean;
		// Compresses what the connection carries, for output that isn't compressed already.
		compress?: boolean;
		signal?: AbortSignal;
		stdin?: Readable;
		// Takes the output instead of the returned string.
		stdout?: WritableStream< Uint8Array >;
	} = {}
): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn(
			sshExecutable(),
			sshArgs( target, command, options.acceptNewHostKey, options.compress ),
			{
				stdio: [ options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe' ],
				signal: options.signal,
			}
		);
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
		child.on( 'error', ( error: NodeJS.ErrnoException ) =>
			reject(
				error.code === 'ENOENT'
					? new RemoteSiteError(
							process.platform === 'win32'
								? __(
										'Studio needs the OpenSSH client. Add it in Settings → System → Optional features, then try again.'
								  )
								: __( 'Studio needs the ssh command. Install an OpenSSH client, then try again.' ),
							'ssh_missing'
					  )
					: error
			)
		);
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
