/**
 * `doctor` checks what a capture needs on this machine and names the fix for
 * each missing piece; `setup` makes those fixes. Both use only Node
 * built-ins, so they run on a fresh clone before `npm install`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { REPO_CLI, REPO_ROOT, REPO_STUDIO, findCli, findStudioApp } from './locate.ts';
import type { DriverName } from './drivers/types.ts';

export interface Check {
	name: string;
	status: 'ok' | 'missing' | 'optional';
	detail: string;
	fix?: string;
	// Which front ends need it; both when unset.
	for?: DriverName;
}

const has = ( command: string ) =>
	! spawnSync( command, [ '--version' ], { stdio: 'ignore' } ).error;

const nodeMajor = () => Number( process.versions.node.split( '.' )[ 0 ] );

const installed = ( pkg: string ) =>
	existsSync( path.join( REPO_ROOT, 'node_modules', pkg, 'package.json' ) );

/** Where Playwright keeps the browsers it downloads. */
function playwrightCache() {
	return (
		process.env.PLAYWRIGHT_BROWSERS_PATH ??
		{
			darwin: path.join( homedir(), 'Library/Caches/ms-playwright' ),
			win32: path.join( process.env.LOCALAPPDATA ?? '', 'ms-playwright' ),
		}[ process.platform as string ] ??
		path.join( homedir(), '.cache/ms-playwright' )
	);
}

/**
 * The Chromium builds the installed Playwright launches. A cache can hold
 * others (a sandbox image's own, an older install) that it won't use.
 */
function playwrightChromiumDirs() {
	const manifest = path.join( REPO_ROOT, 'node_modules/playwright-core/browsers.json' );
	if ( ! existsSync( manifest ) ) {
		return [];
	}
	const { browsers } = JSON.parse( readFileSync( manifest, 'utf8' ) ) as {
		browsers: { name: string; revision: string }[];
	};
	return browsers
		.filter(
			( browser ) => browser.name === 'chromium' || browser.name === 'chromium-headless-shell'
		)
		.map( ( browser ) => `${ browser.name.replace( /-/g, '_' ) }-${ browser.revision }` );
}

const hasPlaywrightChromium = () => {
	const dirs = playwrightChromiumDirs();
	return (
		dirs.length > 0 && dirs.every( ( dir ) => existsSync( path.join( playwrightCache(), dir ) ) )
	);
};

/** A PHP binary in `dir`, or in one of its version folders, as `~/.studio/php-bin` keeps them. */
function phpBinaryIn( dir: string ) {
	const exe = process.platform === 'win32' ? 'php.exe' : 'php';
	if ( ! existsSync( dir ) ) {
		return undefined;
	}
	return [ dir, ...readdirSync( dir ).map( ( name ) => path.join( dir, name ) ) ]
		.map( ( candidate ) => path.join( candidate, exe ) )
		.find( ( candidate ) => existsSync( candidate ) );
}

const PHP_BIN_DIR = path.join( homedir(), '.studio', 'php-bin' );

/**
 * The repo's WordPress server files missing from the CLI build: the build
 * copies `wp-files`, so a build made before `npm install` finished lacks some.
 */
function missingFromCliBuild() {
	const source = path.join( REPO_ROOT, 'wp-files' );
	const built = path.join( path.dirname( REPO_CLI ), 'wp-files' );
	if ( ! existsSync( source ) ) {
		return [];
	}
	return readdirSync( source ).filter(
		( name ) => ! name.startsWith( '.' ) && ! existsSync( path.join( built, name ) )
	);
}

/**
 * Whether `npm install` ran to the end. Its postinstall downloads WordPress,
 * then the other server files, the agent skills and last PHP, so a failed
 * download leaves the first of them in place and the rest missing.
 */
const dependenciesComplete = () =>
	installed( 'playwright' ) &&
	existsSync( path.join( REPO_ROOT, 'wp-files/sqlite-database-integration' ) ) &&
	existsSync( path.join( REPO_ROOT, 'wp-files/skills' ) ) &&
	phpBinaryIn( PHP_BIN_DIR ) !== undefined;

