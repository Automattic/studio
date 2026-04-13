#!/usr/bin/env ts-node
/**
 * Creates a standalone Studio CLI bundle for the current platform.
 * Output: standalone-bundles/studio-cli-{platform}-{arch}.tar.gz|zip
 *
 * Prerequisites: Node.js >= 22, npm dependencies installed
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
const bundleName = `studio-cli-${ platformArg }-${ archArg }`;
const outputDir = path.join( repoRoot, 'standalone-bundles' );
const bundleDir = path.join( outputDir, bundleName );
const nodeBinDir = path.join( repoRoot, 'apps', 'studio', 'bin' );

function run( cmd: string ): void {
	execSync( cmd, { cwd: repoRoot, stdio: 'inherit' } );
}

function copyDirSync( src: string, dest: string ): void {
	fs.mkdirSync( dest, { recursive: true } );
	for ( const entry of fs.readdirSync( src, { withFileTypes: true } ) ) {
		const srcPath = path.join( src, entry.name );
		const destPath = path.join( dest, entry.name );
		if ( entry.isDirectory() ) {
			copyDirSync( srcPath, destPath );
		} else {
			fs.copyFileSync( srcPath, destPath );
		}
	}
}

async function main(): Promise< void > {
	console.log( `==> Building standalone bundle: ${ bundleName }\n` );

	// Step 1: Build CLI with bundled node_modules
	console.log( '==> Step 1/4: Building CLI package...' );
	run( 'npm run cli:package' );

	// Step 2: Download Node binary for target platform
	console.log( `\n==> Step 2/4: Downloading Node.js binary for ${ platformArg }-${ archArg }...` );
	run( `npx ts-node scripts/download-node-binary.ts ${ platformArg } ${ archArg }` );

	// Step 3: Assemble bundle
	console.log( '\n==> Step 3/4: Assembling bundle...' );
	fs.rmSync( bundleDir, { recursive: true, force: true } );
	fs.mkdirSync( path.join( bundleDir, 'bin' ), { recursive: true } );
	fs.mkdirSync( path.join( bundleDir, 'cli' ), { recursive: true } );

	// Copy Node binary
	const nodeBinary = isWindows ? 'node.exe' : 'node';
	fs.copyFileSync( path.join( nodeBinDir, nodeBinary ), path.join( bundleDir, 'bin', nodeBinary ) );
	if ( ! isWindows ) {
		fs.chmodSync( path.join( bundleDir, 'bin', nodeBinary ), 0o755 );
	}

	// Copy CLI bundle
	copyDirSync( path.join( repoRoot, 'apps', 'cli', 'dist', 'cli' ), path.join( bundleDir, 'cli' ) );

	// Copy launcher script
	const standaloneDir = path.join( repoRoot, 'scripts', 'standalone' );
	if ( isWindows ) {
		fs.copyFileSync(
			path.join( standaloneDir, 'studio.cmd' ),
			path.join( bundleDir, 'bin', 'studio.cmd' )
		);
	} else {
		fs.copyFileSync(
			path.join( standaloneDir, 'studio' ),
			path.join( bundleDir, 'bin', 'studio' )
		);
		fs.chmodSync( path.join( bundleDir, 'bin', 'studio' ), 0o755 );
	}

	// Step 4: Compress (tar.gz for all platforms)
	console.log( '\n==> Step 4/4: Compressing...' );
	fs.mkdirSync( outputDir, { recursive: true } );

	const archivePath = path.join( outputDir, `${ bundleName }.tar.gz` );

	// Remove existing archive
	fs.rmSync( archivePath, { force: true } );

	run( `tar -czf "${ archivePath }" -C "${ outputDir }" "${ bundleName }"` );

	fs.rmSync( bundleDir, { recursive: true, force: true } );

	const size = ( fs.statSync( archivePath ).size / 1024 / 1024 ).toFixed( 1 );
	console.log( `\n==> Done! Bundle: ${ archivePath } (${ size } MB)` );
}

main().catch( ( error ) => {
	console.error( 'Error:', error.message );
	process.exit( 1 );
} );
