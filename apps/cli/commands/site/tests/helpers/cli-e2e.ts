/**
 * Harness for real end-to-end CLI integration tests.
 *
 * Spawns the built CLI binary (`dist/cli/main.mjs`) against an isolated config
 * directory so tests exercise the real `studio site create` flow — real file
 * copying, real `cli.json` persistence — without mocking, touching the
 * developer's `~/.studio`, or needing the desktop app.
 */
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// `dist/cli/main.mjs` relative to this file (apps/cli/commands/site/tests/helpers).
const CLI_MAIN = path.resolve( import.meta.dirname, '../../../../dist/cli/main.mjs' );

// The real bundled WordPress that ships with Studio. `getServerFilesPath()`
// derives from the config directory, so the harness symlinks this into the
// isolated config dir to let `--wp latest` copy it offline and deterministically.
const REAL_SERVER_FILES = path.join( os.homedir(), '.studio', 'server-files' );
const BUNDLED_LATEST_WP = path.join( REAL_SERVER_FILES, 'wordpress-versions', 'latest' );

export interface CliEnv {
	root: string;
	configDir: string;
	sitesDir: string;
	cliConfigPath: string;
	daemonHome: string;
}

export interface CliResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

/**
 * Whether the prerequisites for spawning the CLI are present: the built binary
 * and the bundled WordPress files. Used to skip the suite with a clear signal
 * when the CLI hasn't been built (run `npm run cli:build` first).
 */
export function cliE2ePrerequisitesMet(): boolean {
	return fs.existsSync( CLI_MAIN ) && fs.existsSync( BUNDLED_LATEST_WP );
}

/**
 * Creates an isolated config + sites directory for a single CLI run.
 */
export function setupCliEnv(): CliEnv {
	const root = path.join( os.tmpdir(), `studio-cli-e2e-${ randomUUID() }` );
	const configDir = path.join( root, 'config' );
	const sitesDir = path.join( root, 'sites' );
	// Each run gets its own process-manager daemon (via STUDIO_PROCESS_MANAGER_HOME
	// in runCli) so `site start`/`stop` never touch the developer's real daemon or
	// sites. Keep it SHORT and directly under tmpdir: the daemon's control socket is
	// a Unix domain socket (~104-char limit on macOS), so nesting under the long
	// `root` overflows it and the connection fails with EINVAL.
	const daemonHome = path.join( os.tmpdir(), `scd-${ randomUUID().slice( 0, 8 ) }` );
	fs.mkdirSync( configDir, { recursive: true } );
	fs.mkdirSync( sitesDir, { recursive: true } );
	fs.mkdirSync( daemonHome, { recursive: true } );

	// Reuse the real bundled WordPress without copying hundreds of MB. The copy
	// the CLI performs only reads from here, so the symlink is never written to.
	fs.symlinkSync( REAL_SERVER_FILES, path.join( configDir, 'server-files' ), 'junction' );

	// Pre-seed cli.json with a recent dependency-check timestamp so the spawned
	// CLI skips its 24h WordPress-version update: keeps the run offline and
	// deterministic, and avoids writing through the server-files symlink.
	const cliConfigPath = path.join( configDir, 'cli.json' );
	fs.writeFileSync(
		cliConfigPath,
		JSON.stringify( {
			version: 1,
			sites: [],
			snapshots: [],
			lastDependencyCheckTime: Date.now(),
		} )
	);

	return { root, configDir, sitesDir, cliConfigPath, daemonHome };
}

export function cleanupCliEnv( env: CliEnv ): void {
	fs.rmSync( env.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } );
	fs.rmSync( env.daemonHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } );
}

/**
 * Runs the built CLI with the given arguments against the isolated environment.
 * Resolves with the exit code and captured output once the process exits.
 */
export function runCli( args: string[], env: CliEnv ): Promise< CliResult > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( process.execPath, [ CLI_MAIN, ...args ], {
			// Non-TTY stdio so the CLI runs fully non-interactively.
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			env: {
				...process.env,
				DEV_CONFIG_DIR: env.configDir,
				STUDIO_PROCESS_MANAGER_HOME: env.daemonHome,
				// Isolate the legacy Electron appdata dir too. `getAppdataDirectory()`
				// ignores DEV_CONFIG_DIR and only honors E2E_APP_DATA_PATH, so without
				// this the Studio-compatibility migration finds a real pre-split
				// ~/Library/.../appdata-v1.json on a dev machine and exits 1.
				E2E: '1',
				E2E_APP_DATA_PATH: env.root,
			},
		} );

		let stdout = '';
		let stderr = '';
		child.stdout.on( 'data', ( chunk ) => ( stdout += chunk.toString() ) );
		child.stderr.on( 'data', ( chunk ) => ( stderr += chunk.toString() ) );
		child.on( 'error', reject );
		child.on( 'close', ( code ) => resolve( { code, stdout, stderr } ) );
	} );
}

/**
 * Reads the persisted cli.json from the isolated environment.
 */
export function readCliConfig( env: CliEnv ): {
	sites: Array< Record< string, unknown > >;
	[ key: string ]: unknown;
} {
	return JSON.parse( fs.readFileSync( env.cliConfigPath, 'utf-8' ) );
}

/**
 * Polls a URL until the server accepts a connection, then resolves with the
 * response. A freshly started site can take a moment to begin listening, so
 * this retries the connection until the deadline; once it responds, the caller
 * asserts on the status and content type. Redirects are not followed so a
 * canonical 302 is observed as-is rather than chased to its target.
 */
export async function waitForSiteResponse(
	url: string,
	{ timeoutMs = 30_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise< Response > {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;

	while ( Date.now() < deadline ) {
		try {
			return await fetch( url, { redirect: 'manual' } );
		} catch ( error ) {
			lastError = error;
			await new Promise( ( resolve ) => setTimeout( resolve, intervalMs ) );
		}
	}

	throw new Error( `Timed out waiting for a response from ${ url }: ${ String( lastError ) }` );
}
