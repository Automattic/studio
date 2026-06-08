#!/usr/bin/env tsx
/**
 * Download Node.js binary for bundling with Studio
 * Usage: npx tsx scripts/download-node-binary.ts <platform> <arch>
 * Example: npx tsx scripts/download-node-binary.ts darwin arm64
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { extract } from 'tar';
import { extractZip } from '../tools/common/lib/extract-zip';
import { fetch, throwForHttpStatus, withRetry } from './lib/with-retry';

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

// Map platform names to nodejs.org download naming
const platformMap: Record< string, string > = {
	darwin: 'darwin',
	win32: 'win',
	linux: 'linux',
};

// Map architecture names to nodejs.org download naming
const archMap: Record< string, string > = {
	arm64: 'arm64',
	x64: 'x64',
};

type NodeTarget = {
	platform: string;
	arch: string;
	nodePlatform: string;
	nodeArch: string;
	isWindows: boolean;
	binaryName: string;
	ext: 'zip' | 'tar.gz';
};

type InstallNodeBinaryOptions = {
	platform?: string;
	arch?: string;
	nodeVersion?: string;
	binDir?: string;
	tmpDir?: string;
	cacheDir?: string;
	currentPlatform?: string;
	currentArch?: string;
	currentNodeVersion?: string;
	currentNodePath?: string;
	downloadArchive?: ( downloadUrl: string, dest: string ) => Promise< void >;
	extractTarGz?: typeof extractTarGz;
	extractNodeZip?: typeof extractNodeZip;
};

export type InstallNodeBinaryResult = {
	source: 'current' | 'cache' | 'download';
	destPath: string;
	archivePath?: string;
};

export function resolveNodeTarget( platform: string, arch: string ): NodeTarget {
	const nodePlatform = platformMap[ platform ];
	const nodeArch = archMap[ arch ];

	if ( ! nodePlatform ) {
		throw new Error( `Unsupported platform: ${ platform }` );
	}

	if ( ! nodeArch ) {
		throw new Error( `Unsupported architecture: ${ arch }` );
	}

	const isWindows = nodePlatform === 'win';
	return {
		platform,
		arch,
		nodePlatform,
		nodeArch,
		isWindows,
		binaryName: isWindows ? 'node.exe' : 'node',
		// nodejs.org provides different archive formats depending on the target platform
		ext: isWindows ? 'zip' : 'tar.gz',
	};
}

function getCacheDir(): string {
	if ( process.env.STUDIO_NODE_BINARY_CACHE_DIR ) {
		return process.env.STUDIO_NODE_BINARY_CACHE_DIR;
	}

	const cacheRoot = process.env.XDG_CACHE_HOME || path.join( os.homedir(), '.cache' );
	return path.join( cacheRoot, 'studio', 'node-binaries' );
}

function getNodeBinaryUrl(
	nodeVersion: string,
	target: NodeTarget
): { filename: string; url: string } {
	const filename = `node-${ nodeVersion }-${ target.nodePlatform }-${ target.nodeArch }.${ target.ext }`;
	return {
		filename,
		url: `https://nodejs.org/dist/${ nodeVersion }/${ filename }`,
	};
}

function copyNodeBinary( sourcePath: string, destPath: string, isWindows: boolean ): void {
	fs.copyFileSync( sourcePath, destPath );
	if ( ! isWindows ) {
		fs.chmodSync( destPath, 0o755 );
	}
}

async function download( downloadUrl: string, dest: string ): Promise< void > {
	const response = await withRetry( 'node binary download', () => fetch( downloadUrl ) );

	if ( ! response.ok ) {
		throwForHttpStatus( 'Node.js binary download', response.status, response.statusText );
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

async function extractTarGz(
	archivePath: string,
	destDir: string,
	binaryName: string,
	nodeVersion: string,
	target: NodeTarget,
	tmpDir: string
): Promise< void > {
	console.log( 'Extracting node binary...' );

	const extractDir = path.join(
		tmpDir,
		`node-${ nodeVersion }-${ target.nodePlatform }-${ target.nodeArch }`
	);

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
	binaryName: string,
	nodeVersion: string,
	target: NodeTarget,
	tmpDir: string
): Promise< void > {
	console.log( 'Extracting node.exe...' );

	const extractDir = path.join(
		tmpDir,
		`node-${ nodeVersion }-${ target.nodePlatform }-${ target.nodeArch }`
	);

	// Use the common extractZip function
	await extractZip( archivePath, tmpDir );

	const sourcePath = path.join( extractDir, 'node.exe' );
	const destPath = path.join( destDir, binaryName );

	fs.copyFileSync( sourcePath, destPath );
	fs.rmSync( extractDir, { recursive: true } );
}

export async function installNodeBinary(
	options: InstallNodeBinaryOptions = {}
): Promise< InstallNodeBinaryResult > {
	const nodeVersion = options.nodeVersion ?? getNodeVersion();
	const target = resolveNodeTarget(
		options.platform ?? process.argv[ 2 ] ?? process.platform,
		options.arch ?? process.argv[ 3 ] ?? process.arch
	);
	const binDir = options.binDir ?? path.join( import.meta.dirname, '..', 'apps', 'studio', 'bin' );
	const tmpDir = options.tmpDir ?? os.tmpdir();
	const cacheDir = options.cacheDir ?? getCacheDir();
	const currentPlatform = options.currentPlatform ?? process.platform;
	const currentArch = options.currentArch ?? process.arch;
	const currentNodeVersion = options.currentNodeVersion ?? process.version;
	const currentNodePath = options.currentNodePath ?? process.execPath;
	const downloadArchive = options.downloadArchive ?? download;
	const extractArchive = target.isWindows
		? options.extractNodeZip ?? extractNodeZip
		: options.extractTarGz ?? extractTarGz;
	const destPath = path.join( binDir, target.binaryName );

	fs.mkdirSync( binDir, { recursive: true } );

	if (
		target.platform === currentPlatform &&
		target.arch === currentArch &&
		nodeVersion === currentNodeVersion
	) {
		console.log(
			`Using current Node.js ${ nodeVersion } binary for ${ target.nodePlatform }-${ target.nodeArch }.`
		);
		copyNodeBinary( currentNodePath, destPath, target.isWindows );
		return { source: 'current', destPath };
	}

	const { filename, url } = getNodeBinaryUrl( nodeVersion, target );
	const cachePath = path.join( cacheDir, filename );
	let archivePath = cachePath;
	let source: InstallNodeBinaryResult[ 'source' ] = 'cache';

	if ( fs.existsSync( cachePath ) ) {
		console.log( `Using cached Node.js archive: ${ cachePath }` );
	} else {
		console.log(
			`Downloading Node.js ${ nodeVersion } for ${ target.nodePlatform }-${ target.nodeArch }...`
		);
		fs.mkdirSync( cacheDir, { recursive: true } );
		const downloadPath = path.join( cacheDir, `${ filename }.${ process.pid }.download` );
		await downloadArchive( url, downloadPath );
		fs.renameSync( downloadPath, cachePath );
		archivePath = cachePath;
		source = 'download';
		console.log( `Cached Node.js archive: ${ cachePath }` );
	}

	await extractArchive( archivePath, binDir, target.binaryName, nodeVersion, target, tmpDir );

	return { source, destPath, archivePath };
}

async function main(): Promise< void > {
	try {
		const result = await installNodeBinary();
		const binDir = path.dirname( result.destPath );

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
	}
}

if ( process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href ) {
	void main();
}
