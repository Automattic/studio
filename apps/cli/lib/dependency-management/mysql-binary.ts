import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { downloadFile } from '@studio/common/lib/download-file';
import { extractZip } from '@studio/common/lib/extract-zip';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import {
	DefaultMysqlSupportedVersion,
	getMysqlBinaryDownloadInfo,
	type MysqlBinaryDownloadInfo,
	type MysqlSupportedVersion,
} from '@studio/common/lib/mysql-binary-metadata';
import * as tar from 'tar';
import { getMysqlBinaryRoot, getMysqlServerBinaryPath } from './paths';

const WAIT_POLL_INTERVAL_MS = 1_000;
const WAIT_TIMEOUT_MS = 10 * 60 * 1_000;

export async function ensureMysqlBinaryAvailable(
	version: MysqlSupportedVersion = DefaultMysqlSupportedVersion,
	onProgress?: ( downloaded: number, total: number ) => void
): Promise< string > {
	const downloadInfo = await resolveMysqlBinaryDownloadInfo(
		version,
		process.platform,
		process.arch
	);
	const binaryPath = getMysqlServerBinaryPath( downloadInfo.patchVersion );

	if ( ! fs.existsSync( binaryPath ) ) {
		await downloadAndInstall( downloadInfo, onProgress );
	}

	return downloadInfo.patchVersion;
}

export async function resolveMysqlBinaryDownloadInfo(
	version: MysqlSupportedVersion,
	platform: NodeJS.Platform,
	arch: string
): Promise< MysqlBinaryDownloadInfo > {
	const downloadInfo = getMysqlBinaryDownloadInfo( version, platform, arch );
	if ( downloadInfo ) {
		return downloadInfo;
	}

	throw new Error( `MySQL ${ version } is not available for this platform yet.` );
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
		`Timed out waiting for MySQL binary at ${ binaryPath }. ` +
			`Another process may have failed to install it. ` +
			`Delete ${ path.dirname( path.dirname( binaryPath ) ) } and retry.`
	);
}

async function downloadAndInstall(
	downloadInfo: MysqlBinaryDownloadInfo,
	onProgress?: ( downloaded: number, total: number ) => void
): Promise< void > {
	const destPath = getMysqlServerBinaryPath( downloadInfo.patchVersion );
	const destDir = path.dirname( path.dirname( destPath ) );
	const mysqlBinRoot = getMysqlBinaryRoot();

	fs.mkdirSync( mysqlBinRoot, { recursive: true } );

	try {
		fs.mkdirSync( destDir );
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'EEXIST' ) {
			await waitForBinary( destPath );
			return;
		}
		throw err;
	}

	const downloadPath = path.join( destDir, getArchiveFileName( downloadInfo.url ) );

	try {
		await downloadFile( downloadInfo.url, downloadPath, onProgress );
		await verifyHash( downloadPath, downloadInfo.sha, downloadInfo.patchVersion );
		await extractAndInstall( downloadPath, destDir, downloadInfo );
	} catch ( err ) {
		fs.rmSync( destDir, { recursive: true, force: true } );
		throw err;
	} finally {
		if ( fs.existsSync( downloadPath ) ) {
			fs.unlinkSync( downloadPath );
		}
	}
}

function getArchiveFileName( url: string ): string {
	try {
		return path.basename( new URL( url ).pathname );
	} catch {
		return path.basename( url );
	}
}

async function verifyHash( filePath: string, expected: string, version: string ): Promise< void > {
	const data = await fs.promises.readFile( filePath );
	const actual = crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
	if ( actual !== expected ) {
		throw new Error(
			`SHA-256 mismatch for MySQL ${ version }:\n` +
				`  expected ${ expected }\n` +
				`  got      ${ actual }\n`
		);
	}
}

async function extractAndInstall(
	archivePath: string,
	destDir: string,
	downloadInfo: MysqlBinaryDownloadInfo
): Promise< void > {
	const extractDir = fs.mkdtempSync(
		path.join( os.tmpdir(), `mysql-${ downloadInfo.patchVersion }-` )
	);
	try {
		if ( downloadInfo.archiveType === 'zip' ) {
			await extractZip( archivePath, extractDir );
		} else {
			await extractTarGz( archivePath, extractDir );
		}

		const src = path.join( extractDir, downloadInfo.rootDir );
		if ( ! fs.existsSync( path.join( src, 'bin' ) ) ) {
			throw new Error( `MySQL archive did not contain expected root: ${ downloadInfo.rootDir }` );
		}

		copyDirectoryContents( src, destDir );
		if ( process.platform !== 'win32' ) {
			chmodBinFiles( path.join( destDir, 'bin' ) );
		}
	} finally {
		fs.rmSync( extractDir, { recursive: true, force: true } );
	}
}

async function extractTarGz( archivePath: string, destinationFolder: string ): Promise< void > {
	const resolvedDestination = path.resolve( destinationFolder );
	await tar.x( {
		file: archivePath,
		cwd: resolvedDestination,
		filter: ( entryPath: string ) => {
			const normalized = path.normalize( entryPath );
			return ! path.isAbsolute( normalized ) && ! normalized.startsWith( `..${ path.sep }` );
		},
	} );
}

function copyDirectoryContents( sourceDir: string, destDir: string ): void {
	for ( const entry of fs.readdirSync( sourceDir ) ) {
		copyDereferenced( path.join( sourceDir, entry ), path.join( destDir, entry ) );
	}
}

function copyDereferenced( sourcePath: string, destPath: string ): void {
	const stat = fs.statSync( sourcePath );

	if ( stat.isDirectory() ) {
		fs.mkdirSync( destPath, { recursive: true, mode: stat.mode } );
		for ( const entry of fs.readdirSync( sourcePath ) ) {
			copyDereferenced( path.join( sourcePath, entry ), path.join( destPath, entry ) );
		}
		return;
	}

	if ( stat.isFile() ) {
		fs.copyFileSync( sourcePath, destPath );
		fs.chmodSync( destPath, stat.mode );
	}
}

function chmodBinFiles( binDir: string ): void {
	if ( ! fs.existsSync( binDir ) ) {
		return;
	}

	for ( const entry of fs.readdirSync( binDir ) ) {
		const filePath = path.join( binDir, entry );
		if ( fs.statSync( filePath ).isFile() ) {
			fs.chmodSync( filePath, 0o755 );
		}
	}
}
