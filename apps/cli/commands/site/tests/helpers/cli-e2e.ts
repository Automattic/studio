/**
 * Harness for real end-to-end CLI integration tests.
 *
 * Spawns the built CLI binary (`dist/cli/main.mjs`) against an isolated config
 * directory so tests exercise the real `studio site create` flow — real file
 * copying, real `cli.json` persistence — without mocking, touching the
 * developer's `~/.studio`, or needing the desktop app.
 */
import { execFileSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import semver from 'semver';
import { getProcessManagerPaths } from 'cli/lib/paths';
import { SocketRequestClient } from 'cli/lib/socket';
import cliPackageJson from '../../../../package.json';

// `dist/cli/main.mjs` relative to this file (apps/cli/commands/site/tests/helpers).
const CLI_MAIN = path.resolve( import.meta.dirname, '../../../../dist/cli/main.mjs' );

// The real bundled WordPress that ships with Studio. `getServerFilesPath()`
// derives from the config directory, so the harness symlinks this into the
// isolated config dir to let `--wp latest` copy it offline and deterministically.
const REAL_SERVER_FILES = path.join( os.homedir(), '.studio', 'server-files' );
const BUNDLED_LATEST_WP = path.join( REAL_SERVER_FILES, 'wordpress-versions', 'latest' );
// Native PHP binaries are downloaded on first use; sharing the real cache means
// each run downloads a given version at most once instead of per isolated env.
// The CLI also rewrites each version's php.ini there, with the link resolved so
// the file never names this temporary directory.
const REAL_PHP_BIN = path.join( os.homedir(), '.studio', 'php-bin' );

export interface CliEnv {
	root: string;
	configDir: string;
	sitesDir: string;
	daemonHome: string;
	basePort?: number;
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
 * Creates an isolated config + sites directory for a single CLI run. `basePort` sets where the
 * CLI starts looking for free site ports (STUDIO_BASE_PORT). `ownServerFiles` starts from an empty
 * `server-files`, like a new install, instead of sharing the real one.
 */
export function setupCliEnv( {
	basePort,
	ownServerFiles = false,
}: { basePort?: number; ownServerFiles?: boolean } = {} ): CliEnv {
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
	if ( ownServerFiles ) {
		fs.mkdirSync( path.join( configDir, 'server-files' ) );
	} else {
		fs.symlinkSync( REAL_SERVER_FILES, path.join( configDir, 'server-files' ), 'junction' );
	}
	fs.mkdirSync( REAL_PHP_BIN, { recursive: true } );
	fs.symlinkSync( REAL_PHP_BIN, path.join( configDir, 'php-bin' ), 'junction' );

	// Pre-seed the config with a recent dependency-check timestamp so the spawned
	// CLI skips its 24h WordPress-version update: keeps the run offline and
	// deterministic, and avoids writing through the server-files symlink. Seeded
	// as the `cli.json` of earlier builds, so a previous CLI release reads it too
	// and the current one imports it.
	fs.writeFileSync(
		path.join( configDir, 'cli.json' ),
		JSON.stringify( {
			version: 1,
			sites: [],
			snapshots: [],
			lastDependencyCheckTime: Date.now(),
		} )
	);

	return { root, configDir, sitesDir, daemonHome, basePort };
}

export function cleanupCliEnv( env: CliEnv ): void {
	// CI sets this to keep the daemon logs, which record why a site process died, for upload.
	const keptLogsDir = process.env.STUDIO_E2E_DAEMON_LOGS_DIR;
	const daemonLogsDir = path.join( env.daemonHome, 'logs' );
	if ( keptLogsDir && fs.existsSync( daemonLogsDir ) ) {
		try {
			fs.cpSync( daemonLogsDir, path.resolve( keptLogsDir, path.basename( env.daemonHome ) ), {
				recursive: true,
			} );
		} catch {
			// Best effort: missing diagnostics must not fail the test.
		}
	}
	fs.rmSync( env.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } );
	fs.rmSync( env.daemonHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } );
}

// Sends Node's requests to a closed port, so the CLI runs as if offline. The sites stay reachable.
const OFFLINE_ENV = {
	NODE_USE_ENV_PROXY: '1',
	HTTP_PROXY: 'http://127.0.0.1:9',
	HTTPS_PROXY: 'http://127.0.0.1:9',
	NO_PROXY: 'localhost,127.0.0.1,[::1]',
};

