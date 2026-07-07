import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from '@studio/common/lib/download-file';
import { extractZip } from '@studio/common/lib/extract-zip';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import {
	getPhpBinaryDownloadInfo,
	resolveNativePhpVersion,
	type PhpBinaryDownloadInfo,
	type NativePhpSupportedVersion,
} from '@studio/common/lib/php-binary-metadata';
import { ensureNativePhpIniFiles } from 'cli/lib/native-php/config';
import { getPhpBinaryPath } from './paths';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

const WAIT_POLL_INTERVAL_MS = 1_000;
const WAIT_TIMEOUT_MS = 5 * 60 * 1_000;

export async function ensurePhpBinaryAvailable(
	version: SupportedPHPVersion,
	onProgress?: ( downloaded: number, total: number ) => void
): Promise< void > {
	const nativePhpVersion = resolveNativePhpVersion( version );

	if ( ! fs.existsSync( getPhpBinaryPath( nativePhpVersion ) ) ) {
		await downloadAndInstall( nativePhpVersion, onProgress );
	}

	// Idempotent — keeps php.ini in sync for existing installs after a Studio
	// upgrade changes its contents.
	await ensureNativePhpIniFiles( nativePhpVersion );
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

	const downloadInfo = await resolvePhpBinaryDownloadInfo( version, platform, arch );
	const destPath = getPhpBinaryPath( downloadInfo.packageId );
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
	const downloadPath = path.join( destDir, getArchiveFileName( downloadInfo.url ) );

	try {
		await downloadFile( downloadInfo.url, downloadPath, onProgress );
		await verifyHash( downloadPath, downloadInfo.sha, version, platform, arch );
		await extractAndInstall( downloadPath, destPath, downloadInfo.packageId, platform );
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
	const downloadInfo = getPhpBinaryDownloadInfo( version, platform, arch );
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
				`  got      ${ actual }\n`
		);
	}
}

async function extractAndInstall(
	archivePath: string,
	destPath: string,
	packageId: string,
	platform: NodeJS.Platform
): Promise< void > {
	const isWindows = platform === 'win32';
	const tmpDir = os.tmpdir();
	const fallbackBinaryName = isWindows ? 'php.exe' : 'php';

	const extractDir = fs.mkdtempSync( path.join( tmpDir, `php-${ packageId }-` ) );
	try {
		await extractZip( archivePath, extractDir );
		const binaryName = getRuntimeBinaryName( extractDir ) ?? fallbackBinaryName;
		const src = path.join( extractDir, binaryName );
		if ( ! fs.existsSync( src ) ) {
			throw new Error( `${ binaryName } not found after extraction. Archive may be corrupt.` );
		}
		copyDirectoryContents( extractDir, path.dirname( destPath ) );
		if ( ! isWindows ) {
			fs.chmodSync( destPath, 0o755 );
		}
	} finally {
		fs.rmSync( extractDir, { recursive: true, force: true } );
	}
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
