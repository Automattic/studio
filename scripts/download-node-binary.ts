#!/usr/bin/env ts-node
/**
 * Download Node.js binary for bundling with Studio
 * Usage: npx ts-node scripts/download-node-binary.ts <platform> <arch>
 * Example: npx ts-node scripts/download-node-binary.ts darwin arm64
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { extract } from 'tar';
import { extractZip } from '../common/lib/extract-zip';

const LTS_FALLBACK = 'v22.12.0';

function getNodeVersion(): string {
	const nvmrcPath = path.join( __dirname, '..', '.nvmrc' );
	if ( fs.existsSync( nvmrcPath ) ) {
		const version = fs.readFileSync( nvmrcPath, 'utf-8' ).trim();
		return version.startsWith( 'v' ) ? version : `v${ version }`;
	}
	console.log( `.nvmrc not found, using fallback version ${ LTS_FALLBACK }` );
	return LTS_FALLBACK;
}

const NODE_VERSION = getNodeVersion();

const platform = process.argv[ 2 ] || process.platform;
const arch = process.argv[ 3 ] || process.arch;

// Map platform names to nodejs.org download naming
const platformMap: Record< string, string > = {
	darwin: 'darwin',
	win32: 'win',
};

// Map architecture names to nodejs.org download naming
const archMap: Record< string, string > = {
	arm64: 'arm64',
	x64: 'x64',
};

const nodePlatform = platformMap[ platform ];
const nodeArch = archMap[ arch ];

if ( ! nodePlatform ) {
	console.error( `Unsupported platform: ${ platform }` );
	process.exit( 1 );
}

if ( ! nodeArch ) {
	console.error( `Unsupported architecture: ${ arch }` );
	process.exit( 1 );
}

const binDir = path.join( __dirname, '..', 'bin' );
const tmpDir = os.tmpdir();

if ( ! fs.existsSync( binDir ) ) {
	fs.mkdirSync( binDir, { recursive: true } );
}

const isWindows = nodePlatform === 'win';
// nodejs.org provides different archive formats depending on the target platform
const ext = isWindows ? 'zip' : 'tar.gz';
const nodeBuildArchiveFilename = `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }.${ ext }`;
const nodeBuildArchiveUrl = `https://nodejs.org/dist/${ NODE_VERSION }/${ nodeBuildArchiveFilename }`;
const nodeBuildArchiveDownloadPath = path.join( tmpDir, nodeBuildArchiveFilename );
const checksumUrl = `https://nodejs.org/dist/${ NODE_VERSION }/SHASUMS256.txt`;
const checksumPath = path.join( tmpDir, 'SHASUMS256.txt' );

async function download( downloadUrl: string, dest: string ): Promise< void > {
	console.log( `Downloading ${ path.basename( dest ) }...` );

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
}

async function verifyChecksum(): Promise< void > {
	console.log( 'Verifying checksum...' );

	const checksumContent = fs.readFileSync( checksumPath, 'utf-8' );
	const lines = checksumContent.split( '\n' );

	let expectedChecksum: string | null = null;
	for ( const line of lines ) {
		if ( line.includes( nodeBuildArchiveFilename ) ) {
			const parts = line.split( /\s+/ );
			if ( parts.length > 0 ) {
				expectedChecksum = parts[ 0 ];
			}
			break;
		}
	}

	if ( ! expectedChecksum ) {
		throw new Error( `Checksum not found for ${ nodeBuildArchiveFilename }` );
	}

	const hash = crypto.createHash( 'sha256' );
	const stream = fs.createReadStream( nodeBuildArchiveDownloadPath );

	await new Promise< void >( ( resolve, reject ) => {
		stream.on( 'data', ( chunk ) => {
			hash.update( chunk );
		} );
		stream.on( 'end', () => {
			resolve();
		} );
		stream.on( 'error', reject );
	} );

	const actualChecksum = hash.digest( 'hex' );

	if ( actualChecksum !== expectedChecksum ) {
		throw new Error(
			`Checksum mismatch!\nExpected: ${ expectedChecksum }\nActual:   ${ actualChecksum }`
		);
	}

	console.log( 'Checksum verified.' );
}

async function extractTarGz(
	archivePath: string,
	destDir: string,
	binaryName: string
): Promise< void > {
	console.log( `Extracting ${ path.basename( archivePath ) }...` );

	const extractDir = path.join( tmpDir, `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }` );

	await extract( {
		file: archivePath,
		cwd: tmpDir,
	} );

	const sourcePath = path.join( extractDir, 'bin', 'node' );
	const destPath = path.join( destDir, binaryName );

	fs.copyFileSync( sourcePath, destPath );
	fs.chmodSync( destPath, 0o755 );
	fs.rmSync( extractDir, { recursive: true } );
}

async function extractNodeZip(
	archivePath: string,
	destDir: string,
	binaryName: string
): Promise< void > {
	console.log( `Extracting ${ path.basename( archivePath ) }...` );

	const extractDir = path.join( tmpDir, `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }` );
	await extractZip( archivePath, tmpDir );

	const sourcePath = path.join( extractDir, 'node.exe' );
	const destPath = path.join( destDir, binaryName );

	fs.copyFileSync( sourcePath, destPath );
	fs.rmSync( extractDir, { recursive: true } );
}

async function main(): Promise< void > {
	try {
		console.log( `Downloading Node.js ${ NODE_VERSION } for ${ nodePlatform }-${ nodeArch }...` );
		await download( nodeBuildArchiveUrl, nodeBuildArchiveDownloadPath );
		await download( checksumUrl, checksumPath );
		await verifyChecksum();

		const binaryName = isWindows ? 'node.exe' : 'node';
		if ( isWindows ) {
			await extractNodeZip( nodeBuildArchiveDownloadPath, binDir, binaryName );
		} else {
			await extractTarGz( nodeBuildArchiveDownloadPath, binDir, binaryName );
		}

		console.log( `\nNode.js binary installed to ${ binDir }` );

		const files = fs.readdirSync( binDir );
		console.log( '\nBin directory contents:' );
		for ( const file of files ) {
			const filePath = path.join( binDir, file );
			const stats = fs.statSync( filePath );
			const size = ( stats.size / 1024 / 1024 ).toFixed( 2 );
			console.log( `  ${ file } (${ size } MB)` );
		}
	} catch ( error ) {
		console.error( 'Error:', ( error as Error ).message );
		process.exit( 1 );
	} finally {
		[ nodeBuildArchiveDownloadPath, checksumPath ].forEach( ( file ) => {
			if ( fs.existsSync( file ) ) {
				fs.unlinkSync( file );
			}
		} );
	}
}

main();
