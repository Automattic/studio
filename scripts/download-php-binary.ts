#!/usr/bin/env tsx
/**
 * Download a Studio PHP CLI package for local development and packaging.
 *
 * Source metadata: packages/common/lib/php-binary-cdn-metadata.json
 *
 * Usage:
 *   npx tsx scripts/download-php-binary.ts [version] [platform] [arch] [--install-root <path>]
 *
 * Examples:
 *   npx tsx scripts/download-php-binary.ts            # defaults to RecommendedPHPVersion
 *   npx tsx scripts/download-php-binary.ts 8.4
 *   npx tsx scripts/download-php-binary.ts 8.4 darwin arm64
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { downloadFile } from '../packages/common/lib/download-file';
import { extractZip } from '../packages/common/lib/extract-zip';
import { isErrnoException } from '../packages/common/lib/is-errno-exception';
import {
	getEffectivePhpBinaryArch,
	getPhpBinaryDownloadInfo,
	NativePhpSupportedVersions,
	NativePhpSupportedVersion,
	PhpBinaryDownloadInfo,
} from '../packages/common/lib/php-binary-metadata';
import { getConfigDirectory } from '../packages/common/lib/well-known-paths';
import { RecommendedPHPVersion } from '../packages/common/types/php-versions';

const versionSchema = z.enum( NativePhpSupportedVersions );
const platformSchema = z.enum( [ 'darwin', 'win32', 'linux' ] );
const archSchema = z.enum( [ 'x64', 'arm64' ] );

type Platform = z.infer< typeof platformSchema >;
type Arch = z.infer< typeof archSchema >;

const { positionalArgs, installRoot } = parseArgs( process.argv.slice( 2 ) );

const { version, ...args } = z
	.tuple( [
		versionSchema.default( RecommendedPHPVersion as NativePhpSupportedVersion ),
		platformSchema.default( process.platform as Platform ),
		archSchema.default( process.arch as Arch ),
	] )
	.transform( ( [ version, platform, arch ] ) => ( { version, platform, arch } ) )
	.parse( [ positionalArgs[ 0 ], positionalArgs[ 1 ], positionalArgs[ 2 ] ] );

const effectiveArch = getEffectivePhpBinaryArch( args.platform, args.arch );
if ( args.arch === 'arm64' && args.platform === 'win32' ) {
	console.warn(
		'Warning: no Windows ARM64 PHP package available. Downloading x64 package instead (runs under Windows 11 emulation).'
	);
}

void main();

async function main(): Promise< void > {
	const isWindows = args.platform === 'win32';
	const binaryName = isWindows ? 'php.exe' : 'php';
	const platformKey = `${ args.platform }-${ effectiveArch }`;
	const phpPackageRoot = installRoot ?? path.join( getConfigDirectory(), 'php-bin' );

	try {
		const downloadInfo = resolvePhpBinaryDownloadInfo();
		const binDir = path.join( phpPackageRoot, downloadInfo.packageId );
		const destPath = path.join( binDir, binaryName );
		const shaMarkerPath = path.join( binDir, '.package-sha256' );

		if ( fs.existsSync( destPath ) ) {
			const installedSha = fs.existsSync( shaMarkerPath )
				? fs.readFileSync( shaMarkerPath, 'utf8' ).trim()
				: '';
			if ( installedSha === downloadInfo.sha ) {
				console.log(
					`PHP ${ version } package ${ downloadInfo.packageId } already up to date at ${ binDir }.`
				);
				return;
			}
			// Same packageId but the archive SHA has changed — the package was republished in
			// place (e.g. adding the Windows VC++ runtime DLLs). Without this, a stale bundle cached
			// on a reused CI agent (apps/studio/php-bin is gitignored and not cleaned) would be
			// packaged forever. Remove it so the current package is fetched.
			console.log(
				`Stale PHP ${ version } package ${ downloadInfo.packageId } at ${ binDir } ` +
					`(sha ${ installedSha || 'unknown' } != ${ downloadInfo.sha }); re-downloading.`
			);
			fs.rmSync( binDir, { recursive: true, force: true } );
		}

		// Ensure the php-bin root exists, then atomically claim this version's slot.
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
			console.log(
				`Downloading PHP ${ downloadInfo.patchVersion } package ${ downloadInfo.packageId } for ${ platformKey }…`
			);
			console.log( `  URL: ${ downloadInfo.url }` );
			await downloadFile( downloadInfo.url, downloadPath, ( downloaded, total ) => {
				const dl = ( downloaded / 1024 / 1024 ).toFixed( 1 );
				const tot = total ? ` / ${ ( total / 1024 / 1024 ).toFixed( 1 ) } MB` : '';
				process.stdout.write( `\r  ${ dl } MB${ tot }` );
			} );
			console.log( '\nDownload complete.' );

			console.log( 'Verifying SHA-256…' );
			const data = await fs.promises.readFile( downloadPath );
			const actual = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
			if ( actual !== downloadInfo.sha ) {
				throw new Error(
					`SHA-256 mismatch:\n  expected ${ downloadInfo.sha }\n  got      ${ actual }`
				);
			}
			console.log( '  Hash OK.' );

			console.log( 'Extracting PHP package…' );
			const tmpDir = os.tmpdir();
			const extractDir = fs.mkdtempSync( path.join( tmpDir, `php-${ downloadInfo.packageId }-` ) );
			try {
				await extractZip( downloadPath, extractDir );
				const extractedBinaryName = getRuntimeBinaryName( extractDir ) ?? binaryName;
				const src = path.join( extractDir, extractedBinaryName );
				if ( ! fs.existsSync( src ) ) {
					throw new Error( `${ extractedBinaryName } not found after extraction.` );
				}
				copyDirectoryContents( extractDir, binDir );
				// Record the archive SHA so a later republish-in-place under the same packageId
				// is detected as stale and re-downloaded (see the skip check above).
				fs.writeFileSync( shaMarkerPath, downloadInfo.sha );
				if ( ! isWindows ) {
					fs.chmodSync( destPath, 0o755 );
				}
			} finally {
				fs.rmSync( extractDir, { recursive: true, force: true } );
			}

			console.log(
				`\nPHP ${ version } package ${ downloadInfo.packageId } installed: ${ binDir }`
			);
		} catch ( err ) {
			fs.rmSync( binDir, { recursive: true, force: true } );
			throw err;
		} finally {
			fs.rmSync( downloadPath, { force: true } );
		}
	} catch ( error ) {
		console.warn( `Warning: PHP package download failed — ${ ( error as Error ).message }` );
		console.warn(
			`The native-php runtime will not be available. Run \`npm run download:php-binary\` to retry.`
		);
		if ( process.env.STUDIO_PHP_BINARY_DOWNLOAD_REQUIRED === '1' ) {
			process.exitCode = 1;
		}
	}
}

function parseArgs( argv: string[] ): { installRoot?: string; positionalArgs: string[] } {
	const positionalArgs: string[] = [];
	let installRoot: string | undefined;

	for ( let index = 0; index < argv.length; index++ ) {
		const arg = argv[ index ];
		if ( arg === '--install-root' ) {
			const value = argv[ index + 1 ];
			if ( ! value || value.startsWith( '--' ) ) {
				throw new Error( 'Missing value for --install-root.' );
			}
			installRoot = value;
			index++;
			continue;
		}
		if ( arg.startsWith( '--install-root=' ) ) {
			const value = arg.slice( '--install-root='.length );
			if ( ! value ) {
				throw new Error( 'Missing value for --install-root.' );
			}
			installRoot = value;
			continue;
		}
		if ( arg.startsWith( '-' ) ) {
			throw new Error( `Unknown option: ${ arg }` );
		}
		positionalArgs.push( arg );
	}

	return { installRoot, positionalArgs };
}

function getRuntimeBinaryName( extractDir: string ): string | undefined {
	const runtimeJsonPath = path.join( extractDir, 'runtime.json' );
	if ( ! fs.existsSync( runtimeJsonPath ) ) {
		return undefined;
	}

	const runtimeJson = JSON.parse( fs.readFileSync( runtimeJsonPath, 'utf8' ) ) as {
		binary?: unknown;
	};
	return typeof runtimeJson.binary === 'string' && runtimeJson.binary
		? runtimeJson.binary
		: undefined;
}

function copyDirectoryContents( sourceDir: string, destDir: string ): void {
	for ( const entry of fs.readdirSync( sourceDir ) ) {
		fs.cpSync( path.join( sourceDir, entry ), path.join( destDir, entry ), {
			recursive: true,
			force: true,
		} );
	}
}

function resolvePhpBinaryDownloadInfo(): PhpBinaryDownloadInfo {
	const downloadInfo = getPhpBinaryDownloadInfo( version, args.platform, args.arch );
	if ( downloadInfo ) {
		return downloadInfo;
	}

	throw new Error( `PHP ${ version } is not available for this platform yet.` );
}

function getArchiveFileName( url: string ): string {
	try {
		return path.basename( new URL( url ).pathname );
	} catch {
		return path.basename( url );
	}
}
