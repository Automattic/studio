#!/usr/bin/env node
/**
 * Download Node.js binary for bundling with Studio
 * Usage: node scripts/download-node-binary.js <platform> <arch>
 * Example: node scripts/download-node-binary.js darwin arm64
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { extract } from 'tar';
import unzipper from 'unzipper';

const LTS_FALLBACK = 'v22.12.0';

function getNodeVersion() {
	const nvmrcPath = path.join( import.meta.dirname, '..', '.nvmrc' );
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
const platformMap = {
	darwin: 'darwin',
	win32: 'win',
};

// Map architecture names to nodejs.org download naming
const archMap = {
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

const binDir = path.join( import.meta.dirname, '..', 'bin' );
const tmpDir = os.tmpdir();

if ( ! fs.existsSync( binDir ) ) {
	fs.mkdirSync( binDir, { recursive: true } );
}

const isWindows = nodePlatform === 'win';
// nodejs.org provides different archive formats depending on the target platform
const ext = isWindows ? 'zip' : 'tar.gz';
const filename = `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }.${ ext }`;
const url = `https://nodejs.org/dist/${ NODE_VERSION }/${ filename }`;
const downloadPath = path.join( tmpDir, filename );

async function download( downloadUrl, dest ) {
	console.log( `Downloading Node.js ${ NODE_VERSION } for ${ nodePlatform }-${ nodeArch }...` );

	const response = await fetch( downloadUrl );

	if ( ! response.ok ) {
		throw new Error( `Failed to download: HTTP ${ response.status }` );
	}

	const file = fs.createWriteStream( dest );
	const reader = response.body.getReader();

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

	await new Promise( ( resolve, reject ) => {
		file.on( 'finish', resolve );
		file.on( 'error', reject );
		file.end();
	} );

	console.log( 'Download complete.' );
}

async function extractTarGz( archivePath, destDir, binaryName ) {
	console.log( 'Extracting node binary...' );

	const extractDir = path.join( tmpDir, `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }` );

	await extract( {
		file: archivePath,
		cwd: tmpDir,
	} ).then( () => {
		// Do nothing. We just need the `.then` chaining to be able to await the promise
	} );

	const sourcePath = path.join( extractDir, 'bin', 'node' );
	const destPath = path.join( destDir, binaryName );

	fs.copyFileSync( sourcePath, destPath );
	fs.chmodSync( destPath, 0o755 );
	fs.rmSync( extractDir, { recursive: true } );
}

async function extractZip( archivePath, destDir, binaryName ) {
	console.log( 'Extracting node.exe...' );

	const extractDir = path.join( tmpDir, `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }` );

	await fs
		.createReadStream( archivePath )
		.pipe( unzipper.Extract( { path: tmpDir } ) )
		.promise();

	const sourcePath = path.join( extractDir, 'node.exe' );
	const destPath = path.join( destDir, binaryName );

	fs.copyFileSync( sourcePath, destPath );
	fs.rmSync( extractDir, { recursive: true } );
}

try {
	await download( url, downloadPath );

	const binaryName = isWindows ? 'node.exe' : 'node';

	if ( isWindows ) {
		await extractZip( downloadPath, binDir, binaryName );
	} else {
		await extractTarGz( downloadPath, binDir, binaryName );
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
} catch ( error ) {
	console.error( 'Error:', error.message );
	process.exit( 1 );
}
