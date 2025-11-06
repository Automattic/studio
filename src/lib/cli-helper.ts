/**
 * Studio CLI Helper
 *
 * Simple helper to execute Studio CLI commands from the Electron main process.
 * Used primarily for internal commands like `proxy boot`.
 */

import { execSync } from 'child_process';
import { app } from 'electron';
import path from 'path';
import * as sudo from '@vscode/sudo-prompt';

/**
 * Get the path to the system Node.js binary
 * We need this because sudo doesn't inherit PATH
 */
function getNodePath(): string {
	// In development, use the Electron node
	if ( process.execPath.includes( 'Electron' ) && ! app.isPackaged ) {
		return process.execPath;
	}

	// In production, find the system node
	// Run which in a login shell to get the user's full PATH
	const shells = [ '/bin/zsh', '/bin/bash', '/bin/sh' ];
	for ( const shell of shells ) {
		try {
			const nodePath = execSync( `${ shell } -l -c 'which node'`, {
				encoding: 'utf-8',
			} ).trim();
			if ( nodePath && nodePath.startsWith( '/' ) ) {
				console.log( `[Studio] Found node at: ${ nodePath }` );
				return nodePath;
			}
		} catch ( error ) {
			// This shell failed, try next
			continue;
		}
	}

	// which failed, try common locations directly
	const commonPaths = [
		'/opt/homebrew/bin/node', // Apple Silicon Homebrew
		'/usr/local/bin/node', // Intel Homebrew
		'/usr/bin/node', // System
		'/opt/local/bin/node', // MacPorts
	];

	for ( const nodePath of commonPaths ) {
		try {
			execSync( `test -x "${ nodePath }"`, { encoding: 'utf-8' } );
			console.log( `[Studio] Found node at common path: ${ nodePath }` );
			return nodePath;
		} catch {
			continue;
		}
	}

	// Last resort: return a reasonable default
	console.warn( '[Studio] Could not find node, using /usr/local/bin/node as fallback' );
	return '/usr/local/bin/node';
}

/**
 * Get the path to the Studio CLI executable
 */
function getCLIPath(): string {
	if ( app.isPackaged ) {
		// In production, CLI is in extraResources
		return path.join( process.resourcesPath, 'cli', 'main.js' );
	}

	// In development, CLI is in dist
	return path.join( __dirname, '..', '..', 'dist', 'cli', 'main.js' );
}

/**
 * Execute a command with sudo privileges (prompts user for password)
 */
function execWithSudo( command: string ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const options = {
			name: 'WordPress Studio',
		};

		sudo.exec( command, options, ( error, stdout, stderr ) => {
			if ( error ) {
				console.error( '[Sudo Error]', stderr || error.message );
				reject( error );
				return;
			}

			resolve( stdout?.toString() || '' );
		} );
	} );
}

/**
 * Execute a Studio CLI command
 *
 * @param args - Command arguments (e.g., ['proxy', 'boot'])
 * @param options - Additional execution options
 * @returns Command output as string
 */
export function execStudioCLI( args: string[], options?: { timeout?: number } ): string {
	const cliPath = getCLIPath();

	// Set STUDIO_INTERNAL to bypass internal command warnings
	const env = {
		...process.env,
		STUDIO_INTERNAL: 'true',
	};

	try {
		const output = execSync( `node "${ cliPath }" ${ args.join( ' ' ) }`, {
			env,
			encoding: 'utf-8',
			timeout: options?.timeout ?? 30000, // 30 second default timeout
			stdio: [ 'pipe', 'pipe', 'pipe' ], // Capture stdout and stderr
		} );

		return output;
	} catch ( error ) {
		// execSync throws on non-zero exit code
		if ( error instanceof Error && 'stdout' in error ) {
			const execError = error as { stdout: Buffer; stderr: Buffer; status: number };
			console.error(
				'[Studio CLI Error]',
				execError.stderr?.toString() || execError.stdout?.toString()
			);
		}
		throw error;
	}
}

/**
 * Execute Studio CLI command asynchronously (returns immediately)
 *
 * @param args - Command arguments (e.g., ['proxy', 'boot'])
 */
export async function execStudioCLIAsync( args: string[] ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		try {
			const output = execStudioCLI( args );
			resolve( output );
		} catch ( error ) {
			reject( error );
		}
	} );
}

/**
 * Boot the proxy infrastructure (PM2 + HTTP/HTTPS proxy)
 * This is idempotent - safe to call multiple times
 * Requires sudo - will prompt user for password
 */
export async function bootProxyInfrastructure(): Promise< void > {
	try {
		console.log( '[Studio] Booting proxy infrastructure...' );

		const cliPath = getCLIPath();

		// First check if proxy is already running (no sudo needed for this check)
		const checkCommand = `STUDIO_INTERNAL=true node "${ cliPath }" pm2 status`;
		try {
			const statusOutput = execStudioCLI( [ 'pm2', 'status' ] );
			// If output contains "studio-proxy" and shows it's running, we're done
			if (
				statusOutput.includes( 'studio-proxy' ) &&
				! statusOutput.includes( 'No processes found' )
			) {
				console.log( '[Studio] Proxy is already running, skipping boot' );
				return;
			}
		} catch ( error ) {
			// PM2 daemon might not be running yet, continue with boot
			console.log( '[Studio] PM2 daemon not running, will start it' );
		}

		// Proxy not running, need to boot it with sudo
		// Use full path to node because sudo doesn't inherit PATH
		const nodePath = getNodePath();
		const bootCommand = `STUDIO_INTERNAL=true "${ nodePath }" "${ cliPath }" proxy boot`;

		// Execute with sudo - this will show OS password prompt
		await execWithSudo( bootCommand );

		console.log( '[Studio] Proxy infrastructure ready' );
	} catch ( error ) {
		console.error( '[Studio] Failed to boot proxy infrastructure:', error );
		throw error;
	}
}
