import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { cliMain } from './locate.ts';

// Studio's own WordPress and PHP caches. Linking them into the profile lets the
// CLI create sites offline and without re-downloading PHP; it only reads them.
export const REAL_STUDIO_DIR = path.join( homedir(), '.studio' );
const SHARED_CACHES = [ 'server-files', 'php-bin' ];

export interface Profile {
	dirs: {
		root: string;
		appData: string;
		home: string;
		sites: string;
		cliConfig: string;
		sharedConfig: string;
		userData: string;
		daemon: string;
	};
	// The home directory as Studio may display it, for the path tidying.
	homes: string[];
	env: NodeJS.ProcessEnv;
	remove(): Promise< void >;
}

/**
 * A throwaway Studio profile. Studio's E2E mode (the `E2E_*` env vars,
 * honoured by release builds) points its app data, home, and CLI config at
 * these directories, and `--user-data-dir` gives Electron its own
 * single-instance lock, so this runs alongside a Studio the user already has
 * open. Nothing in the user's real profile is read or written, except the
 * WordPress and PHP caches, which are linked in: the CLI reads them, and would
 * add a WordPress or PHP version it lacks there, as the user's Studio does.
 *
 * The CLI daemon and its events socket get their own directory too, so the
 * user's running Studio keeps its connection. Windows daemons use fixed,
 * system-wide pipe names that cannot be isolated this way.
 */
export async function createProfile(): Promise< Profile > {
	cliMain();
	const root = await mkdtemp( path.join( tmpdir(), 'studio-capture-' ) );
	const dirs = {
		root,
		appData: path.join( root, 'appData', 'Studio' ),
		home: path.join( root, 'home' ),
		sites: path.join( root, 'home', 'Studio' ),
		cliConfig: path.join( root, 'cliConfig' ),
		sharedConfig: path.join( root, 'sharedConfig' ),
		userData: path.join( root, 'userData' ),
		// Kept short and directly under tmpdir: the daemon's sockets are Unix
		// domain sockets, limited to ~104 characters on macOS.
		daemon: await mkdtemp( path.join( tmpdir(), 'sdd-' ) ),
	};
	for ( const dir of Object.values( dirs ) ) {
		await mkdir( dir, { recursive: true } );
	}
	for ( const cache of SHARED_CACHES ) {
		const real = path.join( REAL_STUDIO_DIR, cache );
		if ( existsSync( real ) ) {
			await symlink( real, path.join( dirs.sharedConfig, cache ), 'junction' );
		}
	}
	// A recent dependency check keeps the CLI from looking for WordPress updates.
	await writeFile(
		path.join( dirs.cliConfig, 'cli.json' ),
		JSON.stringify( { version: 1, sites: [], snapshots: [], lastDependencyCheckTime: Date.now() } )
	);
	// Scripts match English accessible names; without a saved locale Studio
	// falls back to the OS language.
	await writeFile(
		path.join( dirs.sharedConfig, 'shared.json' ),
		JSON.stringify( { version: 1, locale: 'en' }, null, 2 )
	);

	// Set when this runs from a terminal inside an Electron app; Studio would
	// start as plain Node.
	const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;

	return {
		dirs,
		homes: [ ...new Set( [ dirs.home, await realpath( dirs.home ) ] ) ],
		env: {
			...env,
			E2E: 'true',
			E2E_APP_DATA_PATH: path.dirname( dirs.appData ),
			E2E_HOME_PATH: dirs.home,
			// The CLI's default site folder (`studio ui` creates sites through it).
			E2E_SITES_ROOT: dirs.sites,
			E2E_CLI_CONFIG_PATH: dirs.cliConfig,
			E2E_SHARED_CONFIG_PATH: dirs.sharedConfig,
			DEV_CONFIG_DIR: dirs.sharedConfig,
			STUDIO_PROCESS_MANAGER_HOME: dirs.daemon,
		},
		async remove() {
			for ( const dir of [ dirs.daemon, root ] ) {
				await rm( dir, { recursive: true, force: true, maxRetries: 3 } ).catch( () => {} );
			}
		},
	};
}
