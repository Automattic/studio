import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { ROOT, readJson } from './common.mjs';

const REPO_ROOT = path.resolve( ROOT, '..', '..' );
export const CLI_MAIN = path.join( REPO_ROOT, 'apps/cli/dist/cli/main.mjs' );

const PLATFORM = {
	darwin: {
		packaged: 'Studio.app/Contents/MacOS/Studio',
		resources: 'Electron.app/Contents/Resources',
	},
	linux: { packaged: 'studio', resources: 'resources' },
	win32: { packaged: 'Studio.exe', resources: 'resources' },
}[ process.platform ];
if ( ! PLATFORM ) {
	throw new Error( `Unsupported platform: ${ process.platform }` );
}

// The build `npm run package` writes to apps/studio/out/ in this repo, or on
// macOS the installed app when there is no build.
const PACKAGED_APP = path.join(
	REPO_ROOT,
	'apps/studio/out',
	`Studio-${ process.platform }-${ process.arch }`,
	PLATFORM.packaged
);
const DEFAULT_STUDIO_APP =
	existsSync( PACKAGED_APP ) || process.platform !== 'darwin'
		? PACKAGED_APP
		: '/Applications/Studio.app/Contents/MacOS/Studio';

const WINDOW = { width: 1440, height: 900 };

// `ORIENTATION_GUIDE_VERSION` and `WHATS_NEW_VERSION` in the Studio source,
// apps/ui/src/features/onboarding/onboarding-guide/ (2 and 1 as of 2.0).
const ORIENTATION_GUIDE_VERSION = 2;
const WHATS_NEW_VERSION = 1;

// Studio's own WordPress and PHP caches. Linking them into the profile lets the
// CLI create sites offline and without re-downloading PHP; it only reads them.
const REAL_STUDIO_DIR = path.join( homedir(), '.studio' );
const SHARED_CACHES = [ 'server-files', 'php-bin' ];

/**
 * An unpackaged build (`STUDIO_APP_DIR=apps/studio`) runs in a copy of the
 * repo's Electron, for when `npm run package` isn't available (on macOS it
 * needs Xcode). A production build looks for the CLI and a Node binary in the
 * app's resources, so the copy gets links to `apps/cli/dist/cli` and this Node.
 * The copy is cached under the temp directory, per Electron version and link
 * targets.
 */
async function prepareElectron() {
	const dist = path.join( REPO_ROOT, 'node_modules/electron/dist' );
	const electronDir = path.join( REPO_ROOT, 'node_modules/electron' );
	if ( ! existsSync( path.join( electronDir, 'path.txt' ) ) ) {
		throw new Error(
			`Electron not found in ${ dist }. Run \`node node_modules/electron/install.js\` at the repo root.`
		);
	}
	const exe = ( await readFile( path.join( electronDir, 'path.txt' ), 'utf8' ) ).trim();
	const { version } = await readJson( path.join( electronDir, 'package.json' ) );
	const links = createHash( 'sha1' )
		.update( `${ CLI_MAIN }\n${ process.execPath }` )
		.digest( 'hex' )
		.slice( 0, 8 );
	const dir = path.join( tmpdir(), `studio-docs-electron-${ version }-${ links }` );
	const ready = path.join( dir, '.ready' );
	if ( ! existsSync( ready ) ) {
		await rm( dir, { recursive: true, force: true } );
		await cp( dist, dir, { recursive: true, verbatimSymlinks: true } );
		const resources = path.join( dir, PLATFORM.resources );
		await mkdir( path.join( resources, 'bin' ), { recursive: true } );
		const node = path.join( resources, 'bin', process.platform === 'win32' ? 'node.exe' : 'node' );
		await ( process.platform === 'win32'
			? cp( process.execPath, node )
			: symlink( process.execPath, node ) );
		await symlink( path.dirname( CLI_MAIN ), path.join( resources, 'cli' ), 'junction' );
		await writeFile( ready, '' );
	}
	return path.join( dir, exe );
}

