import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from '@studio/common/lib/download-file';
import { extractZip } from '@studio/common/lib/extract-zip';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import {
	getPhpBinaryManifestDownloadInfo,
	PHP_BINARY_MANIFEST_URL,
	validateNativePhpVersion,
	PHP_PATCH_VERSIONS,
	type PhpBinaryDownloadInfo,
	type NativePhpSupportedVersion,
} from '@studio/common/lib/php-binary-metadata';
import { extract } from 'tar';
import { getPhpBinaryPath } from './paths';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

const WAIT_POLL_INTERVAL_MS = 1_000;
const WAIT_TIMEOUT_MS = 5 * 60 * 1_000;

export async function ensurePhpBinaryAvailable(
	version: SupportedPHPVersion,
	onProgress?: ( downloaded: number, total: number ) => void
): Promise< void > {
	const validatedVersion = validateNativePhpVersion( version );

	if ( fs.existsSync( getPhpBinaryPath( validatedVersion ) ) ) {
		return;
	}

	await downloadAndInstall( validatedVersion, onProgress );
}

async function waitForBinary( binaryPath: string ): Promise< void > {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	while ( Date.now() < deadline ) {
		if ( fs.existsSync( binaryPath ) ) {
			return;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, WAIT_POLL_INTERVAL_MS ) );
	}
	throw new Error(
		`Timed out waiting for PHP binary at ${ binaryPath }. ` +
			`Another process may have failed to install it. ` +
			`Delete ${ path.dirname( binaryPath ) } and retry.`
	);
}

async function downloadAndInstall(
	version: NativePhpSupportedVersion,
	onProgress?: ( downloaded: number, total: number ) => void
): Promise< void > {
	const platform = process.platform;
	const arch = process.arch;
	const isWindows = platform === 'win32';

	// Windows ARM64 uses the Windows x64 PHP binary under OS emulation.
	if ( arch === 'arm64' && isWindows ) {
		console.warn(
			'Warning: no Windows ARM64 PHP binary available. Downloading x64 binary instead (runs under Windows 11 emulation).'
		);
	}

	const destPath = getPhpBinaryPath( version );
	const destDir = path.dirname( destPath );
	const phpBinRoot = path.dirname( destDir );

	// Ensure ~/.studio/php-bin/ exists before attempting the exclusive mkdir.
	fs.mkdirSync( phpBinRoot, { recursive: true } );

	// Atomically claim this version's install slot. If another process already
	// created the directory it is either mid-download or finished.
	try {
		fs.mkdirSync( destDir );
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'EEXIST' ) {
			await waitForBinary( destPath );
			return;
		}
		throw err;
	}

	// We own the slot — clean up the directory on failure so the next attempt
	// can claim it and retry.
	const patchVersion = PHP_PATCH_VERSIONS[ version ];
	const downloadInfo = await resolvePhpBinaryDownloadInfo( version, platform, arch );
	const downloadPath = path.join( destDir, getArchiveFileName( downloadInfo.url ) );

	try {
		await downloadFile( downloadInfo.url, downloadPath, onProgress );
		await verifyHash( downloadPath, downloadInfo.sha, version, platform, arch );
		await extractAndInstall( downloadPath, destPath, patchVersion, platform, arch );
	} catch ( err ) {
		fs.rmSync( destDir, { recursive: true, force: true } );
		throw err;
	} finally {
		if ( fs.existsSync( downloadPath ) ) {
			fs.unlinkSync( downloadPath );
		}
	}
}

export async function resolvePhpBinaryDownloadInfo(
	version: NativePhpSupportedVersion,
	platform: NodeJS.Platform,
	arch: string
): Promise< PhpBinaryDownloadInfo > {
	const manifest = await fetchPhpBinaryManifest();
	const appsCdnDownload = getPhpBinaryManifestDownloadInfo( manifest, version, platform, arch );
	if ( appsCdnDownload ) {
		return appsCdnDownload;
	}

	throw new Error(
		`PHP ${ PHP_PATCH_VERSIONS[ version ] } is not available for this device yet. Please try again later.`
	);
}

async function fetchPhpBinaryManifest(): Promise< unknown > {
	try {
		const response = await fetch( PHP_BINARY_MANIFEST_URL );
		if ( ! response.ok ) {
			throw new Error( `status ${ response.status }` );
		}
		return await response.json();
	} catch {
		throw new Error( 'Could not check PHP availability. Please try again later.' );
	}
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

async function verifyHash(
	filePath: string,
	expected: string,
	version: NativePhpSupportedVersion,
	platform: NodeJS.Platform,
	arch: string
): Promise< void > {
	const data = await fs.promises.readFile( filePath );
	const actual = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
	if ( actual !== expected ) {
		throw new Error(
			`SHA-256 mismatch for PHP ${ version } on ${ platform }-${ arch }:\n` +
				`  expected ${ expected }\n` +
				`  got      ${ actual }\n` +
				`Delete ${ path.dirname( getPhpBinaryPath( version ) ) } and retry.`
		);
	}
}

async function extractAndInstall(
	archivePath: string,
	destPath: string,
	patchVersion: string,
	platform: NodeJS.Platform,
	arch: string
): Promise< void > {
	const isWindows = platform === 'win32';
	const effectiveArch = isWindows ? 'x64' : arch;
	const tmpDir = os.tmpdir();
	const binaryName = isWindows ? 'php.exe' : 'php';

	if ( isZipArchive( archivePath ) ) {
		const extractDir = fs.mkdtempSync( path.join( tmpDir, `php-${ patchVersion }-` ) );
		try {
			await extractZip( archivePath, extractDir );
			const src = path.join( extractDir, binaryName );
			if ( ! fs.existsSync( src ) ) {
				throw new Error( `${ binaryName } not found after extraction. Archive may be corrupt.` );
			}
			fs.copyFileSync( src, destPath );
			if ( ! isWindows ) {
				fs.chmodSync( destPath, 0o755 );
			}
		} finally {
			fs.rmSync( extractDir, { recursive: true, force: true } );
		}
		return;
	}

	if ( isWindows ) {
		throw new Error( `Windows PHP binary archive must be a .zip file.` );
	} else {
		const extractDir = path.join(
			tmpDir,
			`php-${ patchVersion }-${ platform }-${ effectiveArch }`
		);
		fs.mkdirSync( extractDir, { recursive: true } );
		try {
			await extract( { file: archivePath, cwd: extractDir } );
			const src = path.join( extractDir, 'php' );
			if ( ! fs.existsSync( src ) ) {
				throw new Error( `php binary not found after extraction. Archive may be corrupt.` );
			}
			fs.copyFileSync( src, destPath );
			fs.chmodSync( destPath, 0o755 );
		} finally {
			fs.rmSync( extractDir, { recursive: true, force: true } );
		}
	}
}