function electronReady() {
	const dir = path.join( REPO_ROOT, 'node_modules/electron' );
	const pathFile = path.join( dir, 'path.txt' );
	return (
		existsSync( pathFile ) &&
		existsSync( path.join( dir, 'dist', readFileSync( pathFile, 'utf8' ).trim() ) )
	);
}

/** Everything a capture can need, and whether this machine has it. */
export function doctor( env = process.env ): Check[] {
	const checks: Check[] = [];
	const add = ( check: Check ) => checks.push( check );

	add(
		nodeMajor() >= 24
			? { name: 'Node.js', status: 'ok', detail: process.versions.node }
			: {
					name: 'Node.js',
					status: 'missing',
					detail: `${ process.versions.node }; the repo needs 24 or later`,
					fix: 'Install Node.js 24 (for example `nvm install 24`).',
			  }
	);

	const deps = [ 'playwright', 'zod', 'sharp', 'pixelmatch' ].filter(
		( pkg ) => ! installed( pkg )
	);
	add(
		deps.length
			? {
					name: 'Dependencies',
					status: 'missing',
					detail: `not installed: ${ deps.join( ', ' ) }`,
					fix: '`npm install` at the repo root (it also downloads the WordPress files and PHP).',
			  }
			: { name: 'Dependencies', status: 'ok', detail: 'installed at the repo root' }
	);

	const cli = findCli( env );
	if ( ! cli ) {
		add( {
			name: 'Studio CLI',
			status: 'missing',
			detail: 'no build, no STUDIO_CLI and no installed Studio',
			fix: '`npm run cli:build:ui` at the repo root (or `npx studio-capture setup`).',
		} );
	} else if (
		cli.path === REPO_CLI &&
		( ! existsSync(
			path.join( path.dirname( REPO_CLI ), 'wp-files/sqlite-database-integration' )
		) ||
			missingFromCliBuild().length )
	) {
		add( {
			name: 'Studio CLI',
			status: 'missing',
			detail: `${ cli.path } was built without all the WordPress server files${
				missingFromCliBuild().length ? ` (missing ${ missingFromCliBuild().join( ', ' ) })` : ''
			}, so it can't create sites`,
			fix: '`npm install` at the repo root (its postinstall downloads them), then `npx studio-capture setup --rebuild`.',
		} );
	} else {
		add( { name: 'Studio CLI', status: 'ok', detail: `${ cli.path } (${ cli.source })` } );
	}

	const php = [ PHP_BIN_DIR, ...( cli ? [ path.join( path.dirname( cli.path ), 'php' ) ] : [] ) ]
		.map( phpBinaryIn )
		.find( Boolean );
	add(
		php
			? { name: 'PHP', status: 'ok', detail: path.dirname( php ) }
			: {
					name: 'PHP',
					status: 'missing',
					detail: 'no PHP binary in ~/.studio/php-bin or next to the CLI',
					fix: '`npm install` at the repo root (its postinstall downloads PHP to ~/.studio/php-bin last, so a failed download earlier in it skips PHP).',
			  }
	);

	const ui = cli && path.join( path.dirname( cli.path ), 'ui' );
	add(
		ui && existsSync( ui ) && readdirSync( ui ).some( ( name ) => name.endsWith( '.html' ) )
			? { name: 'studio ui app', status: 'ok', detail: ui, for: 'browser' }
			: {
					name: 'studio ui app',
					status: 'missing',
					detail: 'the CLI has no built browser app',
					fix: '`npm run cli:build:ui` at the repo root.',
					for: 'browser',
			  }
	);

	add(
		hasPlaywrightChromium()
			? {
					name: 'Chromium',
					status: 'ok',
					detail: `${ playwrightChromiumDirs().join( ', ' ) } in ${ playwrightCache() }`,
			  }
			: {
					name: 'Chromium',
					status: 'missing',
					detail: `Playwright's Chromium (${
						playwrightChromiumDirs().join( ', ' ) || 'the build it needs'
					}) isn't in ${ playwrightCache() } (it runs the browser driver and takes thumbnails)`,
					fix: `\`npx playwright install chromium${
						process.platform === 'linux' ? ' --with-deps' : ''
					}\`.`,
			  }
	);

	const app = findStudioApp( env );
	if ( ! app ) {
		add( {
			name: 'Studio Desktop',
			status: 'missing',
			detail: 'no build of apps/studio, no STUDIO_APP and no installed Studio',
			fix: '`npx studio-capture setup --driver electron` builds it.',
			for: 'electron',
		} );
	} else if ( app.kind === 'dir' ) {
		const built = existsSync( path.join( app.path, 'dist/main/index.js' ) );
		add(
			built && electronReady()
				? {
						name: 'Studio Desktop',
						status: 'ok',
						detail: `${ app.path } (${ app.source })`,
						for: 'electron',
				  }
				: {
						name: 'Studio Desktop',
						status: 'missing',
						detail: built ? "Electron's binary isn't downloaded" : `${ app.path } isn't built`,
						fix: built
							? '`node node_modules/electron/install.js` at the repo root.'
							: '`npx studio-capture setup --driver electron`.',
						for: 'electron',
				  }
		);
	} else {
		add( {
			name: 'Studio Desktop',
			status: existsSync( app.path ) ? 'ok' : 'missing',
			detail: `${ app.path } (${ app.source })`,
			fix: existsSync( app.path ) ? undefined : 'Point STUDIO_APP at the Studio executable.',
			for: 'electron',
		} );
	}

	if ( process.platform === 'linux' ) {
		add(
			env.DISPLAY || has( 'Xvfb' )
				? {
						name: 'Display',
						status: 'ok',
						detail: env.DISPLAY ? `DISPLAY=${ env.DISPLAY }` : 'Xvfb (started automatically)',
						for: 'electron',
				  }
				: {
						name: 'Display',
						status: 'missing',
						detail: 'no DISPLAY and no Xvfb, which Studio Desktop needs on Linux',
						fix: '`npx studio-capture setup --driver electron` (as root) installs xvfb, or use `--driver browser`.',
						for: 'electron',
				  }
		);
	}

	add(
		has( env.FFMPEG_PATH ?? 'ffmpeg' )
			? { name: 'ffmpeg', status: 'ok', detail: env.FFMPEG_PATH ?? 'on PATH' }
			: {
					name: 'ffmpeg',
					status: 'optional',
					detail: 'only MP4 recordings need it (WebM uses the one Playwright downloads)',
					fix: 'Install ffmpeg, or set FFMPEG_PATH.',
			  }
	);

	const token = env.STUDIO_CAPTURE_AUTH_TOKEN ?? env.STUDIO_DOCS_AUTH_TOKEN;
	add(
		token
			? { name: 'WordPress.com login', status: 'ok', detail: 'STUDIO_CAPTURE_AUTH_TOKEN is set' }
			: {
					name: 'WordPress.com login',
					status: 'optional',
					detail: env.CI
						? 'signed-in scripts need STUDIO_CAPTURE_AUTH_TOKEN in CI'
						: 'signed-in scripts use STUDIO_CAPTURE_AUTH_TOKEN, else the local Studio login',
					fix: "Set STUDIO_CAPTURE_AUTH_TOKEN to the demo account's token (the `authToken` of a Studio shared.json).",
			  }
	);
	return checks;
}

