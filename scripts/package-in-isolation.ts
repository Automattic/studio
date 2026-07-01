/**
 * This script packages the Studio app in isolation by copying the repo to a temporary directory,
 * installing dependencies, running the relevant make/package script, copying the output back to
 * the repo and then cleaning up.
 *
 * Why is this needed? With npm workspaces, most dependencies are hoisted to the top-level
 * `node_modules` directory, but there's no guarantee that all of them are. This behavior conflicts
 * with our requirement of having self-contained `node_modules` directories for each package that
 * are copied to the package output.
 *
 * In other words, when we run `npm run install:bundle` in `apps/studio`, that mutates the
 * `apps/studio/node_modules` directory so the npm workspace-powered dependency tree gets messed
 * up. We can't avoid running `npm run install:bundle`, because we need that self-contained
 * `node_modules` directory for packaging, so that's why we do it in isolation.
 *
 * In CI, where we have a clean, ephemeral environment, we short-circuit the behavior and run the
 * relevant script in place.
 *
 * Local packaging installs the build toolchain with a lockfile-accurate `npm ci --ignore-scripts`
 * and reuses bundled WordPress/server files when they already exist. Set `STUDIO_PACKAGE_FRESH=1`
 * to run a full `npm ci` instead, with postinstall re-downloading all bundled files.
 */

