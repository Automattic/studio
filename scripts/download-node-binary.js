#!/usr/bin/env node
/**
 * Download Node.js binary for bundling with Studio
 * Usage: node scripts/download-node-binary.js <platform> <arch>
 * Example: node scripts/download-node-binary.js darwin arm64
 */

const https = require( 'https' );
const fs = require( 'fs' );
const path = require( 'path' );
const { execSync } = require( 'child_process' );
const os = require( 'os' );

const NODE_VERSION = 'v22.12.0'; // LTS version

const platform = process.argv[ 2 ] || process.platform;
const arch = process.argv[ 3 ] || process.arch;

// Map platform names to Node.js download naming
const platformMap = {
	darwin: 'darwin',
	win32: 'win',
	linux: 'linux',
};

// Map architecture names
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

const binDir = path.join( __dirname, '..', 'bin' );
const tmpDir = os.tmpdir();

// Ensure bin directory exists
if ( ! fs.existsSync( binDir ) ) {
	fs.mkdirSync( binDir, { recursive: true } );
}

const isWindows = nodePlatform === 'win';
const ext = isWindows ? 'zip' : 'tar.gz';
const filename = `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }.${ ext }`;
const url = `https://nodejs.org/dist/${ NODE_VERSION }/${ filename }`;
const downloadPath = path.join( tmpDir, filename );

function download( downloadUrl, dest ) {
	return new Promise( ( resolve, reject ) => {
		console.log( `Downloading Node.js ${ NODE_VERSION } for ${ nodePlatform }-${ nodeArch }...` );
		console.log( `URL: ${ downloadUrl }` );

		const file = fs.createWriteStream( dest );

		https
			.get( downloadUrl, ( response ) => {
				// Handle redirects
				if ( response.statusCode === 302 || response.statusCode === 301 ) {
					file.close();
					fs.unlinkSync( dest );
					return download( response.headers.location, dest ).then( resolve ).catch( reject );
				}

				if ( response.statusCode !== 200 ) {
					reject( new Error( `Failed to download: HTTP ${ response.statusCode }` ) );
					return;
				}

				const totalSize = parseInt( response.headers[ 'content-length' ], 10 );
				let downloadedSize = 0;

				response.on( 'data', ( chunk ) => {
					downloadedSize += chunk.length;
					const percent = ( ( downloadedSize / totalSize ) * 100 ).toFixed( 1 );
					process.stdout.write( `\rDownloading... ${ percent }%` );
				} );

				response.pipe( file );

				file.on( 'finish', () => {
					file.close();
					console.log( '\nDownload complete.' );
					resolve();
				} );
			} )
			.on( 'error', ( err ) => {
				fs.unlink( dest, () => {} );
				reject( err );
			} );
	} );
}

function extractTarGz( archivePath, destDir, binaryName ) {
	console.log( 'Extracting node binary...' );

	const extractDir = path.join( tmpDir, `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }` );

	// Use tar command (available on macOS and Linux)
	execSync( `tar -xzf "${ archivePath }" -C "${ tmpDir }"` );

	const sourcePath = path.join( extractDir, 'bin', 'node' );
	const destPath = path.join( destDir, binaryName );

	fs.copyFileSync( sourcePath, destPath );
	fs.chmodSync( destPath, 0o755 );

	// Cleanup
	fs.unlinkSync( archivePath );
	fs.rmSync( extractDir, { recursive: true } );
}

function extractZip( archivePath, destDir, binaryName ) {
	console.log( 'Extracting node.exe...' );

	const extractDir = path.join( tmpDir, `node-${ NODE_VERSION }-${ nodePlatform }-${ nodeArch }` );

	// Use PowerShell on Windows, unzip on others
	if ( process.platform === 'win32' ) {
		execSync(
			`powershell -Command "Expand-Archive -Path '${ archivePath }' -DestinationPath '${ tmpDir }' -Force"`
		);
	} else {
		execSync( `unzip -q "${ archivePath }" -d "${ tmpDir }"` );
	}

	const sourcePath = path.join( extractDir, 'node.exe' );
	const destPath = path.join( destDir, binaryName );

	fs.copyFileSync( sourcePath, destPath );

	// Cleanup
	fs.unlinkSync( archivePath );
	fs.rmSync( extractDir, { recursive: true } );
}

async function main() {
	try {
		await download( url, downloadPath );

		const binaryName = isWindows ? 'node.exe' : 'node';

		if ( isWindows ) {
			extractZip( downloadPath, binDir, binaryName );
		} else {
			extractTarGz( downloadPath, binDir, binaryName );
		}

		console.log( `\nNode.js binary installed to ${ binDir }` );

		// List the bin directory contents
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
}

main();