/** Whether every check the front ends in `drivers` need passes. */
export function ready( checks: Check[], drivers: DriverName[] ) {
	return checks.every(
		( check ) =>
			check.status !== 'missing' || ( check.for !== undefined && ! drivers.includes( check.for ) )
	);
}

export function formatChecks( checks: Check[] ) {
	const mark = { ok: '✓', missing: '✗', optional: '–' };
	return checks
		.map(
			( check ) =>
				`${ mark[ check.status ] } ${ check.name }${ check.for ? ` (${ check.for })` : '' }: ${
					check.detail
				}${ check.status !== 'ok' && check.fix ? `\n    fix: ${ check.fix }` : '' }`
		)
		.join( '\n' );
}

// System packages Studio Desktop and Chromium need on a bare Debian or Ubuntu
// image, plus fonts so pages without their own render alike everywhere.
// Installed one by one: names differ between releases (libasound2t64).
const LINUX_PACKAGES = [
	'xvfb',
	'xauth',
	'libgtk-3-0',
	'libgtk-3-0t64',
	'libnss3',
	'libgbm1',
	'libasound2',
	'libasound2t64',
	'libxss1',
	'libxtst6',
	'libnotify4',
	'libsecret-1-0',
	'fonts-liberation',
	'fonts-noto-color-emoji',
];

