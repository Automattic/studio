#!/usr/bin/env ts-node
/**
 * Download a static PHP binary for local development.
 * NOT used in production builds — binaries are not bundled with Studio or the CLI.
 *
 * Source CDN: https://dl.static-php.dev/static-php-cli/
 *   - macOS / Linux: `bulk` variant (intl, opcache, sodium, imagick + pdo_sqlite)
 *   - Windows x64:   `windows/spc-max` variant (pdo_sqlite + opcache)
 *
 * Usage:
 *   npx ts-node scripts/download-php-binary.ts [version] [platform] [arch]
 *
 * Examples:
 *   npx ts-node scripts/download-php-binary.ts            # defaults to RecommendedPHPVersion
 *   npx ts-node scripts/download-php-binary.ts 8.3
 *   npx ts-node scripts/download-php-binary.ts 8.3 darwin arm64
 *   npx ts-node scripts/download-php-binary.ts --compute-hashes 8.3 darwin arm64
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
import {
	buildPhpBinaryUrl,
	getPhpBinaryHash,
	NativePhpSupportedVersions,
	PHP_PATCH_VERSIONS,
} from '../tools/common/lib/php-binary-metadata';
import { getConfigDirectory } from '../tools/common/lib/well-known-paths';
import { RecommendedPHPVersion } from '../tools/common/types/php-versions';
import type { SupportedPHPVersion } from '../tools/common/types/php-versions';
import type { ReadableStream as NodeReadableStream } from 'stream/web';

const versionSchema = z.enum(
	NativePhpSupportedVersions as [ SupportedPHPVersion, ...SupportedPHPVersion[] ]
);
const platformSchema = z.enum( [ 'darwin', 'win32', 'linux' ] );
const archSchema = z.enum( [ 'x64', 'arm64' ] );

type Platform = z.infer< typeof platformSchema >;
type Arch = z.infer< typeof archSchema >;

const rawArgs = process.argv.slice( 2 );
const computeHashesMode = rawArgs[ 0 ] === '--compute-hashes';
const positionalArgs = computeHashesMode ? rawArgs.slice( 1 ) : rawArgs;

const { version, ...args } = z
	.tuple( [
		versionSchema.default( RecommendedPHPVersion ),
		platformSchema.default( process.platform as Platform ),
		archSchema.default( process.arch as Arch ),
	] )
	.transform( ( [ version, platform, arch ] ) => ( { version, platform, arch } ) )
	.parse( [ positionalArgs[ 0 ], positionalArgs[ 1 ], positionalArgs[ 2 ] ] );

// Windows ARM64 has no pre-built binary upstream; run x64 under OS emulation.
const effectiveArch: Arch = args.platform === 'win32' ? 'x64' : args.arch;
if ( args.arch === 'arm64' && args.platform === 'win32' ) {
	console.warn(
		'Warning: no Windows ARM64 binary available upstream. Downloading x64 binary instead (runs under Windows 11 emulation).'
	);
}

if ( computeHashesMode ) {
	void computeAndPrintHash();
} else {
	void main();
}

async function computeAndPrintHash(): Promise< void > {
	const patchVersion = PHP_PATCH_VERSIONS[ version ];
	if ( ! patchVersion ) {
		console.error(
			`PHP ${ version } is not supported. Available: ${ NativePhpSupportedVersions.join( ', ' ) }`
		);
		process.exit( 1 );
	}

	const url = buildPhpBinaryUrl( version, args.platform, args.arch );
	const filename = path.basename( url );
	const tmpPath = path.join( os.tmpdir(), filename );

	console.log( `Downloading ${ filename } to compute hash…` );
	const response = await fetch( url );
	if ( ! response.ok ) {
		throw new Error( `Download failed: HTTP ${ response.status }` );
	}
	await pipeline(
		Readable.fromWeb( response.body! as NodeReadableStream< Uint8Array > ),
		fs.createWriteStream( tmpPath )
	);

	const data = await fs.promises.readFile( tmpPath );
	const hash = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
	fs.unlinkSync( tmpPath );

	const key = `'${ version }-${ args.platform }-${ effectiveArch }'`;
	console.log( `${ key }: '${ hash }',` );
	console.log(
		`\nAdd this entry to PHP_BINARY_HASHES in apps/cli/lib/dependency-management/php-binary-metadata.ts`
	);
}

async function main(): Promise< void > {
	const patchVersion = PHP_PATCH_VERSIONS[ version ];
	if ( ! patchVersion ) {
		console.error(
			`PHP ${ version } is not supported. Available: ${ NativePhpSupportedVersions.join( ', ' ) }`
		);
		process.exit( 1 );
	}

	const isWindows = args.platform === 'win32';
	const url = buildPhpBinaryUrl( version, args.platform, args.arch );
	const filename = path.basename( url );
	const binDir = path.join( getConfigDirectory(), 'php-bin', version );
	const binaryName = isWindows ? 'php.exe' : 'php';
	const destPath = path.join( binDir, binaryName );
	const tmpDir = os.tmpdir();
	const downloadPath = path.join( tmpDir, filename );
	const platformKey = `${ args.platform }-${ effectiveArch }`;

	try {
		if ( fs.existsSync( destPath ) ) {
			console.log(
				`PHP ${ version } binary already exists at ${ destPath }. Delete it to re-download.`
			);
			return;
		}

		fs.mkdirSync( binDir, { recursive: true } );

		console.log( `Downloading PHP ${ version } (${ patchVersion }) for ${ platformKey }…` );
		console.log( `  URL: ${ url }` );

		const response = await fetch( url );
		if ( ! response.ok ) {
			throw new Error( `Download failed: HTTP ${ response.status } ${ response.statusText }` );
		}
		await pipeline(
			Readable.fromWeb( response.body! as NodeReadableStream< Uint8Array > ),
			fs.createWriteStream( downloadPath )
		);
		console.log( 'Download complete.' );

		// Verify SHA-256
		const expected = getPhpBinaryHash( version, args.platform, args.arch );
		if ( expected ) {
			console.log( 'Verifying SHA-256…' );
			const data = await fs.promises.readFile( downloadPath );
			const actual = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
			if ( actual !== expected ) {
				throw new Error( `SHA-256 mismatch:\n  expected ${ expected }\n  got      ${ actual }` );
			}
			console.log( '  Hash OK.' );
		} else {
			console.warn(
				`Warning: no pinned hash for ${ version }-${ platformKey }. Skipping verification.\n` +
					`         Compute it with: npx ts-node scripts/download-php-binary.ts --compute-hashes ${ version } ${ args.platform } ${ args.arch }`
			);
		}

		// Extract
		console.log( 'Extracting PHP binary…' );
		if ( isWindows ) {
			await extractZip( downloadPath, tmpDir );
			const src = path.join( tmpDir, 'php.exe' );
			if ( ! fs.existsSync( src ) ) {
				throw new Error( `php.exe not found after extraction.` );
			}
			fs.copyFileSync( src, destPath );
			fs.unlinkSync( src );
		} else {
			const extractDir = path.join(
				tmpDir,
				`php-${ patchVersion }-${ args.platform }-${ effectiveArch }`
			);
			fs.mkdirSync( extractDir, { recursive: true } );
			await extract( { file: downloadPath, cwd: extractDir } );
			const src = path.join( extractDir, 'php' );
			if ( ! fs.existsSync( src ) ) {
				throw new Error( `php binary not found after extraction.` );
			}
			fs.copyFileSync( src, destPath );
			fs.chmodSync( destPath, 0o755 );
			fs.rmSync( extractDir, { recursive: true, force: true } );
		}

		fs.unlinkSync( downloadPath );

		const stats = fs.statSync( destPath );
		console.log(
			`\nPHP ${ version } binary installed: ${ destPath } (${ ( stats.size / 1024 / 1024 ).toFixed(
				1
			) } MB)`
		);
	} catch ( error ) {
		console.warn( `Warning: PHP binary download failed — ${ ( error as Error ).message }` );
		console.warn(
			`The native-php runtime will not be available. Run \`npm run download:php-binary\` to retry.`
		);
	}
}