/**
 * Runs the built CLI, or the one at `cliMain`, with the given arguments against the isolated
 * environment. Resolves with the exit code and captured output once the process exits.
 */
export function runCli(
	args: string[],
	env: CliEnv,
	{ cliMain = CLI_MAIN, offline = false }: { cliMain?: string; offline?: boolean } = {}
): Promise< CliResult > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( process.execPath, [ cliMain, ...args ], {
			// Non-TTY stdio so the CLI runs fully non-interactively.
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			env: {
				...process.env,
				DEV_CONFIG_DIR: env.configDir,
				STUDIO_PROCESS_MANAGER_HOME: env.daemonHome,
				// Isolate the legacy Electron appdata dir too, which ignores DEV_CONFIG_DIR:
				// the config import would otherwise read a real appdata-v1.json.
				E2E: '1',
				E2E_APP_DATA_PATH: env.root,
				...( env.basePort ? { STUDIO_BASE_PORT: String( env.basePort ) } : {} ),
				...( offline ? OFFLINE_ENV : {} ),
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
 * Installs the newest `wp-studio` release older than this CLI from npm, and returns the path of
 * its `main.mjs`. Releases before 2.1.0 are skipped: on Windows they listen on the same named
 * pipes whatever STUDIO_PROCESS_MANAGER_HOME says, so their daemon can't be isolated.
 */
export function installPreviousCli(): { version: string; cliMain: string } {
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const npmOptions = { encoding: 'utf8', shell: process.platform === 'win32' } as const;
	const versions: string[] = JSON.parse(
		execFileSync( npm, [ 'view', 'wp-studio', 'versions', '--json' ], npmOptions )
	);
	const version = semver.maxSatisfying(
		versions,
		`>=2.1.0 <${ semver.coerce( cliPackageJson.version ) }`
	);
	if ( ! version ) {
		throw new Error( `No wp-studio release older than ${ cliPackageJson.version } on npm.` );
	}

	const prefix = path.join( os.tmpdir(), `studio-cli-e2e-wp-studio-${ version }` );
	const cliMain = path.join( prefix, 'node_modules', 'wp-studio', 'dist', 'cli', 'main.mjs' );
	if ( ! fs.existsSync( cliMain ) ) {
		execFileSync(
			npm,
			[
				'install',
				'--prefix',
				prefix,
				`wp-studio@${ version }`,
				'--ignore-scripts',
				'--no-audit',
				'--no-fund',
			],
			npmOptions
		);
	}
	return { version, cliMain };
}

/**
 * Sends a request to the isolated environment's process-manager daemon and returns its payload.
 */
export async function daemonRequest(
	env: CliEnv,
	request: { type: 'ping' } | { type: 'list-processes' }
): Promise< Record< string, unknown > > {
	const client = new SocketRequestClient(
		getProcessManagerPaths( env.daemonHome ).controlSocketPath,
		5_000
	);
	const response = ( await client.sendAndWaitForResponse( {
		...request,
		requestId: randomUUID(),
	} ) ) as { type: string; payload?: Record< string, unknown >; error?: { message: string } };
	if ( response.type === 'error' ) {
		throw new Error( response.error?.message );
	}
	return response.payload ?? {};
}

/**
 * Gives the config back to a previous CLI release, which refuses one this CLI imported: its sites
 * and previews go back to a `cli.json`, which this CLI imports again on its next command.
 */
export function handConfigBackToPreviousCli( env: CliEnv ): void {
	const { sites, snapshots } = readConfigFile( env );
	fs.writeFileSync(
		path.join( env.configDir, 'cli.json' ),
		JSON.stringify( { version: 1, sites, snapshots, lastDependencyCheckTime: Date.now() } )
	);
	for ( const name of [ 'config.json', 'shared.json', 'app.json', 'legacy-config' ] ) {
		fs.rmSync( path.join( env.configDir, name ), { recursive: true, force: true } );
	}
}

/**
 * Reads the persisted config file from the isolated environment, or the `cli.json` a previous CLI
 * release keeps until this one imports it.
 */
export function readConfigFile( env: CliEnv ): {
	sites: Array< Record< string, unknown > >;
	[ key: string ]: unknown;
} {
	const configPath = path.join( env.configDir, 'config.json' );
	const file = fs.existsSync( configPath ) ? configPath : path.join( env.configDir, 'cli.json' );
	return JSON.parse( fs.readFileSync( file, 'utf-8' ) );
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
