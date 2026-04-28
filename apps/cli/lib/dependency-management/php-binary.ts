import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractZip } from '@studio/common/lib/extract-zip';
import {
	buildPhpBinaryUrl,
	getPhpBinaryHash,
	NativePhpSupportedVersions,
	PHP_PATCH_VERSIONS,
} from '@studio/common/lib/php-binary-metadata';
import { sequential } from '@studio/common/lib/sequential';
import { extract } from 'tar';
import { getPhpBinaryPath } from './paths';
import { downloadFile } from './utils';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

export function isVersionSupportedByNativeRuntime( version: SupportedPHPVersion ): boolean {
	return NativePhpSupportedVersions.includes( version );
}

const downloadAndInstallDeduped = sequential(
	(
		version: SupportedPHPVersion,
		onProgress: ( ( downloaded: number, total: number ) => void ) | undefined
	) => downloadAndInstall( version, onProgress ),
	{
		concurrent: NativePhpSupportedVersions.length,
		deduplicateKey: ( version ) => version,
	}
);

export async function ensurePhpBinaryAvailable(
	version: SupportedPHPVersion,
	onProgress?: ( downloaded: number, total: number ) => void
): Promise< void > {
	if ( ! isVersionSupportedByNativeRuntime( version ) ) {
		throw new Error(
			`PHP ${ version } is not supported by the native-php runtime. ` +
				`Supported versions: ${ NativePhpSupportedVersions.join( ', ' ) }.`
		);
	}

	if ( fs.existsSync( getPhpBinaryPath( version ) ) ) {
		return;
	}

	await downloadAndInstallDeduped( version, onProgress );
}

async function downloadAndInstall(
	version: SupportedPHPVersion,
	onProgress?: ( downloaded: number, total: number ) => void
): Promise< void > {
	const platform = process.platform;
	const arch = process.arch;
	const isWindows = platform === 'win32';

	// Windows ARM64 has no upstream binary — falls back to x64 under OS emulation.
	if ( arch === 'arm64' && isWindows ) {
		console.warn(
			'Warning: no Windows ARM64 PHP binary available. Downloading x64 binary instead (runs under Windows 11 emulation).'
		);
	}

	const url = buildPhpBinaryUrl( version, platform, arch );
	const patchVersion = PHP_PATCH_VERSIONS[ version ]!;
	const filename = path.basename( url );
	const downloadPath = path.join( os.tmpdir(), filename );

	try {
		await downloadFile( url, downloadPath, onProgress );
		await verifyHash( downloadPath, version, platform, arch );
		await extractAndInstall( downloadPath, version, patchVersion, platform, arch );
	} finally {
		if ( fs.existsSync( downloadPath ) ) {
			fs.unlinkSync( downloadPath );
		}
	}
}

async function verifyHash(
	filePath: string,
	version: SupportedPHPVersion,
	platform: NodeJS.Platform,
	arch: string
): Promise< void > {
	const expected = getPhpBinaryHash( version, platform, arch );
	if ( ! expected ) {
		throw new Error(
			`No pinned SHA-256 hash for PHP ${ version } on ${ platform }-${ arch }. ` +
				`Cannot verify binary integrity. Run: shasum -a 256 ${ filePath }`
		);
	}

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
	version: SupportedPHPVersion,
	patchVersion: string,
	platform: NodeJS.Platform,
	arch: string
): Promise< void > {
	const destPath = getPhpBinaryPath( version );
	fs.mkdirSync( path.dirname( destPath ), { recursive: true } );

	const isWindows = platform === 'win32';
	const effectiveArch = isWindows ? 'x64' : arch;
	const tmpDir = os.tmpdir();

	if ( isWindows ) {
		await extractZip( archivePath, tmpDir );
		const src = path.join( tmpDir, 'php.exe' );
		if ( ! fs.existsSync( src ) ) {
			throw new Error( `php.exe not found after extraction. Archive may be corrupt.` );
		}
		fs.copyFileSync( src, destPath );
		fs.unlinkSync( src );
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