import { spawnSync, type SpawnSyncOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

const REPO_ROOT = path.resolve( import.meta.dirname, '..' );
const STUDIO_APP_PACKAGE_JSON = path.join( REPO_ROOT, 'apps', 'studio', 'package.json' );
const COPY_MODE = fs.constants.COPYFILE_FICLONE;
const BUILD_OUTPUT_DIRS = new Set( [ 'out', 'dist', 'test-results' ] );
const useFreshLocalPackage = process.env.STUDIO_PACKAGE_FRESH === '1';

const STUDIO_APP_PACKAGE_JSON_SCHEMA = z.object( {
	scripts: z.record( z.string(), z.string() ),
} );

function getStudioAppScripts(): Record< string, string > {
	const studioAppPackage = JSON.parse( fs.readFileSync( STUDIO_APP_PACKAGE_JSON, 'utf-8' ) );
	const parsedPackage = STUDIO_APP_PACKAGE_JSON_SCHEMA.parse( studioAppPackage );
	return Object.fromEntries(
		Object.entries( parsedPackage.scripts ).filter(
			( [ scriptName ] ) => scriptName === 'package' || scriptName.startsWith( 'make' )
		)
	);
}

function runOrFail( command: string, args: string[], cwd: string ) {
	const options: SpawnSyncOptions = {
		cwd,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	};

	const result = spawnSync( command, args, options );
	if ( result.status !== 0 ) {
		throw new Error( `Command failed: ${ [ command, ...args ].join( ' ' ) }` );
	}
}

function ensureBuildToolchain( stagingRoot: string ) {
	if ( useFreshLocalPackage ) {
		console.log( 'Installing lockfile-fresh workspace dependencies in packaging directory ...' );
		runOrFail( 'npm', [ 'ci' ], stagingRoot );
		return;
	}

	// `--ignore-scripts` skips the root postinstall, which would re-download bundled server files
	// the staging copy already has. The postinstall steps that are still required (patches, fs-ext
	// binary filtering) run explicitly below.
	console.log( 'Installing workspace dependencies in packaging directory ...' );
	runOrFail(
		'npm',
		[ 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--no-progress' ],
		stagingRoot
	);
	runOrFail( 'npx', [ 'patch-package', '--patch-dir', 'apps/studio/patches' ], stagingRoot );
	runOrFail( 'node', [ './scripts/remove-fs-ext-other-platform-binaries.mjs' ], stagingRoot );
}

function hasBundledServerFiles( repoRoot: string ): boolean {
	// Marker paths for artifacts produced by download-wp-server-files.ts,
	// download-available-site-translations.mjs, download-agent-skills.ts, and the
	// data-liberation workspace build. The packaging install uses `--ignore-scripts`,
	// so these don't run via the root postinstall and must be triggered here.
	const requiredPaths = [
		'wp-files/latest/wordpress/wp-includes/version.php',
		'wp-files/latest/available-site-translations.json',
		'wp-files/sqlite-database-integration/db.copy',
		'wp-files/wp-cli/wp-cli.phar',
		'wp-files/sqlite-command/command.php',
		'wp-files/phpmyadmin/index.php',
		'wp-files/reprint/reprint.phar',
		'wp-files/skills/wp-plugin-development/SKILL.md',
		'packages/data-liberation-agent/dist/mcp-server.js',
	];

	return requiredPaths.every( ( requiredPath ) =>
		fs.existsSync( path.join( repoRoot, requiredPath ) )
	);
}

function ensureBundledServerFiles( stagingRoot: string ) {
	if ( hasBundledServerFiles( stagingRoot ) ) {
		return;
	}

	console.log( 'Downloading missing bundled server files in packaging directory ...' );
	runOrFail( 'npx', [ 'tsx', './scripts/download-wp-server-files.ts' ], stagingRoot );
	runOrFail( 'node', [ './scripts/download-available-site-translations.mjs' ], stagingRoot );
	runOrFail( 'npx', [ 'tsx', './scripts/download-agent-skills.ts' ], stagingRoot );
	// Compile the committed Data Liberation engine workspace; the CLI build's
	// write-dist-extras plugin then bundles its dist/ into dist/cli. The engine's
	// runtime deps ship via apps/cli's own install:bundle (the engine is a CLI
	// `dependency`), so no separate per-engine node_modules is produced here.
	runOrFail( 'npm', [ '-w', 'data-liberation', 'run', 'build' ], stagingRoot );
}

function shouldCopyToStaging( sourcePath: string ): boolean {
	const relativePath = path.relative( REPO_ROOT, sourcePath );
	if ( relativePath === '' ) return true;

	const pathSegments = relativePath.split( path.sep );
	if ( pathSegments.includes( '.git' ) ) return false;
	if ( pathSegments.includes( 'node_modules' ) ) return false;
	if ( BUILD_OUTPUT_DIRS.has( pathSegments[ 0 ] ) ) return false;
	if ( pathSegments[ 0 ] === 'apps' && BUILD_OUTPUT_DIRS.has( pathSegments[ 2 ] ) ) {
		return false;
	}
	if ( pathSegments[ 0 ] === 'tools' && BUILD_OUTPUT_DIRS.has( pathSegments[ 2 ] ) ) {
		return false;
	}

	return true;
}

function moveOrCopySync( from: string, to: string ) {
	fs.rmSync( to, { recursive: true, force: true } );
	fs.mkdirSync( path.dirname( to ), { recursive: true } );

	try {
		fs.renameSync( from, to );
	} catch {
		fs.cpSync( from, to, {
			recursive: true,
			force: true,
			verbatimSymlinks: true,
			mode: COPY_MODE,
		} );
		fs.rmSync( from, { recursive: true, force: true } );
	}
}

function copyArtifactsBack( stagingRoot: string ) {
	const artifactPaths = [
		[ path.join( stagingRoot, 'out' ), path.join( REPO_ROOT, 'out' ) ],
		[
			path.join( stagingRoot, 'apps', 'studio', 'out' ),
			path.join( REPO_ROOT, 'apps', 'studio', 'out' ),
		],
		[
			path.join( stagingRoot, 'apps', 'studio', 'dist' ),
			path.join( REPO_ROOT, 'apps', 'studio', 'dist' ),
		],
	] as const;

	for ( const [ from, to ] of artifactPaths ) {
		if ( ! fs.existsSync( from ) ) continue;
		moveOrCopySync( from, to );
	}
}

function main() {
	const studioAppScripts = getStudioAppScripts();
	const scriptName = process.argv[ 2 ];

	if ( ! Object.prototype.hasOwnProperty.call( studioAppScripts, scriptName ) ) {
		throw new Error(
			`Unsupported script "${ scriptName }". Supported studio-app packaging scripts: ${ Object.keys(
				studioAppScripts
			).join( ', ' ) }`
		);
	}

	const isCi = process.env.CI && process.env.CI !== 'false';
	if ( isCi ) {
		console.log( `Detected CI environment; running script "${ scriptName }" in place.` );
		runOrFail( 'npm', [ '-w', 'studio-app', 'run', scriptName ], REPO_ROOT );
		return;
	}

	const stagingParent = fs.realpathSync.native(
		fs.mkdtempSync( path.join( os.tmpdir(), 'studio-package-' ) )
	);
	const stagingRoot = path.join( stagingParent, 'repo' );

	try {
		console.log( `Creating packaging directory at ${ stagingRoot }` );
		fs.mkdirSync( stagingRoot, { recursive: true } );
		fs.cpSync( REPO_ROOT, stagingRoot, {
			recursive: true,
			filter: shouldCopyToStaging,
			mode: COPY_MODE,
		} );

		ensureBuildToolchain( stagingRoot );
		if ( ! useFreshLocalPackage ) {
			ensureBundledServerFiles( stagingRoot );
		}

		console.log( `Running script "${ scriptName }" in packaging directory ...` );
		runOrFail( 'npm', [ '-w', 'studio-app', 'run', scriptName ], stagingRoot );

		console.log( 'Syncing packaging artifacts back to workspace ...' );
		copyArtifactsBack( stagingRoot );
	} finally {
		console.log( `Removing packaging directory ${ stagingParent }` );
		fs.rmSync( stagingParent, { recursive: true, force: true } );
	}
}

main();
