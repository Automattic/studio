/**
 * Finds the Studio and the Studio CLI a run uses. Only Node built-ins, so
 * `doctor` and `setup` can run before the repo's dependencies are installed.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export const HARNESS_DIR = path.resolve( import.meta.dirname, '..' );
export const REPO_ROOT = path.resolve( HARNESS_DIR, '../..' );
export const REPO_CLI = path.join( REPO_ROOT, 'apps/cli/dist/cli/main.mjs' );
export const REPO_STUDIO = path.join( REPO_ROOT, 'apps/studio' );

const PLATFORMS: Partial< Record< NodeJS.Platform, { packaged: string; resources: string } > > = {
	darwin: {
		packaged: 'Studio.app/Contents/MacOS/Studio',
		resources: 'Electron.app/Contents/Resources',
	},
	linux: { packaged: 'studio', resources: 'resources' },
	win32: { packaged: 'Studio.exe', resources: 'resources' },
};

export function platform() {
	const found = PLATFORMS[ process.platform ];
	if ( ! found ) {
		throw new Error( `Unsupported platform: ${ process.platform }` );
	}
	return found;
}

const INSTALLED_MAC_APP = '/Applications/Studio.app/Contents/MacOS/Studio';

// The build `npm run package` writes to apps/studio/out/ in this repo.
const packagedApp = () =>
	path.join(
		REPO_ROOT,
		'apps/studio/out',
		`Studio-${ process.platform }-${ process.arch }`,
		platform().packaged
	);

export type StudioApp =
	| { kind: 'dir'; path: string; source: string }
	| { kind: 'exe'; path: string; source: string };

/**
 * The Studio Desktop a run drives: `STUDIO_APP_DIR` (an unpackaged build,
 * run in a copy of this repo's Electron), `STUDIO_APP` (an executable), a
 * packaged build of this repo, this repo's unpackaged build (`setup` makes
 * one), or on macOS the installed app.
 */
export function findStudioApp( env = process.env ): StudioApp | null {
	if ( env.STUDIO_APP_DIR ) {
		const dir = [
			path.resolve( env.STUDIO_APP_DIR ),
			path.resolve( REPO_ROOT, env.STUDIO_APP_DIR ),
		].find( ( candidate ) => existsSync( path.join( candidate, 'package.json' ) ) );
		return {
			kind: 'dir',
			path: dir ?? path.resolve( env.STUDIO_APP_DIR ),
			source: 'STUDIO_APP_DIR',
		};
	}
	if ( env.STUDIO_APP ) {
		return { kind: 'exe', path: env.STUDIO_APP, source: 'STUDIO_APP' };
	}
	if ( existsSync( packagedApp() ) ) {
		return { kind: 'exe', path: packagedApp(), source: 'npm run package' };
	}
	if ( existsSync( path.join( REPO_STUDIO, 'dist/main/index.js' ) ) ) {
		return { kind: 'dir', path: REPO_STUDIO, source: 'the apps/studio build' };
	}
	if ( process.platform === 'darwin' && existsSync( INSTALLED_MAC_APP ) ) {
		return { kind: 'exe', path: INSTALLED_MAC_APP, source: 'installed' };
	}
	return null;
}

/** The resources folder of a packaged Studio executable, where its CLI ships. */
function resourcesOf( executable: string ) {
	return process.platform === 'darwin'
		? path.resolve( path.dirname( executable ), '../Resources' )
		: path.join( path.dirname( executable ), 'resources' );
}

/**
 * The Studio CLI that creates a run's sites and serves `studio ui`:
 * `STUDIO_CLI` (a `main.mjs`), this repo's build (`npm run cli:build`), or
 * the CLI inside the packaged or installed Studio, so a machine with Studio
 * installed needs no build at all.
 */
export function findCli( env = process.env ): { path: string; source: string } | null {
	if ( env.STUDIO_CLI ) {
		return { path: path.resolve( env.STUDIO_CLI ), source: 'STUDIO_CLI' };
	}
	if ( existsSync( REPO_CLI ) ) {
		return { path: REPO_CLI, source: 'npm run cli:build' };
	}
	const app = findStudioApp( env );
	if ( app?.kind === 'exe' ) {
		const bundled = path.join( resourcesOf( app.path ), 'cli', 'main.mjs' );
		if ( existsSync( bundled ) ) {
			return { path: bundled, source: `the CLI inside ${ app.path }` };
		}
	}
	return null;
}

export function cliMain( env = process.env ) {
	const cli = findCli( env );
	if ( ! cli ) {
		throw new Error(
			'No Studio CLI found. Run `npm run cli:build` at the repo root, install Studio, or set STUDIO_CLI. `npx studio-capture doctor` lists what is missing.'
		);
	}
	return cli.path;
}
