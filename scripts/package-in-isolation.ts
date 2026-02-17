/**
 * This script packages the Studio app in isolation by copying the repo to a temporary directory,
 * installing dependencies, running studio-app's package script, copying output back to the repo,
 * and cleaning up.
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

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync, type SpawnSyncOptions } from 'child_process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const REPO_ROOT = path.resolve( __dirname, '..' );

function parseArgs( argv: string[] ) {
	return yargs( hideBin( argv ) )
		.scriptName( 'package-in-isolation' )
		.usage( '$0 [--platform=<platform> --arch=<arch>]' )
		.option( 'platform', {
			type: 'string',
			describe: 'Target platform',
			choices: [ 'darwin', 'win32' ] as const,
		} )
		.option( 'arch', {
			type: 'string',
			describe: 'Target architecture',
			choices: [ 'x64', 'arm64' ] as const,
		} )
		.strict()
		.help( false )
		.version( false )
		.parseSync();
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

function runPackageScript( cwd: string, arch?: 'x64' | 'arm64', platform?: 'darwin' | 'win32' ) {
	const args = [ '-w', 'studio-app', 'run', 'package', '--' ];

	if ( arch ) {
		args.push( `--arch=${ arch }` );
	}

	if ( platform ) {
		args.push( `--platform=${ platform }` );
	}

	runOrFail( 'npm', args, cwd );
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
		fs.cpSync( from, to, { recursive: true, force: true } );
	}
}

function main() {
	const target = parseArgs( process.argv );

	const isCi = process.env.CI && process.env.CI !== 'false';
	if ( isCi ) {
		console.log( 'Detected CI environment; running package in place.' );
		runPackageScript( REPO_ROOT, target.arch, target.platform );
		return;
	}

	const stagingParent = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-package-' ) );
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

		console.log( 'Running package in packaging directory ...' );
		runPackageScript( stagingRoot, target.arch, target.platform );

		console.log( 'Syncing packaging artifacts back to workspace ...' );
		copyArtifactsBack( stagingRoot );
	} finally {
		console.log( `Removing packaging directory ${ stagingParent }` );
		fs.rmSync( stagingParent, { recursive: true, force: true } );
	}
}

main();
