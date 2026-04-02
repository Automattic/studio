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
 */

import { spawnSync, type SpawnSyncOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

const REPO_ROOT = path.resolve( __dirname, '..' );
const STUDIO_APP_PACKAGE_JSON = path.join( REPO_ROOT, 'apps', 'studio', 'package.json' );

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
		process.exit( result.status ?? 1 );
	}
}

function shouldCopyToStaging( sourcePath: string ): boolean {
	const relativePath = path.relative( REPO_ROOT, sourcePath );
	if ( relativePath === '' ) return true;

	const pathSegments = relativePath.split( path.sep );
	if ( pathSegments.includes( '.git' ) ) return false;
	if ( pathSegments.includes( 'node_modules' ) ) return false;

	const topLevelDir = pathSegments[ 0 ];
	return topLevelDir !== 'out' && topLevelDir !== 'dist' && topLevelDir !== 'test-results';
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
		fs.rmSync( to, { recursive: true, force: true } );
		fs.mkdirSync( path.dirname( to ), { recursive: true } );
		fs.cpSync( from, to, { recursive: true, force: true, verbatimSymlinks: true } );
	}
}

function main() {
	const studioAppScripts = getStudioAppScripts();
	const scriptName = process.argv[ 2 ];

	if ( ! studioAppScripts.hasOwnProperty( scriptName ) ) {
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
		} );

		console.log( 'Installing workspace dependencies in packaging directory ...' );
		runOrFail( 'npm', [ 'ci' ], stagingRoot );

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
