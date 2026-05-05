#!/usr/bin/env ts-node
/**
 * Download a static PHP binary for local development.
 * NOT used in production builds — binaries are not bundled with Studio or the CLI.
 *
 * Source CDN: https://dl.static-php.dev/static-php-cli/
 *   - macOS / Linux: `common` variant (pdo_sqlite, curl, gd, zip, redis + most WP requirements)
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
import { extract } from 'tar';
import { z } from 'zod';
import { downloadFile } from '../tools/common/lib/download-file';
import { extractZip } from '../tools/common/lib/extract-zip';
import { isErrnoException } from '../tools/common/lib/is-errno-exception';
import { removeMacQuarantine } from '../tools/common/lib/macos-quarantine';
import {
	buildPhpBinaryUrl,
	getPhpBinaryHash,
	PHP_PATCH_VERSIONS,
	NativePhpSupportedVersions,
	NativePhpSupportedVersion,
} from '../tools/common/lib/php-binary-metadata';
import { getConfigDirectory } from '../tools/common/lib/well-known-paths';
import { RecommendedPHPVersion } from '../tools/common/types/php-versions';

const versionSchema = z.enum( NativePhpSupportedVersions );
const platformSchema = z.enum( [ 'darwin', 'win32', 'linux' ] );
const archSchema = z.enum( [ 'x64', 'arm64' ] );

type Platform = z.infer< typeof platformSchema >;
type Arch = z.infer< typeof archSchema >;

const rawArgs = process.argv.slice( 2 );
const computeHashesMode = rawArgs[ 0 ] === '--compute-hashes';
const positionalArgs = computeHashesMode ? rawArgs.slice( 1 ) : rawArgs;

const { version, ...args } = z
	.tuple( [
		versionSchema.default( RecommendedPHPVersion as NativePhpSupportedVersion ),
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
	const url = buildPhpBinaryUrl( version, args.platform, args.arch );
	const tmpPath = path.join( os.tmpdir(), `${ process.pid }-${ path.basename( url ) }` );

	console.log( `Downloading ${ path.basename( url ) } to compute hash…` );
	try {
		await downloadFile( url, tmpPath );
		const data = await fs.promises.readFile( tmpPath );
		const hash = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
		const key = `'${ version }-${ args.platform }-${ effectiveArch }'`;
		console.log( `${ key }: '${ hash }',` );
		console.log(
			`\nAdd this entry to PHP_BINARY_HASHES in tools/common/lib/php-binary-metadata.ts`
		);
	} finally {
		fs.rmSync( tmpPath, { force: true } );
	}
}

async function main(): Promise< void > {
	const patchVersion = PHP_PATCH_VERSIONS[ version ];
	const isWindows = args.platform === 'win32';
	const url = buildPhpBinaryUrl( version, args.platform, args.arch );
	const binDir = path.join( getConfigDirectory(), 'php-bin', version );
	const binaryName = isWindows ? 'php.exe' : 'php';
	const destPath = path.join( binDir, binaryName );
	const platformKey = `${ args.platform }-${ effectiveArch }`;

	try {
		if ( fs.existsSync( destPath ) ) {
			removeMacQuarantine( destPath, args.platform );
			console.log(
				`PHP ${ version } binary already exists at ${ destPath }. Delete it to re-download.`
			);
			return;
		}

		// Ensure ~/.studio/php-bin/ exists, then atomically claim this version's slot.
		fs.mkdirSync( path.dirname( binDir ), { recursive: true } );
		try {
			fs.mkdirSync( binDir );
		} catch ( err ) {
			if ( isErrnoException( err ) && err.code === 'EEXIST' ) {
				console.log( `PHP ${ version } is already being downloaded by another process. Waiting…` );
				return;
			}
			throw err;
		}

		const downloadPath = path.join( binDir, path.basename( url ) );

		try {
			console.log( `Downloading PHP ${ version } (${ patchVersion }) for ${ platformKey }…` );
			console.log( `  URL: ${ url }` );
			await downloadFile( url, downloadPath, ( downloaded, total ) => {
				const dl = ( downloaded / 1024 / 1024 ).toFixed( 1 );
				const tot = total ? ` / ${ ( total / 1024 / 1024 ).toFixed( 1 ) } MB` : '';
				process.stdout.write( `\r  ${ dl } MB${ tot }` );
			} );
			console.log( '\nDownload complete.' );

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
			const tmpDir = os.tmpdir();
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
				try {
					await extract( { file: downloadPath, cwd: extractDir } );
					const src = path.join( extractDir, 'php' );
					if ( ! fs.existsSync( src ) ) {
						throw new Error( `php binary not found after extraction.` );
					}
					fs.copyFileSync( src, destPath );
					fs.chmodSync( destPath, 0o755 );
				} finally {
					fs.rmSync( extractDir, { recursive: true, force: true } );
				}
			}
			removeMacQuarantine( destPath, args.platform );

			const stats = fs.statSync( destPath );
			console.log(
				`\nPHP ${ version } binary installed: ${ destPath } (${ (
					stats.size /
					1024 /
					1024
				).toFixed( 1 ) } MB)`
			);
		} catch ( err ) {
			fs.rmSync( binDir, { recursive: true, force: true } );
			throw err;
		} finally {
			fs.rmSync( downloadPath, { force: true } );
		}
	} catch ( error ) {
		console.warn( `Warning: PHP binary download failed — ${ ( error as Error ).message }` );
		console.warn(
			`The native-php runtime will not be available. Run \`npm run download:php-binary\` to retry.`
		);
	}
}
