#!/usr/bin/env ts-node
/**
 * Download static PHP binary for local development.
 * NOT used in production builds — binaries are not bundled with Studio or the CLI.
 *
 * Binaries come from https://dl.static-php.dev/static-php-cli/
 *   - macOS / Linux: `bulk` variant (intl, opcache, sodium, imagick + pdo_sqlite)
 *   - Windows x64:   `windows/spc-max` variant (pdo_sqlite + opcache, missing intl/sodium/imagick)
 *
 * Usage:
 *   npx ts-node scripts/download-php-binary.ts [platform] [arch]
 *
 * Examples:
 *   npx ts-node scripts/download-php-binary.ts
 *   npx ts-node scripts/download-php-binary.ts darwin arm64
 *   npx ts-node scripts/download-php-binary.ts win32 x64
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { extract } from 'tar';
import { z } from 'zod';
import { extractZip } from '../tools/common/lib/extract-zip';
import { getConfigDirectory } from '../tools/common/lib/well-known-paths';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

const PHP_VERSION = '8.4.20';

// SHA-256 hashes for each platform asset from dl.static-php.dev.
// To recompute (e.g. after a PHP_VERSION bump), download each archive and run `shasum -a 256 <file>`.
const KNOWN_HASHES: Record< string, string > = {
	'darwin-arm64': 'f0c8e545f77f45d4331e004effa34c863071ea9400c668e4462e41b22ded980d',
	'darwin-x64': '837402a1a5d01a01fd5b3db08443376b3c962087a9ab3d7462b68b6724576579',
	'linux-x64': '8a6bf4113d4ba950f153ad2898e51c94e6d2b42ef40609e94ad57ad3b585fbfa',
	'linux-arm64': '7d08c5e18ba3377dd1d49a5720e3b4b91b1ac7f027c04fc07827c7814f530a57',
	'win32-x64': '174ee2fefa1da9727bfc3d89d37b0bc31b474d7cbbf2005d71bf364cf93fd3f2',
};

const platformSchema = z.enum( [ 'darwin', 'win32', 'linux' ] );
const archSchema = z.enum( [ 'x64', 'arm64' ] );

type Platform = z.infer< typeof platformSchema >;
type Arch = z.infer< typeof archSchema >;

const argsSchema = z
	.tuple( [
		platformSchema.default( process.platform as Platform ),
		archSchema.default( process.arch as Arch ),
	] )
	.transform( ( [ platform, arch ] ) => ( { platform, arch } ) );

const args = argsSchema.parse( [ process.argv[ 2 ], process.argv[ 3 ] ] );

// Windows ARM64 has no pre-built binary upstream; run x64 under OS emulation.
const effectiveArch: Arch = args.platform === 'win32' ? 'x64' : args.arch;

if ( args.arch === 'arm64' && args.platform === 'win32' ) {
	console.warn(
		'Warning: no Windows ARM64 binary available upstream. Downloading x64 binary instead (runs under Windows 11 emulation).'
	);
}

// CDN arch names differ from Node's process.arch values.
const cdnArchMap: Record< Arch, string > = {
	x64: 'x86_64',
	arm64: 'aarch64',
};

// Asset naming and CDN path differ by platform.
// Linux/macOS: dl.static-php.dev/static-php-cli/bulk/php-{VERSION}-cli-{os}-{cdnArch}.tar.gz
// Windows:     dl.static-php.dev/static-php-cli/windows/spc-max/php-{VERSION}-cli-win.zip
const osSegment: Record< Platform, string > = {
	darwin: 'macos',
	linux: 'linux',
	win32: 'win',
};

const isWindows = args.platform === 'win32';
const ext = isWindows ? 'zip' : 'tar.gz';
const cdnArch = cdnArchMap[ effectiveArch ];
const filename = isWindows
	? `php-${ PHP_VERSION }-cli-win.${ ext }`
	: `php-${ PHP_VERSION }-cli-${ osSegment[ args.platform ] }-${ cdnArch }.${ ext }`;

const cdnBase = isWindows
	? 'https://dl.static-php.dev/static-php-cli/windows/spc-max'
	: 'https://dl.static-php.dev/static-php-cli/bulk';
const url = `${ cdnBase }/${ filename }`;
const platformKey = `${ args.platform }-${ effectiveArch }`;

const binDir = path.join( getConfigDirectory(), 'php-bin' );
const binaryName = isWindows ? 'php.exe' : 'php';
const destPath = path.join( binDir, binaryName );
const tmpDir = os.tmpdir();
const downloadPath = path.join( tmpDir, filename );

async function download( downloadUrl: string, dest: string ): Promise< void > {
	console.log( `Downloading PHP ${ PHP_VERSION } for ${ args.platform }-${ effectiveArch }...` );
	console.log( `  URL: ${ downloadUrl }` );

	const response = await fetch( downloadUrl );
	if ( ! response.ok ) {
		throw new Error( `Download failed: HTTP ${ response.status } ${ response.statusText }` );
	}

	await pipeline(
		Readable.fromWeb( response.body! as NodeReadableStream< Uint8Array > ),
		fs.createWriteStream( dest )
	);

	console.log( 'Download complete.' );
}

async function verifyHash( filePath: string, key: string ): Promise< void > {
	const expected = KNOWN_HASHES[ key ];
	if ( ! expected ) {
		console.warn(
			`Warning: no pinned SHA-256 hash for ${ key }. Skipping verification.\n` +
				`         Compute it with: sha256sum ${ filePath }\n` +
				`         Then add it to KNOWN_HASHES in scripts/download-php-binary.ts`
		);
		return;
	}

	console.log( 'Verifying SHA-256...' );
	const data = await fs.promises.readFile( filePath );
	const actual = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
	if ( actual !== expected ) {
		throw new Error(
			`SHA-256 mismatch for ${ key }:\n  expected ${ expected }\n  got      ${ actual }`
		);
	}
	console.log( '  Hash OK.' );
}

async function extractBinary( archivePath: string ): Promise< void > {
	console.log( 'Extracting PHP binary...' );

	if ( isWindows ) {
		// The zip contains php.exe directly at the root, so it extracts straight into tmpDir.
		await extractZip( archivePath, tmpDir );
		const src = path.join( tmpDir, 'php.exe' );
		if ( ! fs.existsSync( src ) ) {
			throw new Error( `php.exe not found after extraction. Check archive contents.` );
		}
		fs.copyFileSync( src, destPath );
		fs.unlinkSync( src );
	} else {
		const extractDir = path.join(
			tmpDir,
			`php-${ PHP_VERSION }-${ args.platform }-${ effectiveArch }`
		);
		fs.mkdirSync( extractDir, { recursive: true } );

		await extract( { file: archivePath, cwd: extractDir } );

		// The tar.gz contains a single `php` binary at the root
		const src = path.join( extractDir, 'php' );
		if ( ! fs.existsSync( src ) ) {
			throw new Error( `php binary not found after extraction. Check archive contents.` );
		}
		fs.copyFileSync( src, destPath );
		fs.chmodSync( destPath, 0o755 );
		fs.rmSync( extractDir, { recursive: true, force: true } );
	}
}

async function main(): Promise< void > {
	try {
		if ( fs.existsSync( destPath ) ) {
			console.log( `PHP binary already exists at ${ destPath }. Delete it to re-download.` );
			return;
		}

		fs.mkdirSync( binDir, { recursive: true } );

		await download( url, downloadPath );
		await verifyHash( downloadPath, platformKey );
		await extractBinary( downloadPath );

		fs.unlinkSync( downloadPath );

		const stats = fs.statSync( destPath );
		console.log(
			`\nPHP binary installed: ${ destPath } (${ ( stats.size / 1024 / 1024 ).toFixed( 1 ) } MB)`
		);
	} catch ( error ) {
		console.warn( `Warning: PHP binary download failed — ${ ( error as Error ).message }` );
		console.warn(
			'The native-php runtime will not be available. Run `npm run download:php-binary` to retry.'
		);
	}
}

void main();
