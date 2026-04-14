#!/usr/bin/env ts-node
/**
 * Creates a standalone Studio CLI binary.
 *
 * The CLI bundle and node_modules are embedded as assets inside the Node binary.
 * On first run, the entry point extracts them to ~/.studio/cli/.
 *
 * Output: standalone-bundles/studio-cli-{platform}-{arch}[.exe]
 *
 * Prerequisites: Node.js >= 24, npm dependencies installed
 *
 * Usage:
 *   npx ts-node scripts/create-standalone-bundle.ts
 *   npx ts-node scripts/create-standalone-bundle.ts darwin arm64
 *   npx ts-node scripts/create-standalone-bundle.ts win32 x64
 */

import { execSync } from 'child_process';
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

	// CLI bundle (JS files, wp-files, etc. — excludes node_modules)
	// --force-local prevents MSYS tar from interpreting "C:" as a remote host (BSD tar doesn't support it)
	const forceLocal = isWindows ? ' --force-local' : '';
	const cliTarPath = posix( path.join( bundleBuildDir, 'cli.tar.gz' ) );
	run( `tar -czf "${ cliTarPath }"${ forceLocal } --exclude='node_modules' .`, cliDistDir );

	// node_modules — use source node_modules (not dist) because externalized
	// native packages have transitive deps (e.g. ws, ini) that they need at runtime.
	// Strip browser dirs to save space. Keep asyncify as fallback for JSPI.
	const cliNodeModules = path.join( repoRoot, 'apps', 'cli', 'node_modules' );
	const nmTarPath = posix( path.join( bundleBuildDir, 'node_modules.tar.gz' ) );
	run(
		`tar -czf "${ nmTarPath }"${ forceLocal } ` +
			`--exclude='.cache' ` +
			`--exclude='playwright/browsers' --exclude='playwright-core/browsers' .`,
		cliNodeModules
	);

	const cliSize = (
		fs.statSync( path.join( bundleBuildDir, 'cli.tar.gz' ) ).size /
		1024 /
		1024
	).toFixed( 1 );
	const nmSize = (
		fs.statSync( path.join( bundleBuildDir, 'node_modules.tar.gz' ) ).size /
		1024 /
		1024
	).toFixed( 1 );
	console.log( `   CLI bundle: ${ cliSize } MB, node_modules: ${ nmSize } MB` );

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

	// Cleanup build artifacts
	fs.rmSync( bundleBuildDir, { recursive: true, force: true } );
	fs.rmSync( blobPath, { force: true } );

	const size = ( fs.statSync( outputPath ).size / 1024 / 1024 ).toFixed( 1 );
	console.log( `\n==> Done! Binary: ${ outputPath } (${ size } MB)` );
}

main().catch( ( error ) => {
	console.error( 'Error:', error.message );
	process.exit( 1 );
} );
