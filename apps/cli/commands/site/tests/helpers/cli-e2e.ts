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

// Where each run's daemon logs are kept for post-mortems (gitignored; CI uploads it as a build
// artifact). Resolved from the repo root so the artifact glob in .buildkite/pipeline.yml matches
// no matter which directory vitest runs from.
const DAEMON_LOGS_ARCHIVE_DIR = path.resolve(
	import.meta.dirname,
	'../../../../../..',
	'test-results',
	'cli-e2e-daemon-logs'
);
const MAX_ARCHIVED_LOG_BYTES = 20 * 1024 * 1024;

export function cleanupCliEnv( env: CliEnv ): void {
	preserveDaemonLogs( env );
	fs.rmSync( env.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } );
	fs.rmSync( env.daemonHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } );
}

/**
 * Copies the run's daemon logs (the WordPress server child's stdout/stderr) out of the env
 * before it is deleted. They are the only record of why a server died: the CLI's own stderr
 * rarely says more than "exited unexpectedly".
 */
function preserveDaemonLogs( env: CliEnv ): void {
	const logsDir = path.join( env.daemonHome, 'logs' );
	try {
		if ( ! fs.existsSync( logsDir ) ) {
			return;
		}
		const archiveDir = path.join( DAEMON_LOGS_ARCHIVE_DIR, path.basename( env.daemonHome ) );
		for ( const entry of fs.readdirSync( logsDir, { withFileTypes: true } ) ) {
			if ( ! entry.isFile() ) {
				continue;
			}
			const source = path.join( logsDir, entry.name );
			// A child stuck in a logging loop can emit hundreds of MB in seconds; don't ship that.
			if ( fs.statSync( source ).size > MAX_ARCHIVED_LOG_BYTES ) {
				console.warn( `Skipping oversized daemon log ${ source }` );
				continue;
			}
			fs.mkdirSync( archiveDir, { recursive: true } );
			fs.copyFileSync( source, path.join( archiveDir, entry.name ) );
		}
	} catch ( error ) {
		// Best effort: losing a log copy must never fail the test run.
		console.warn( `Could not preserve daemon logs from ${ logsDir }:`, error );
	}
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
 * Logs in as the site's admin through the `/studio-auto-login` mu-plugin and
 * returns the auth cookies as a `Cookie` header value, so a plain `fetch` can
 * request admin-only pages. Mirrors the desktop suite's auto-login.
 */
export async function autoLoginCookie( siteUrl: string ): Promise< string > {
	const loginUrl = new URL( '/studio-auto-login', siteUrl );
	loginUrl.searchParams.set( 'redirect_to', '/wp-admin/' );

	const response = await fetch( loginUrl, { redirect: 'manual' } );
	const cookies = ( response.headers.getSetCookie?.() ?? [] )
		.map( ( cookie ) => cookie.split( ';' )[ 0 ] )
		.filter( Boolean );

	if ( cookies.length === 0 ) {
		throw new Error( `Auto-login returned no cookies (status ${ String( response.status ) }).` );
	}
	return cookies.join( '; ' );
}

/**
 * Polls a URL until the freshly started server responds (redirects not followed). Pass
 * `expectedStatus` to also poll past interim responses like the proxy's warm-up 302.
 */
export async function waitForSiteResponse(
	url: string,
	{
		timeoutMs = 30_000,
		intervalMs = 500,
		expectedStatus,
	}: { timeoutMs?: number; intervalMs?: number; expectedStatus?: number } = {}
): Promise< Response > {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	let lastResponse: Response | undefined;

	while ( Date.now() < deadline ) {
		try {
			lastResponse = await fetch( url, { redirect: 'manual' } );
			if ( expectedStatus === undefined || lastResponse.status === expectedStatus ) {
				return lastResponse;
			}
		} catch ( error ) {
			lastError = error;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, intervalMs ) );
	}

	if ( lastResponse ) {
		return lastResponse;
	}
	throw new Error( `Timed out waiting for a response from ${ url }: ${ String( lastError ) }` );
}
