#!/usr/bin/env ts-node
/**
 * Creates a standalone Studio CLI binary.
 *
 * The CLI bundle and node_modules are embedded as assets inside the Node binary.
 * On first run, the entry point extracts them to ~/.studio/cli/.
 *
 * Output:
 *   standalone-bundles/studio-cli-{platform}-{arch}[.exe]
 *   standalone-bundles/studio-cli-{platform}-{arch}[.exe].sha256
 *
 * Prerequisites: Node.js >= 24, npm dependencies installed
 *
 * NOTE: The `cli:package` step mutates `apps/cli/node_modules`. If you need a
 * clean tree afterwards, run `npm ci` from the repo root to reset it.
 *
 * Usage:
 *   npx ts-node scripts/create-standalone-bundle.ts
 *   npx ts-node scripts/create-standalone-bundle.ts darwin arm64
 *   npx ts-node scripts/create-standalone-bundle.ts win32 x64
 */

import { execSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const repoRoot = path.join( __dirname, '..' );

const platformArg = process.argv[ 2 ] || process.platform;
const archArg = process.argv[ 3 ] || process.arch;

const supportedPlatforms = [ 'darwin', 'linux', 'win32' ];
const supportedArchs = [ 'x64', 'arm64' ];

if ( ! supportedPlatforms.includes( platformArg ) ) {
	console.error(
		`Unsupported platform: ${ platformArg }. Supported: ${ supportedPlatforms.join( ', ' ) }`
	);
	process.exit( 1 );
}

if ( ! supportedArchs.includes( archArg ) ) {
	console.error(
		`Unsupported architecture: ${ archArg }. Supported: ${ supportedArchs.join( ', ' ) }`
	);
	process.exit( 1 );
}

const isWindows = platformArg === 'win32';
const isDarwin = platformArg === 'darwin';
const bundleName = `studio-cli-${ platformArg }-${ archArg }${ isWindows ? '.exe' : '' }`;
const outputDir = path.join( repoRoot, 'standalone-bundles' );
const nodeBinDir = path.join( repoRoot, 'apps', 'studio', 'bin' );
const bundleDir = path.join( repoRoot, 'apps', 'cli', 'bundle' );
const bundleBuildDir = path.join( bundleDir, 'build' );
const cliDistDir = path.join( repoRoot, 'apps', 'cli', 'dist', 'cli' );

// Convert Windows paths to POSIX for tar (backslashes and colons cause issues)
function posix( p: string ): string {
	return p.split( path.sep ).join( '/' );
}

function run( cmd: string, cwd?: string ): void {
	execSync( cmd, { cwd: cwd ?? repoRoot, stdio: 'inherit' } );
}

function sha256( file: string ): string {
	return createHash( 'sha256' ).update( fs.readFileSync( file ) ).digest( 'hex' );
}

// Create a gzipped tarball by streaming tar's stdout to a file. Keeping the
// archive path out of tar's argv avoids GNU tar (Git Bash / Buildkite Windows)
// interpreting "C:" as a remote host ("Cannot connect to C: resolve failed").
// BSD tar (macOS, Windows 10+) handles it either way.
function createTarball( archivePath: string, cwd: string, extraArgs: string[] ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( 'tar', [ '-cz', ...extraArgs, '.' ], {
			cwd,
			stdio: [ 'ignore', 'pipe', 'inherit' ],
		} );
		const out = fs.createWriteStream( archivePath );
		child.stdout.pipe( out );
		out.on( 'error', reject );
		child.on( 'error', reject );
		child.on( 'close', ( code ) => {
			if ( code === 0 ) {
				resolve();
			} else {
				reject( new Error( `tar exited with code ${ code }` ) );
			}
		} );
	} );
}