/**
 * Behind a proxy (`HTTPS_PROXY`, as in most cloud sandboxes), Node's own
 * `fetch` in the download scripts goes through it only when told to.
 */
function childEnv(): NodeJS.ProcessEnv {
	const env = process.env;
	const proxied = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
	return proxied ? { ...env, NODE_USE_ENV_PROXY: env.NODE_USE_ENV_PROXY ?? '1' } : env;
}

function run( command: string, args: string[], log: ( message: string ) => void, cwd = REPO_ROOT ) {
	log( `$ ${ [ command, ...args ].join( ' ' ) }` );
	const result = spawnSync( command, args, { cwd, stdio: 'inherit', env: childEnv() } );
	if ( result.status !== 0 ) {
		throw new Error(
			`\`${ [ command, ...args ].join( ' ' ) }\` failed (${
				result.status ?? result.error?.message
			}).`
		);
	}
}

/**
 * Installs and builds what the front ends in `drivers` need, skipping what
 * is already there (`rebuild` builds the CLI and the app again): the repo's
 * dependencies, the CLI with its browser app, Playwright's Chromium, and for
 * Studio Desktop Electron and the app itself, plus on Linux (as root) the
 * system libraries and xvfb.
 */
export function setup(
	{ drivers, rebuild = false }: { drivers: DriverName[]; rebuild?: boolean },
	log: ( message: string ) => void
) {
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
	const linuxRoot = process.platform === 'linux' && process.getuid?.() === 0;

	if ( linuxRoot && has( 'apt-get' ) ) {
		log( 'Installing system packages...' );
		run( 'apt-get', [ 'update', '-qq' ], log );
		for ( const pkg of LINUX_PACKAGES ) {
			spawnSync( 'apt-get', [ 'install', '-y', '-qq', '--no-install-recommends', pkg ], {
				stdio: 'ignore',
			} );
		}
	}

	if ( ! dependenciesComplete() ) {
		log( 'Installing the repo dependencies (this downloads WordPress and PHP too)...' );
		run( npm, [ 'install', '--no-audit', '--no-fund' ], log );
	}

	const uiBuilt = existsSync( path.join( path.dirname( REPO_CLI ), 'ui' ) );
	if ( rebuild || ! existsSync( REPO_CLI ) || ! uiBuilt || missingFromCliBuild().length ) {
		log( 'Building the CLI and its browser app...' );
		run( npm, [ 'run', 'cli:build:ui' ], log );
	}

	if ( ! hasPlaywrightChromium() ) {
		log( 'Downloading Chromium...' );
		run(
			npx,
			[ 'playwright', 'install', 'chromium', ...( linuxRoot ? [ '--with-deps' ] : [] ) ],
			log
		);
	}

	if ( drivers.includes( 'electron' ) ) {
		if ( ! electronReady() ) {
			log( 'Downloading Electron...' );
			run( process.execPath, [ 'node_modules/electron/install.js' ], log );
		}
		if ( rebuild || ! existsSync( path.join( REPO_STUDIO, 'dist/main/index.js' ) ) ) {
			log( 'Building Studio Desktop...' );
			// As in the README: from apps/studio, like its own build scripts.
			run(
				npx,
				[ 'electron-vite', 'build', '--config', './electron.vite.config.ts', '--outDir=dist' ],
				log,
				REPO_STUDIO
			);
			run(
				process.execPath,
				[ '--experimental-strip-types', '../../scripts/build-ui-renderer.ts' ],
				log,
				REPO_STUDIO
			);
		}
	}
}
