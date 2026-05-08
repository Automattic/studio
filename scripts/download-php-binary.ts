#!/usr/bin/env ts-node
/**
 * Download a Studio PHP CLI binary for local development.
 * NOT used in production builds — binaries are not bundled with Studio or the CLI.
 *
 * Source manifest: https://appscdn.wordpress.com/builds/wordpress-com-studio-php-cli/releases.json
 *
 * Usage:
 *   npx ts-node scripts/download-php-binary.ts [version] [platform] [arch]
 *
 * Examples:
 *   npx ts-node scripts/download-php-binary.ts            # defaults to RecommendedPHPVersion
 *   npx ts-node scripts/download-php-binary.ts 8.3
 *   npx ts-node scripts/download-php-binary.ts 8.3 darwin arm64
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
import {
	getPhpBinaryManifestDownloadInfo,
	PHP_BINARY_MANIFEST_URL,
	PHP_PATCH_VERSIONS,
	NativePhpSupportedVersions,
	NativePhpSupportedVersion,
	PhpBinaryDownloadInfo,
} from '../tools/common/lib/php-binary-metadata';
import { getConfigDirectory } from '../tools/common/lib/well-known-paths';
import { RecommendedPHPVersion } from '../tools/common/types/php-versions';

const versionSchema = z.enum( NativePhpSupportedVersions );
const platformSchema = z.enum( [ 'darwin', 'win32', 'linux' ] );
const archSchema = z.enum( [ 'x64', 'arm64' ] );

type Platform = z.infer< typeof platformSchema >;
type Arch = z.infer< typeof archSchema >;

const positionalArgs = process.argv.slice( 2 );

const { version, ...args } = z
	.tuple( [
		versionSchema.default( RecommendedPHPVersion as NativePhpSupportedVersion ),
		platformSchema.default( process.platform as Platform ),
		archSchema.default( process.arch as Arch ),
	] )
	.transform( ( [ version, platform, arch ] ) => ( { version, platform, arch } ) )
	.parse( [ positionalArgs[ 0 ], positionalArgs[ 1 ], positionalArgs[ 2 ] ] );

// Windows ARM64 uses the Windows x64 PHP binary under OS emulation.
const effectiveArch: Arch = args.platform === 'win32' ? 'x64' : args.arch;
if ( args.arch === 'arm64' && args.platform === 'win32' ) {
	console.warn(
		'Warning: no Windows ARM64 PHP binary available. Downloading x64 binary instead (runs under Windows 11 emulation).'
	);
}

void main();

async function main(): Promise< void > {
	const patchVersion = PHP_PATCH_VERSIONS[ version ];
	const isWindows = args.platform === 'win32';
	const downloadInfo = await resolvePhpBinaryDownloadInfo();
	const binDir = path.join( getConfigDirectory(), 'php-bin', version );
	const binaryName = isWindows ? 'php.exe' : 'php';
	const destPath = path.join( binDir, binaryName );
	const platformKey = `${ args.platform }-${ effectiveArch }`;

	try {
		if ( fs.existsSync( destPath ) ) {
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

		const downloadPath = path.join( binDir, getArchiveFileName( downloadInfo.url ) );

		try {
			console.log( `Downloading PHP ${ version } (${ patchVersion }) for ${ platformKey }…` );
			console.log( `  URL: ${ downloadInfo.url }` );
			await downloadFile( downloadInfo.url, downloadPath, ( downloaded, total ) => {
				const dl = ( downloaded / 1024 / 1024 ).toFixed( 1 );
				const tot = total ? ` / ${ ( total / 1024 / 1024 ).toFixed( 1 ) } MB` : '';
				process.stdout.write( `\r  ${ dl } MB${ tot }` );
			} );
			console.log( '\nDownload complete.' );

			// Verify SHA-256
			console.log( 'Verifying SHA-256…' );
			const data = await fs.promises.readFile( downloadPath );
			const actual = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
			if ( actual !== downloadInfo.sha ) {
				throw new Error(
					`SHA-256 mismatch:\n  expected ${ downloadInfo.sha }\n  got      ${ actual }`
				);
			}
			console.log( '  Hash OK.' );

			// Extract
			console.log( 'Extracting PHP binary…' );
			const tmpDir = os.tmpdir();
			if ( isZipArchive( downloadPath ) ) {
				const extractDir = fs.mkdtempSync( path.join( tmpDir, `php-${ patchVersion }-` ) );
				const expectedBinary = isWindows ? 'php.exe' : 'php';
				try {
					await extractZip( downloadPath, extractDir );
					const src = path.join( extractDir, expectedBinary );
					if ( ! fs.existsSync( src ) ) {
						throw new Error( `${ expectedBinary } not found after extraction.` );
					}
					fs.copyFileSync( src, destPath );
					if ( ! isWindows ) {
						fs.chmodSync( destPath, 0o755 );
					}
				} finally {
					fs.rmSync( extractDir, { recursive: true, force: true } );
				}
			} else if ( isWindows ) {
				throw new Error( `Windows PHP binary archive must be a .zip file.` );
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

async function resolvePhpBinaryDownloadInfo(): Promise< PhpBinaryDownloadInfo > {
	try {
		const response = await fetch( PHP_BINARY_MANIFEST_URL );
		if ( ! response.ok ) {
			throw new Error( `status ${ response.status }` );
		}
		const manifest = await response.json();
		const appsCdnDownload = getPhpBinaryManifestDownloadInfo(
			manifest,
			version,
			args.platform,
			args.arch
		);
		if ( appsCdnDownload ) {
			return appsCdnDownload;
		}
	} catch {
		throw new Error( 'Could not check PHP availability. Please try again later.' );
	}

	throw new Error(
		`PHP ${ PHP_PATCH_VERSIONS[ version ] } is not available for this device yet. Please try again later.`
	);
}

function getArchiveFileName( url: string ): string {
	try {
		return path.basename( new URL( url ).pathname );
	} catch {
		return path.basename( url );
	}
}

function isZipArchive( archivePath: string ): boolean {
	return archivePath.toLowerCase().endsWith( '.zip' );
}