async function main(): Promise< void > {
	console.log( `==> Building standalone binary: ${ bundleName }\n` );

	// Step 1: Build CLI
	console.log( '==> Step 1/5: Building CLI package...' );
	run( 'npm run cli:package' );

	// Step 2: Download Node binary for target platform
	console.log( `\n==> Step 2/5: Downloading Node.js binary for ${ platformArg }-${ archArg }...` );
	run( `npx ts-node scripts/download-node-binary.ts ${ platformArg } ${ archArg }` );

	// Step 3: Create bundle assets (tarballs of CLI bundle + node_modules)
	console.log( '\n==> Step 3/5: Creating bundle assets...' );
	fs.rmSync( bundleBuildDir, { recursive: true, force: true } );
	fs.mkdirSync( bundleBuildDir, { recursive: true } );

	// CLI bundle (JS files, wp-files, etc. — excludes node_modules).
	// We stream tar's output to a file via Node rather than passing the archive
	// path to tar directly — that keeps "C:" out of tar's argv, which GNU tar
	// on Windows would otherwise interpret as a remote host.
	const cliTarFullPath = path.join( bundleBuildDir, 'cli.tar.gz' );
	await createTarball( cliTarFullPath, cliDistDir, [ '--exclude=node_modules' ] );

	// node_modules — use source node_modules (not dist) because externalized
	// native packages have transitive deps (e.g. ws, ini) that they need at runtime.
	// Strip browser dirs to save space. Keep asyncify as fallback for JSPI.
	const cliNodeModules = path.join( repoRoot, 'apps', 'cli', 'node_modules' );
	const nmTarFullPath = path.join( bundleBuildDir, 'node_modules.tar.gz' );
	await createTarball( nmTarFullPath, cliNodeModules, [
		'--exclude=.cache',
		'--exclude=playwright/browsers',
		'--exclude=playwright-core/browsers',
	] );

	const cliSize = ( fs.statSync( cliTarFullPath ).size / 1024 / 1024 ).toFixed( 1 );
	const nmSize = ( fs.statSync( nmTarFullPath ).size / 1024 / 1024 ).toFixed( 1 );
	console.log( `   CLI bundle: ${ cliSize } MB, node_modules: ${ nmSize } MB` );

	// Derive bundle-version from tarball hashes so the runtime can detect
	// when embedded assets change and trigger re-extraction automatically.
	// 16 hex chars = 64 bits — collision-resistant enough for a cache key,
	// short enough to read at a glance in logs.
	const bundleVersion = createHash( 'sha256' )
		.update( sha256( cliTarFullPath ) )
		.update( sha256( nmTarFullPath ) )
		.digest( 'hex' )
		.slice( 0, 16 );
	fs.writeFileSync( path.join( bundleBuildDir, 'bundle-version.txt' ), bundleVersion );

	// Step 4: Generate bundle blob
	console.log( '\n==> Step 4/5: Generating bundle blob...' );
	run( 'node --experimental-sea-config config.json', bundleDir );

	// Step 5: Inject bundle blob into Node binary
	console.log( '\n==> Step 5/5: Injecting bundle blob into Node binary...' );
	fs.mkdirSync( outputDir, { recursive: true } );

	const nodeBinary = isWindows ? 'node.exe' : 'node';
	const outputPath = path.join( outputDir, bundleName );

	fs.copyFileSync( path.join( nodeBinDir, nodeBinary ), outputPath );
	if ( ! isWindows ) {
		fs.chmodSync( outputPath, 0o755 );
	}

	// macOS: remove code signature before injection
	if ( isDarwin ) {
		run( `codesign --remove-signature "${ outputPath }"` );
	}

	// Inject the bundle blob
	const blobPath = path.join( bundleDir, 'bundle.blob' );
	run(
		`npx postject "${ posix( outputPath ) }" NODE_SEA_BLOB "${ posix( blobPath ) }" ` +
			'--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' +
			( isDarwin ? ' --macho-segment-name NODE_SEA' : '' )
	);

	// macOS: re-sign with ad-hoc signature
	if ( isDarwin ) {
		run( `codesign -s - "${ outputPath }"` );
	}

	// Emit a SHA-256 checksum file alongside the binary so the curl installers
	// can verify the download before executing it.
	const binarySha = sha256( outputPath );
	const checksumPath = `${ outputPath }.sha256`;
	fs.writeFileSync( checksumPath, `${ binarySha }  ${ path.basename( outputPath ) }\n` );

	// Cleanup build artifacts
	fs.rmSync( bundleBuildDir, { recursive: true, force: true } );
	fs.rmSync( blobPath, { force: true } );

	const size = ( fs.statSync( outputPath ).size / 1024 / 1024 ).toFixed( 1 );
	console.log( `\n==> Done! Binary: ${ outputPath } (${ size } MB)` );
	console.log( `    SHA-256:   ${ binarySha }` );
	console.log( `    Checksum:  ${ checksumPath }` );
}

main().catch( ( error ) => {
	console.error( 'Error:', error.message );
	process.exit( 1 );
} );