function resolveAppDir( appDir ) {
	const candidates = [ path.resolve( appDir ), path.resolve( REPO_ROOT, appDir ) ];
	const found = candidates.find( ( dir ) => existsSync( path.join( dir, 'package.json' ) ) );
	if ( ! found ) {
		throw new Error( `STUDIO_APP_DIR "${ appDir }" is not a Studio app directory.` );
	}
	if ( ! existsSync( path.join( found, 'dist/main/index.js' ) ) ) {
		throw new Error(
			`Studio build not found in ${ found }/dist. Build it first (see README.md, "Screenshots").`
		);
	}
	return found;
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
export async function createProfile() {
	if ( ! existsSync( CLI_MAIN ) ) {
		throw new Error(
			`CLI build not found at ${ CLI_MAIN }. Run \`npm run cli:build\` at the repo root.`
		);
	}
	const root = await mkdtemp( path.join( tmpdir(), 'studio-docs-shots-' ) );
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
	// The screenshot steps match English accessible names; without a saved
	// locale Studio falls back to the OS language.
	await writeFile(
		path.join( dirs.sharedConfig, 'shared.json' ),
		JSON.stringify( { version: 1, locale: 'en' }, null, 2 )
	);

	return {
		dirs,
		// The home directory as Studio may display it, for the path tidying.
		homes: [ ...new Set( [ dirs.home, await realpath( dirs.home ) ] ) ],
		env: {
			...process.env,
			E2E: 'true',
			E2E_APP_DATA_PATH: path.dirname( dirs.appData ),
			E2E_HOME_PATH: dirs.home,
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

/**
 * Initial `app.json` (Desktop state) for a launch. `firstRun` starts on the
 * Welcome dialog; otherwise onboarding and both guides are marked done. The
 * color scheme is fixed so the shots don't follow the OS appearance.
 */
function buildAppConfig( { firstRun, appData } ) {
	return {
		version: 1,
		colorScheme: 'light',
		...( firstRun
			? {}
			: {
					onboardingCompleted: true,
					onboardingHints: {
						tourDismissedVersion: ORIENTATION_GUIDE_VERSION,
						whatsNewSeenVersion: WHATS_NEW_VERSION,
					},
			  } ),
		...appData,
	};
}

/**
 * Launches Studio against a profile from `createProfile()`, in a window of a
 * fixed size so the shots match across machines.
 */
export async function launchStudio( {
	profile,
	appDir = process.env.STUDIO_APP_DIR,
	executablePath = appDir ? null : process.env.STUDIO_APP || DEFAULT_STUDIO_APP,
	firstRun = false,
	appData = {},
} ) {
	if ( appDir ) {
		appDir = resolveAppDir( appDir );
		executablePath = await prepareElectron();
	} else if ( ! executablePath || ! existsSync( executablePath ) ) {
		throw new Error(
			`Studio app not found at "${ executablePath }". Set STUDIO_APP to the Studio executable.`
		);
	}
	await writeFile(
		path.join( profile.dirs.sharedConfig, 'app.json' ),
		JSON.stringify( buildAppConfig( { firstRun, appData } ), null, 2 )
	);

	const app = await electron.launch( {
		executablePath,
		args: [
			...( appDir ? [ appDir ] : [] ),
			`--user-data-dir=${ profile.dirs.userData }`,
			// Shots are 2x whatever the display is, so they stay sharp in the docs.
			'--force-device-scale-factor=2',
		],
		env: profile.env,
		timeout: 60_000,
	} );
	const window = await app.firstWindow( { timeout: 60_000 } );
	await app.evaluate( ( { BrowserWindow }, size ) => {
		const win = BrowserWindow.getAllWindows()[ 0 ];
		win?.setContentSize( size.width, size.height );
		win?.center();
	}, WINDOW );
	await window.waitForLoadState( 'domcontentloaded' );

	return {
		app,
		window,
		version: await app.evaluate( ( { app: electronApp } ) => electronApp.getVersion() ),
		// Quitting Studio stops its daemon when no sites are running.
		close: () => app.close().catch( () => {} ),
	};
}
