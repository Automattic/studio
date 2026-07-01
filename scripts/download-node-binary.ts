#!/usr/bin/env -S node --experimental-strip-types
/**
 * Download Node.js binary for bundling with Studio.
 *
 * Usage: node --experimental-strip-types scripts/download-node-binary.ts <platform> <arch> [destDir]
 * Example: node --experimental-strip-types scripts/download-node-binary.ts darwin arm64 ./build
 *
 * When destDir is omitted, the binary is placed in apps/studio/bin/ for the
 * desktop packaging step. Callers can override it to land the binary anywhere
 * (e.g. `create-standalone-bundle.ts` points it at its staging dir).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { extract } from 'tar';
import { extractZip } from '../tools/common/lib/extract-zip.ts';
import { fetch } from './lib/with-retry.ts';

const LTS_FALLBACK = 'v24.13.1';

function getNodeVersion(): string {
	const nvmrcPath = path.join( import.meta.dirname, '..', '.nvmrc' );
	if ( fs.existsSync( nvmrcPath ) ) {
		const version = fs.readFileSync( nvmrcPath, 'utf-8' ).trim();
		return version.startsWith( 'v' ) ? version : `v${ version }`;
	}
	console.log( `.nvmrc not found, using fallback version ${ LTS_FALLBACK }` );
	return LTS_FALLBACK;
}

// Map platform/arch names to nodejs.org download naming
const platformMap: Record< string, string > = {
	darwin: 'darwin',
	win32: 'win',
	linux: 'linux',
};
const archMap: Record< string, string > = {
	arm64: 'arm64',
	x64: 'x64',
};

/**
 * Downloads the Node.js binary for the target platform/arch into destDir
 * (defaults to apps/studio/bin for the desktop packaging step).
 */
export async function downloadNodeBinary(
	platform: string,
	arch: string,
	destDir?: string
): Promise< void > {
	const nodeVersion = getNodeVersion();
	const nodePlatform = platformMap[ platform ];
	const nodeArch = archMap[ arch ];

	if ( ! nodePlatform ) {
		throw new Error( `Unsupported platform: ${ platform }` );
	}
	if ( ! nodeArch ) {
		throw new Error( `Unsupported architecture: ${ arch }` );
	}

	const binDir = destDir
		? path.resolve( destDir )
		: path.join( import.meta.dirname, '..', 'apps', 'studio', 'bin' );
	const tmpDir = os.tmpdir();

	if ( ! fs.existsSync( binDir ) ) {
		fs.mkdirSync( binDir, { recursive: true } );
	}

	const isWindows = nodePlatform === 'win';
	// nodejs.org provides different archive formats depending on the target platform
	const ext = isWindows ? 'zip' : 'tar.gz';
	const filename = `node-${ nodeVersion }-${ nodePlatform }-${ nodeArch }.${ ext }`;
	const url = `https://nodejs.org/dist/${ nodeVersion }/${ filename }`;
	const downloadPath = path.join( tmpDir, filename );
	const extractDir = path.join( tmpDir, `node-${ nodeVersion }-${ nodePlatform }-${ nodeArch }` );

	async function download( downloadUrl: string, dest: string ): Promise< void > {
		console.log( `Downloading Node.js ${ nodeVersion } for ${ nodePlatform }-${ nodeArch }...` );

		const response = await fetch( downloadUrl );

		if ( ! response.ok ) {
			throw new Error( `Failed to download: HTTP ${ response.status }` );
		}

		const file = fs.createWriteStream( dest );
		const reader = response.body!.getReader();

		try {
			while ( true ) {
				const { done, value } = await reader.read();
				if ( done ) {
					break;
				}
				file.write( value );
			}
		} finally {
			reader.releaseLock();
		}

		await new Promise< void >( ( resolve, reject ) => {
			file.on( 'finish', resolve );
			file.on( 'error', reject );
			file.end();
		} );

		console.log( 'Download complete.' );
	}

	async function extractTarGz( archivePath: string, binaryName: string ): Promise< void > {
		console.log( 'Extracting node binary...' );

		await extract( {
			file: archivePath,
			cwd: tmpDir,
		} );

		const sourcePath = path.join( extractDir, 'bin', 'node' );
		const destPath = path.join( binDir, binaryName );

		fs.copyFileSync( sourcePath, destPath );
		fs.chmodSync( destPath, 0o755 );
		fs.rmSync( extractDir, { recursive: true } );
	}

	async function extractNodeZip( archivePath: string, binaryName: string ): Promise< void > {
		console.log( 'Extracting node.exe...' );

		// Use the common extractZip function
		await extractZip( archivePath, tmpDir );

		const sourcePath = path.join( extractDir, 'node.exe' );
		const destPath = path.join( binDir, binaryName );

		fs.copyFileSync( sourcePath, destPath );
		fs.rmSync( extractDir, { recursive: true } );
	}

	await download( url, downloadPath );

	const binaryName = isWindows ? 'node.exe' : 'node';
	if ( isWindows ) {
		await extractNodeZip( downloadPath, binaryName );
	} else {
		await extractTarGz( downloadPath, binaryName );
	}

	fs.unlinkSync( downloadPath );

	console.log( `\nNode.js binary installed to ${ binDir }` );

	const files = fs.readdirSync( binDir );
	console.log( '\nBin directory contents:' );
	for ( const file of files ) {
		const filePath = path.join( binDir, file );
		const stats = fs.statSync( filePath );
		const size = ( stats.size / 1024 / 1024 ).toFixed( 2 );
		console.log( `  ${ file } (${ size } MB)` );
	}
}

// Only run as a CLI when executed directly, not when imported.
const isMain = !! process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href;
if ( isMain ) {
	const platform = process.argv[ 2 ] || process.platform;
	const arch = process.argv[ 3 ] || process.arch;
	const destOverride = process.argv[ 4 ];
	downloadNodeBinary( platform, arch, destOverride ).catch( ( error ) => {
		console.error( 'Error:', ( error as Error ).message );
		process.exit( 1 );
	} );
}
